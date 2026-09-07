import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import {
  playerGameweekPoints,
  playerValueSnapshots,
  players,
  squadMembers,
  syncRuns,
  teams,
} from "@/lib/db/schema";
import { CREDENTIAL_ERROR_NAME, CredentialError } from "@/lib/fantasy-client";
import type { PlayerRow, SquadRow } from "@/lib/fantasy-client";
import { MINIMUM_CATALOGUE, runPlayerSweep, utcDate, type PlayerClient } from "./players";

const player = (id: string, over: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  nickname: `Player ${id}`,
  position: "Midfielder",
  realTeamId: "rt1",
  status: "ok",
  imageUrl: null,
  marketValue: 10_000_000,
  weekPoints: [
    { week: 1, points: 4 },
    { week: 2, points: 7 },
  ],
  ...over,
});

/** A catalogue big enough to clear the plausibility floor. */
function catalogue(count: number, over: (i: number) => Partial<PlayerRow> = () => ({})) {
  return Array.from({ length: count }, (_, i) => player(`p${i}`, over(i)));
}

function fakeClient(rows: PlayerRow[], squads: Record<string, string[]> = {}): PlayerClient {
  return {
    getPlayers: async () => rows,
    getSquad: async (teamId: string): Promise<SquadRow> => ({
      teamId,
      playerIds: squads[teamId] ?? [],
    }),
  };
}

const now = new Date("2026-09-07T04:00:00Z");
const tomorrow = new Date("2026-09-08T04:00:00Z");

describe("runPlayerSweep", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.db.delete(squadMembers);
    await h.db.delete(playerValueSnapshots);
    await h.db.delete(playerGameweekPoints);
    await h.db.delete(players);
    await h.db.delete(teams);
    await h.db.delete(syncRuns);
  });

  it("writes the catalogue and backfills the points history on the first sweep", async () => {
    const client = fakeClient(catalogue(MINIMUM_CATALOGUE));

    const result = await runPlayerSweep({
      db: h.db, client, now, runId: "s1", trigger: "players-schedule",
    });

    expect(result.playersSynced).toBe(MINIMUM_CATALOGUE);
    expect(await h.db.select().from(players)).toHaveLength(MINIMUM_CATALOGUE);

    const points = await h.db
      .select()
      .from(playerGameweekPoints)
      .where(eq(playerGameweekPoints.playerId, "p0"));
    expect(points.sort((a, b) => a.gameweek - b.gameweek)).toMatchObject([
      { gameweek: 1, points: 4 },
      { gameweek: 2, points: 7 },
    ]);
  });

  it("reads the gameweek label rather than the array index for a sparse, out-of-order weekPoints array", async () => {
    // Regression guard for the defect Ruling 2 exists to prevent: the raw API's
    // weekPoints arrays are unordered and sparse, so reading them by index would
    // file one gameweek's score under another's number. This player's array names
    // weeks 3, 1 and 6, out of order, with 2, 4 and 5 never mentioned at all.
    const client = fakeClient(
      catalogue(MINIMUM_CATALOGUE, (i) =>
        i === 0
          ? {
              weekPoints: [
                { week: 3, points: 9 },
                { week: 1, points: 4 },
                { week: 6, points: 2 },
              ],
            }
          : {},
      ),
    );

    await runPlayerSweep({ db: h.db, client, now, runId: "s1", trigger: "players-schedule" });

    const points = await h.db
      .select()
      .from(playerGameweekPoints)
      .where(eq(playerGameweekPoints.playerId, "p0"));
    expect(points.sort((a, b) => a.gameweek - b.gameweek)).toMatchObject([
      { gameweek: 1, points: 4 },
      { gameweek: 3, points: 9 },
      { gameweek: 6, points: 2 },
    ]);
    // Nothing was invented for the weeks the player did not feature in.
    expect(points.map((p) => p.gameweek).sort((a, b) => a - b)).toEqual([1, 3, 6]);
  });

  it("stamps the value snapshot with the day, and a second sweep that day does not duplicate it", async () => {
    await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });
    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE, () => ({ marketValue: 11_000_000 }))),
      now: new Date("2026-09-07T16:00:00Z"),
      runId: "s2",
      trigger: "players-manual",
    });

    const snapshots = await h.db
      .select()
      .from(playerValueSnapshots)
      .where(eq(playerValueSnapshots.playerId, "p0"));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].takenOn).toBe("2026-09-07");
    // The later reading of the day wins: it is the more recent measurement, and the
    // resolution this cadence can honestly claim is a day, not a moment.
    expect(snapshots[0].value).toBe(11_000_000);
  });

  it("appends a second day rather than overwriting the first", async () => {
    await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });
    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE, () => ({ marketValue: 12_000_000 }))),
      now: tomorrow,
      runId: "s2",
      trigger: "players-schedule",
    });

    const snapshots = await h.db
      .select()
      .from(playerValueSnapshots)
      .where(eq(playerValueSnapshots.playerId, "p0"));
    expect(snapshots.map((s) => s.takenOn).sort()).toEqual(["2026-09-07", "2026-09-08"]);
  });

  it("refuses an implausibly small catalogue and leaves the last one in place", async () => {
    await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });

    await expect(
      runPlayerSweep({
        db: h.db,
        client: fakeClient(catalogue(MINIMUM_CATALOGUE - 1)),
        now: tomorrow,
        runId: "s2",
        trigger: "players-schedule",
      }),
    ).rejects.toThrowError(/99/);

    // Replacing six hundred players with a truncated response is worse than skipping
    // a day, so nothing was written.
    expect(await h.db.select().from(players)).toHaveLength(MINIMUM_CATALOGUE);
    const [failed] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "s2"));
    expect(failed.status).toBe("failed");
  });

  it("moves a transferred player between squads and keeps the others' first_seen_at", async () => {
    await h.db.insert(teams).values([
      { id: "t1", managerId: 1, managerName: "Manager A" },
      { id: "t2", managerId: 2, managerName: "Manager B" },
    ]);

    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0", "p1"], t2: ["p2"] }),
      now,
      runId: "s1",
      trigger: "players-schedule",
    });
    const before = await h.db.select().from(squadMembers);
    const p1Before = before.find((m) => m.playerId === "p1")?.firstSeenAt;

    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p1"], t2: ["p2", "p0"] }),
      now: tomorrow,
      runId: "s2",
      trigger: "players-schedule",
    });

    const after = await h.db.select().from(squadMembers);
    expect(after.find((m) => m.playerId === "p0")?.teamId).toBe("t2");
    expect(after.filter((m) => m.playerId === "p0")).toHaveLength(1);
    // A player who did not move keeps "in this squad since".
    expect(after.find((m) => m.playerId === "p1")?.firstSeenAt).toEqual(p1Before);
  });

  it("asks about every team it knows and reports how many squads it read", async () => {
    await h.db.insert(teams).values([
      { id: "t1", managerId: 1, managerName: "Manager A" },
      { id: "t2", managerId: 2, managerName: "Manager B" },
    ]);
    const result = await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });
    expect(result.squadsSynced).toBe(2);
  });

  it("records the run, and records a credential failure by name", async () => {
    const ok = await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });
    expect(ok.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
    const [run] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "s1"));
    expect(run).toMatchObject({ trigger: "players-schedule", status: "succeeded" });

    const broken: PlayerClient = {
      getPlayers: async () => {
        throw new CredentialError("nope");
      },
      getSquad: async (teamId) => ({ teamId, playerIds: [] }),
    };
    await expect(
      runPlayerSweep({
        db: h.db, client: broken, now, runId: "s2", trigger: "players-schedule",
      }),
    ).rejects.toBeInstanceOf(CredentialError);

    // The admin banner matches on this prefix. Without it a failed sweep reads as an
    // ordinary error and nobody is told to re-bootstrap.
    const [failed] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "s2"));
    expect(failed.error?.startsWith(`${CREDENTIAL_ERROR_NAME}:`)).toBe(true);
  });

  it("renames nothing it has already seen, but updates what moved", async () => {
    await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });
    const [first] = await h.db.select().from(players).where(eq(players.id, "p0"));

    await runPlayerSweep({
      db: h.db,
      client: fakeClient(
        catalogue(MINIMUM_CATALOGUE, () => ({ status: "injured", nickname: "Renamed" })),
      ),
      now: tomorrow,
      runId: "s2",
      trigger: "players-schedule",
    });

    const [second] = await h.db.select().from(players).where(eq(players.id, "p0"));
    expect(second.status).toBe("injured");
    expect(second.nickname).toBe("Renamed");
    expect(second.firstSeenAt).toEqual(first.firstSeenAt);
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
  });
});

describe("utcDate", () => {
  it("stamps a snapshot with the UTC day", () => {
    expect(utcDate(new Date("2026-09-07T23:30:00Z"))).toBe("2026-09-07");
  });

  it("does not drift with the machine's timezone", () => {
    // A sweep runs on a serverless function whose zone is not ours. UTC everywhere is
    // what keeps two sweeps either side of local midnight on the same key.
    expect(utcDate(new Date("2026-09-08T00:30:00Z"))).toBe("2026-09-08");
  });
});
