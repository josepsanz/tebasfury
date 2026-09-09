import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import {
  gameweeks,
  necroporraRounds,
  rawSyncPayloads,
  syncRuns,
  teamGameweekStats,
  teams,
} from "@/lib/db/schema";
import {
  CredentialError,
  CREDENTIAL_ERROR_NAME,
  getCurrentWeek,
  getStanding,
  type FantasyClient,
  type Gameweek,
  type StandingRow,
} from "@/lib/fantasy-client";
import { buildTable } from "@/lib/domain/standings";
import liveFixture from "@/lib/fantasy-client/__fixtures__/standing-live.json";
import settledFixture from "@/lib/fantasy-client/__fixtures__/standing-settled.json";
import weekFixture from "@/lib/fantasy-client/__fixtures__/week-current.json";
import { runSync } from "./index";

/**
 * The standings sync never reaches for the catalogue, a squad, or the activity feed.
 * They are stubbed once, here, because every cadence shares one client: the type
 * carries every call even where a test exercises only two.
 */
const unusedPlayerCalls = {
  getPlayers: async () => [],
  getSquad: async (teamId: string) => ({ teamId, playerIds: [], realTeams: [] }),
  getActivity: async () => [],
};

const row = (
  teamId: string,
  managerName: string,
  weekPoints: number,
  roundPosition: number | null,
  over: Partial<StandingRow> = {},
): StandingRow => ({
  teamId,
  managerId: Number(teamId),
  managerName,
  weekPoints,
  roundPosition,
  livePoints: null,
  teamValue: 250_000_000,
  teamPoints: 100,
  ...over,
});

/**
 * The default week has already closed by `now`. A week the API still calls current
 * is only written settled once it has actually been played, so a fake whose week is
 * still open is testing the "not yet played" path, not the ordinary one.
 */
function fakeClient(
  week: Partial<Gameweek>,
  byWeek: Record<string, StandingRow[]>,
): FantasyClient {
  return {
    getCurrentWeek: async () => ({
      number: 3,
      isLive: false,
      opensAt: new Date("2026-09-04T19:00:00Z"),
      closesAt: new Date("2026-09-08T01:00:00Z"),
      ...week,
    }),
    getStanding: async (w) => {
      const rows = byWeek[w === undefined ? "live" : String(w)] ?? [];
      return { rows, raw: rows };
    },
    ...unusedPlayerCalls,
  };
}

const now = new Date("2026-09-08T12:00:00Z");

describe("runSync", () => {
  let h: TestDatabase;
  beforeAll(async () => { h = await createTestDatabase(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => {
    await h.db.delete(teamGameweekStats);
    await h.db.delete(gameweeks);
    await h.db.delete(teams);
    await h.db.delete(syncRuns);
    // `rawSyncPayloads` ids are derived from `runId`, and most tests reuse "r1"/"r2",
    // so leftover rows from an earlier test would collide on the primary key.
    await h.db.delete(rawSyncPayloads);
    await h.db.delete(necroporraRounds);
  });

  describe("the Necroporra's round", () => {
    it("is opened for the week the API calls current, closing at its kickoff", async () => {
      // No chain of its own: this sync already runs at least daily and already has the
      // kickoff in hand, three days ahead of it.
      const client = fakeClient({ number: 5, opensAt: new Date("2026-09-11T19:00:00Z") }, {});
      await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });

      const [round] = await h.db.select().from(necroporraRounds);
      expect(round).toMatchObject({
        gameweek: 5,
        closesAt: new Date("2026-09-11T19:00:00Z"),
      });
    });

    it("is opened for a week whose standings are not worth recording yet", async () => {
      // The whole point. A week nobody has played is exactly the week whose poll must be
      // open, and `runSync` deliberately writes no `gameweeks` row for it.
      const client = fakeClient(
        { number: 5, isLive: false, closesAt: new Date("2026-09-15T01:00:00Z") },
        {},
      );
      await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });

      expect(await h.db.select().from(gameweeks)).toHaveLength(0);
      expect(await h.db.select().from(necroporraRounds)).toHaveLength(1);
    });
  });

  it("backfills every gameweek from an empty database", async () => {
    const client = fakeClient({ number: 3, isLive: false }, {
      "1": [row("1", "Manager A", 50, 1)],
      "2": [row("1", "Manager A", 10, 1)],
      "3": [row("1", "Manager A", 36, 1)],
    });

    const result = await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });

    expect(result.weeksSynced).toEqual([1, 2, 3]);
    const rows = await h.db.select().from(teamGameweekStats);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.points).sort((a, b) => a - b)).toEqual([10, 36, 50]);
  });

  it("registers the team once, from the manager the API reports", async () => {
    const client = fakeClient({ number: 1 }, { "1": [row("7", "Manager G", 5, 1)] });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    await runSync({ db: h.db, client, now, runId: "r2", trigger: "schedule" });
    const rows = await h.db.select().from(teams);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "7", managerName: "Manager G" });
  });

  it("stores a live gameweek as provisional, with its live points", async () => {
    const client = fakeClient({ number: 1, isLive: true }, {
      live: [row("1", "Manager A", 43, null, { livePoints: 43 })],
    });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    const [stat] = await h.db.select().from(teamGameweekStats);
    expect(stat).toMatchObject({ gameweek: 1, isProvisional: true, livePoints: 43, points: 43 });
  });

  it("records no round position for a live gameweek, which reports none", async () => {
    const client = fakeClient({ number: 1, isLive: true }, {
      live: [row("1", "Manager A", 43, null, { livePoints: 43 })],
    });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    const [stat] = await h.db.select().from(teamGameweekStats);
    expect(stat.roundPosition).toBeNull();
  });

  it("overwrites a provisional gameweek once it settles", async () => {
    const liveClient = fakeClient({ number: 1, isLive: true }, {
      live: [row("1", "Manager A", 43, null, { livePoints: 43 })],
    });
    await runSync({ db: h.db, client: liveClient, now, runId: "r1", trigger: "schedule" });

    const settledClient = fakeClient({ number: 1, isLive: false }, {
      "1": [row("1", "Manager A", 61, 1)],
    });
    await runSync({ db: h.db, client: settledClient, now, runId: "r2", trigger: "schedule" });

    const rows = await h.db.select().from(teamGameweekStats);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ points: 61, isProvisional: false, livePoints: null });
  });

  it("leaves settled gameweeks alone on a later run", async () => {
    const client = fakeClient({ number: 2 }, {
      "1": [row("1", "Manager A", 50, 1)],
      "2": [row("1", "Manager A", 10, 1)],
    });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    const second = await runSync({ db: h.db, client, now, runId: "r2", trigger: "schedule" });
    expect(second.weeksSynced).toEqual([]);
  });

  it("records the run and what it did", async () => {
    const client = fakeClient({ number: 1 }, { "1": [row("1", "Manager A", 5, 1)] });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    const [run] = await h.db.select().from(syncRuns);
    expect(run).toMatchObject({ id: "r1", status: "succeeded", weeksSynced: 1 });
    expect(run.finishedAt).not.toBeNull();
  });

  it("records the trigger a run was started with", async () => {
    const client = fakeClient({ number: 1 }, { "1": [row("1", "Manager A", 5, 1)] });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "manual" });
    const [run] = await h.db.select().from(syncRuns);
    expect(run).toMatchObject({ id: "r1", trigger: "manual" });
  });

  it("records a failure and rethrows, leaving earlier snapshots in place", async () => {
    const good = fakeClient({ number: 1 }, { "1": [row("1", "Manager A", 5, 1)] });
    await runSync({ db: h.db, client: good, now, runId: "r1", trigger: "schedule" });

    const broken: FantasyClient = {
      getCurrentWeek: async () => { throw new Error("upstream is down"); },
      getStanding: async () => ({ rows: [], raw: [] }),
      ...unusedPlayerCalls,
    };
    await expect(
      runSync({ db: h.db, client: broken, now, runId: "r2", trigger: "schedule" }),
    ).rejects.toThrowError(/upstream/);

    const [run] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "r2"));
    expect(run).toMatchObject({ status: "failed" });
    expect(run.error).toContain("upstream is down");
    expect(await h.db.select().from(teamGameweekStats)).toHaveLength(1);
  });

  it("names a credential failure in the record, so the admin history can recognise it", async () => {
    const broken: FantasyClient = {
      getCurrentWeek: async () => { throw new CredentialError("the credential is unreadable"); },
      getStanding: async () => ({ rows: [], raw: [] }),
      ...unusedPlayerCalls,
    };
    await expect(
      runSync({ db: h.db, client: broken, now, runId: "r1", trigger: "schedule" }),
    ).rejects.toBeInstanceOf(CredentialError);

    const [run] = await h.db.select().from(syncRuns);
    expect(run.error?.startsWith(`${CREDENTIAL_ERROR_NAME}:`)).toBe(true);
  });

  it("keeps the team value recorded while live when the gameweek settles", async () => {
    const liveClient = fakeClient({ number: 1, isLive: true }, {
      live: [row("1", "Manager A", 43, null, { livePoints: 43 })],
    });
    await runSync({ db: h.db, client: liveClient, now, runId: "r1", trigger: "schedule" });

    const settledClient = fakeClient({ number: 1, isLive: false }, {
      "1": [row("1", "Manager A", 61, 1)],
    });
    await runSync({ db: h.db, client: settledClient, now, runId: "r2", trigger: "schedule" });

    const [stat] = await h.db.select().from(teamGameweekStats);
    expect(stat.points).toBe(61);
    expect(stat.isProvisional).toBe(false);
    // The only reading we will ever have for this week's value.
    expect(stat.teamValue).toBe(250_000_000);
  });

  it("leaves team value null for a week that was only ever backfilled", async () => {
    const client = fakeClient({ number: 2 }, {
      "1": [row("1", "Manager A", 50, 1)],
      "2": [row("1", "Manager A", 10, 1)],
    });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    const rows = await h.db.select().from(teamGameweekStats);
    expect(rows.every((r) => r.teamValue === null)).toBe(true);
  });

  it("dates only the gameweek the API reports dates for, leaving a backfill's null", async () => {
    const client = fakeClient({ number: 2 }, {
      "1": [row("1", "Manager A", 50, 1)],
      "2": [row("1", "Manager A", 10, 1)],
    });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    const rows = await h.db.select().from(gameweeks);
    expect(rows.find((r) => r.number === 1)?.opensAt).toBeNull();
    expect(rows.find((r) => r.number === 2)?.opensAt?.toISOString())
      .toBe("2026-09-04T19:00:00.000Z");
  });

  describe("a current gameweek that has not been played", () => {
    // `week/current` is not known to wait until a round opens before naming it. If it
    // does not, writing that round settled would drop it into the settled set for
    // good — never fetched again once it goes live.
    it("is not written as settled while its closing date is still ahead", async () => {
      const client = fakeClient(
        { number: 2, isLive: false, closesAt: new Date("2026-09-20T01:00:00Z") },
        {
          "1": [row("1", "Manager A", 50, 1)],
          "2": [row("1", "Manager A", 0, 1)],
        },
      );

      const result = await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });

      expect(result.weeksSynced).toEqual([1]);
      const rows = await h.db.select().from(teamGameweekStats);
      expect(rows.map((r) => r.gameweek)).toEqual([1]);
    });

    it("is picked up on the run that finds it live", async () => {
      const early = fakeClient(
        { number: 2, isLive: false, closesAt: new Date("2026-09-20T01:00:00Z") },
        { "1": [row("1", "Manager A", 50, 1)], "2": [row("1", "Manager A", 0, 1)] },
      );
      await runSync({ db: h.db, client: early, now, runId: "r1", trigger: "schedule" });

      const inPlay = fakeClient(
        { number: 2, isLive: true, closesAt: new Date("2026-09-20T01:00:00Z") },
        { live: [row("1", "Manager A", 24, null, { livePoints: 24 })] },
      );
      const result = await runSync({ db: h.db, client: inPlay, now, runId: "r2", trigger: "schedule" });

      expect(result.weeksSynced).toEqual([2]);
      const week2 = (await h.db.select().from(teamGameweekStats)).find((r) => r.gameweek === 2);
      expect(week2).toMatchObject({ points: 24, isProvisional: true, teamValue: 250_000_000 });
    });

    it("is not written as settled while every team is still on zero", async () => {
      const client = fakeClient(
        { number: 2, isLive: false, closesAt: new Date("2026-09-08T01:00:00Z") },
        { "1": [row("1", "Manager A", 50, 1)], "2": [row("1", "Manager A", 0, 1)] },
      );
      const result = await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
      expect(result.weeksSynced).toEqual([1]);
    });

    it("is written as settled once it has closed and somebody scored", async () => {
      const client = fakeClient(
        { number: 2, isLive: false, closesAt: new Date("2026-09-08T01:00:00Z") },
        { "1": [row("1", "Manager A", 50, 1)], "2": [row("1", "Manager A", 10, 1)] },
      );
      const result = await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
      expect(result.weeksSynced).toEqual([1, 2]);
      const rows = await h.db.select().from(teamGameweekStats);
      expect(rows.every((r) => !r.isProvisional)).toBe(true);
    });
  });
});

/**
 * The fake above hands week-shaped rows to both paths, which is exactly why the two
 * standing endpoints' disagreement about `points` stayed invisible. These tests put
 * the real captured responses through the real client instead, and assert on what
 * lands in the column.
 */
describe("runSync against the committed fixtures", () => {
  let h: TestDatabase;
  const fixtureNow = new Date("2026-09-06T12:00:00Z");

  /** The real client, with `fetch` answering from the fixtures. */
  function fixtureClient(): FantasyClient {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/week/current")) {
          return new Response(JSON.stringify(weekFixture), { status: 200 });
        }
        const body = /\/standing$/.test(url) ? liveFixture : settledFixture;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    return {
      getCurrentWeek: () => getCurrentWeek("token"),
      getStanding: (week) => getStanding("token", "018012894", week),
      ...unusedPlayerCalls,
    };
  }

  beforeAll(async () => { h = await createTestDatabase(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => {
    await h.db.delete(teamGameweekStats);
    await h.db.delete(gameweeks);
    await h.db.delete(teams);
    await h.db.delete(syncRuns);
    await h.db.delete(rawSyncPayloads);
    await runSync({
      db: h.db, client: fixtureClient(), now: fixtureNow, runId: "r1", trigger: "schedule",
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("stores the live week's own score, not the season total the response carries", async () => {
    const rows = await h.db.select().from(teamGameweekStats);
    const week4 = rows.filter((r) => r.gameweek === 4);

    expect(week4).toHaveLength(13);
    // The leader's entry reads `points: 184` — the season total including the round —
    // and `livePoints: 43`, which is what the round is actually worth.
    expect(week4.find((r) => r.teamId === "9000019")?.points).toBe(43);
    expect(week4.map((r) => r.points).sort((a, b) => a - b))
      .toEqual(liveFixture.map((e) => e.livePoints).sort((a, b) => a - b));
  });

  it("stores a settled week's own score", async () => {
    const rows = await h.db.select().from(teamGameweekStats);
    const week3 = rows.filter((r) => r.gameweek === 3);

    expect(week3).toHaveLength(13);
    expect(week3.map((r) => r.points).sort((a, b) => a - b))
      .toEqual(settledFixture.map((e) => e.points).sort((a, b) => a - b));
  });

  it("puts the right manager on top of the table it builds", async () => {
    // Weeks 1 to 3 are all served from the settled fixture, so the expected total is
    // three of that week's score plus the live round's.
    const expected = new Map(settledFixture.map((e) => [e.team.id, e.points * 3]));
    for (const e of liveFixture) {
      expected.set(e.team.id, (expected.get(e.team.id) ?? 0) + e.livePoints);
    }
    const [leader] = [...expected.entries()].sort((a, b) => b[1] - a[1]);

    const stats = await h.db.select().from(teamGameweekStats);
    const teamRows = await h.db.select().from(teams);
    const table = buildTable(
      stats.map((r) => ({
        teamId: r.teamId,
        gameweek: r.gameweek,
        points: r.points,
        roundPosition: r.roundPosition,
        livePoints: r.livePoints,
        isProvisional: r.isProvisional,
        teamValue: r.teamValue,
      })),
      teamRows.map((t) => ({ id: t.id, managerName: t.managerName })),
    );

    expect(table[0].teamId).toBe(leader[0]);
    expect(table[0].cumulativePoints).toBe(leader[1]);
  });

  it("archives the response as it arrived, not as it was mapped", async () => {
    const payloads = await h.db.select().from(rawSyncPayloads);
    const livePayload = payloads.find((p) => p.endpoint === "standing/live");
    expect(livePayload?.payload).toEqual(liveFixture);
  });
});
