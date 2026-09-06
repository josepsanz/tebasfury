import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { gameweeks, rawSyncPayloads, syncRuns, teamGameweekStats, teams } from "@/lib/db/schema";
import type { FantasyClient } from "@/lib/fantasy-client";
import type { CurrentWeek, StandingEntry } from "@/lib/fantasy-client/schemas";
import { runSync } from "./index";

const entry = (teamId: string, managerName: string, points: number, position: number,
               over: Partial<StandingEntry> = {}): StandingEntry => ({
  position, points, team: {
    id: teamId, managerId: Number(teamId), teamValue: 250_000_000, teamPoints: 100,
    teamMoney: null, isAdmin: false, manager: { id: teamId, managerName },
  }, ...over,
});

function fakeClient(week: Partial<CurrentWeek>, byWeek: Record<string, StandingEntry[]>): FantasyClient {
  return {
    getCurrentWeek: async () => ({
      weekNumber: 3, isLive: false,
      openingWeekDate: new Date("2026-09-11T19:00:00Z"),
      closingWeekDate: new Date("2026-09-15T01:00:00Z"),
      ...week,
    }),
    getStanding: async (w) => byWeek[w === undefined ? "live" : String(w)] ?? [],
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
  });

  it("backfills every gameweek from an empty database", async () => {
    const client = fakeClient({ weekNumber: 3, isLive: false }, {
      "1": [entry("1", "Manager A", 50, 1)],
      "2": [entry("1", "Manager A", 10, 1)],
      "3": [entry("1", "Manager A", 36, 1)],
    });

    const result = await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });

    expect(result.weeksSynced).toEqual([1, 2, 3]);
    const rows = await h.db.select().from(teamGameweekStats);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.points).sort((a, b) => a - b)).toEqual([10, 36, 50]);
  });

  it("registers the team once, from the manager the API reports", async () => {
    const client = fakeClient({ weekNumber: 1 }, { "1": [entry("7", "Manager G", 5, 1)] });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    await runSync({ db: h.db, client, now, runId: "r2", trigger: "schedule" });
    const rows = await h.db.select().from(teams);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "7", managerName: "Manager G" });
  });

  it("stores a live gameweek as provisional, with its live points", async () => {
    const client = fakeClient({ weekNumber: 1, isLive: true }, {
      live: [entry("1", "Manager A", 43, 1, { livePoints: 43, previousPosition: 2 })],
    });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    const [row] = await h.db.select().from(teamGameweekStats);
    expect(row).toMatchObject({ gameweek: 1, isProvisional: true, livePoints: 43 });
  });

  it("overwrites a provisional gameweek once it settles", async () => {
    const liveClient = fakeClient({ weekNumber: 1, isLive: true }, {
      live: [entry("1", "Manager A", 43, 1, { livePoints: 43 })],
    });
    await runSync({ db: h.db, client: liveClient, now, runId: "r1", trigger: "schedule" });

    const settledClient = fakeClient({ weekNumber: 1, isLive: false }, {
      "1": [entry("1", "Manager A", 61, 1)],
    });
    await runSync({ db: h.db, client: settledClient, now, runId: "r2", trigger: "schedule" });

    const rows = await h.db.select().from(teamGameweekStats);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ points: 61, isProvisional: false, livePoints: null });
  });

  it("leaves settled gameweeks alone on a later run", async () => {
    const client = fakeClient({ weekNumber: 2 }, {
      "1": [entry("1", "Manager A", 50, 1)],
      "2": [entry("1", "Manager A", 10, 1)],
    });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    const second = await runSync({ db: h.db, client, now, runId: "r2", trigger: "schedule" });
    expect(second.weeksSynced).toEqual([]);
  });

  it("records the run and what it did", async () => {
    const client = fakeClient({ weekNumber: 1 }, { "1": [entry("1", "Manager A", 5, 1)] });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    const [run] = await h.db.select().from(syncRuns);
    expect(run).toMatchObject({ id: "r1", status: "succeeded", weeksSynced: 1 });
    expect(run.finishedAt).not.toBeNull();
  });

  it("records the trigger a run was started with", async () => {
    const client = fakeClient({ weekNumber: 1 }, { "1": [entry("1", "Manager A", 5, 1)] });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "manual" });
    const [run] = await h.db.select().from(syncRuns);
    expect(run).toMatchObject({ id: "r1", trigger: "manual" });
  });

  it("records a failure and rethrows, leaving earlier snapshots in place", async () => {
    const good = fakeClient({ weekNumber: 1 }, { "1": [entry("1", "Manager A", 5, 1)] });
    await runSync({ db: h.db, client: good, now, runId: "r1", trigger: "schedule" });

    const broken: FantasyClient = {
      getCurrentWeek: async () => { throw new Error("upstream is down"); },
      getStanding: async () => [],
    };
    await expect(
      runSync({ db: h.db, client: broken, now, runId: "r2", trigger: "schedule" }),
    ).rejects.toThrowError(/upstream/);

    const [run] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "r2"));
    expect(run).toMatchObject({ status: "failed" });
    expect(run.error).toContain("upstream is down");
    expect(await h.db.select().from(teamGameweekStats)).toHaveLength(1);
  });

  it("keeps the team value recorded while live when the gameweek settles", async () => {
    const liveClient = fakeClient({ weekNumber: 1, isLive: true }, {
      live: [entry("1", "Manager A", 43, 1, { livePoints: 43 })],
    });
    await runSync({ db: h.db, client: liveClient, now, runId: "r1", trigger: "schedule" });

    const settledClient = fakeClient({ weekNumber: 1, isLive: false }, {
      "1": [entry("1", "Manager A", 61, 1)],
    });
    await runSync({ db: h.db, client: settledClient, now, runId: "r2", trigger: "schedule" });

    const [row] = await h.db.select().from(teamGameweekStats);
    expect(row.points).toBe(61);
    expect(row.isProvisional).toBe(false);
    // The only reading we will ever have for this week's value.
    expect(row.teamValue).toBe(250_000_000);
  });

  it("leaves team value null for a week that was only ever backfilled", async () => {
    const client = fakeClient({ weekNumber: 2 }, {
      "1": [entry("1", "Manager A", 50, 1)],
      "2": [entry("1", "Manager A", 10, 1)],
    });
    await runSync({ db: h.db, client, now, runId: "r1", trigger: "schedule" });
    const rows = await h.db.select().from(teamGameweekStats);
    expect(rows.every((r) => r.teamValue === null)).toBe(true);
  });
});
