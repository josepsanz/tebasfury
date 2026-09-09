import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import {
  marketOperations,
  playerGameweekPoints,
  playerValueSnapshots,
  players,
  realTeams,
  squadMembers,
  syncRuns,
  teams,
} from "@/lib/db/schema";
import { CREDENTIAL_ERROR_NAME, CredentialError } from "@/lib/fantasy-client";
import type { MarketOperationRow, PlayerRow, RealTeamRow, SquadRow } from "@/lib/fantasy-client";
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

const club = (id: string, name: string): RealTeamRow => ({
  id,
  name,
  slug: name.toLowerCase().replaceAll(" ", "-"),
  badgeUrl: null,
});

function fakeClient(
  rows: PlayerRow[],
  squads: Record<string, string[]> = {},
  clubs: Record<string, RealTeamRow[]> = {},
  operations: MarketOperationRow[] = [],
): PlayerClient {
  return {
    getPlayers: async () => rows,
    getSquad: async (teamId: string): Promise<SquadRow> => ({
      teamId,
      holdings: (squads[teamId] ?? []).map((playerId) => ({
        playerId,
        buyoutClause: null,
        clauseLockedUntil: null,
        shielded: false,
      })),
      realTeams: clubs[teamId] ?? [],
    }),
    getActivity: async () => operations,
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
    await h.db.delete(realTeams);
    await h.db.delete(players);
    await h.db.delete(teams);
    await h.db.delete(syncRuns);
    await h.db.delete(marketOperations);
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

  it("writes every row when the catalogue crosses its own chunking boundary", async () => {
    // More than one 400-row chunk is not an edge case for this sweep, it is the ONLY
    // production path: the real catalogue is around six hundred players. One row past
    // the boundary is enough to force a second chunk; this asserts every row from both
    // chunks actually landed, not just that the call didn't throw.
    //
    // This no longer also exercises the points write's own boundary: CHUNK_POINTS is
    // wider than CHUNK_CATALOGUE (each write is sized to its own column count, see the
    // doc comment on the CHUNK_* constants), so 401 players' worth of weekPoints — 802
    // rows — sits comfortably under it. The dedicated test below covers that one.
    const COUNT = 401;
    const client = fakeClient(catalogue(COUNT));

    const result = await runPlayerSweep({
      db: h.db, client, now, runId: "s1", trigger: "players-schedule",
    });

    expect(result.playersSynced).toBe(COUNT);
    expect(await h.db.select().from(players)).toHaveLength(COUNT);
    expect(await h.db.select().from(playerGameweekPoints)).toHaveLength(COUNT * 2);
  });

  it("writes every row when the points backfill crosses its own, wider chunking boundary", async () => {
    // CHUNK_POINTS is 2,000 — five times CHUNK_CATALOGUE — because the points
    // backfill is the one write that grows every gameweek. Proving that boundary
    // needs 2,000+ points rows, not 2,000+ players: this fixture gives a
    // MINIMUM_CATALOGUE-sized catalogue many more weekPoints entries each instead,
    // which is also the shape a real mid-season backfill actually takes (one player,
    // many weeks) rather than an unrealistically large catalogue.
    const WEEKS = 21;
    const client = fakeClient(
      catalogue(MINIMUM_CATALOGUE, () => ({
        weekPoints: Array.from({ length: WEEKS }, (_, i) => ({ week: i + 1, points: i })),
      })),
    );

    await runPlayerSweep({ db: h.db, client, now, runId: "s1", trigger: "players-schedule" });

    const total = MINIMUM_CATALOGUE * WEEKS;
    expect(total).toBeGreaterThan(2_000); // the assertion below is only meaningful if this crosses the boundary
    expect(await h.db.select().from(playerGameweekPoints)).toHaveLength(total);
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
        // The players the truncated catalogue shares with the first sweep (p0..p98)
        // carry visibly different values here. A row count alone cannot tell "wrote
        // nothing" from "wrote the overlap, then failed" — both leave 100 rows in
        // place, because upsertCatalogue never deletes a row absent from the incoming
        // catalogue. Checking the overlap still holds the FIRST sweep's values is
        // what actually proves nothing was written.
        client: fakeClient(
          catalogue(MINIMUM_CATALOGUE - 1, () => ({
            nickname: "Should never be written",
            marketValue: 1,
          })),
        ),
        now: tomorrow,
        runId: "s2",
        trigger: "players-schedule",
      }),
    ).rejects.toThrowError(/99/);

    // Replacing six hundred players with a truncated response is worse than skipping
    // a day, so nothing was written — not even the overlap.
    const stored = await h.db.select().from(players);
    expect(stored).toHaveLength(MINIMUM_CATALOGUE);
    expect(stored.find((p) => p.id === "p0")?.nickname).toBe("Player p0");
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

  it("refuses to wipe a squad that comes back empty for a team that had members", async () => {
    // Important 3: a team in a 13-manager league cannot field a lineup of nobody, so
    // an empty response is far more likely a fetch hiccup than a fact. Deleting would
    // wipe firstSeenAt, the one column nothing can recompute.
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
    const before = await h.db.select().from(squadMembers).where(eq(squadMembers.teamId, "t1"));
    expect(before).toHaveLength(2);

    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: [], t2: ["p2"] }),
      now: tomorrow,
      runId: "s2",
      trigger: "players-schedule",
    });

    const after = await h.db.select().from(squadMembers).where(eq(squadMembers.teamId, "t1"));
    expect(after).toEqual(before);
    expect(result.squadsSkipped).toBe(1);
  });

  it("still clears a team that has genuinely never had a recorded squad", async () => {
    // The plausibility floor above must not block the ordinary case: the very first
    // sweep, before any of a team's players have ever been seen, legitimately has
    // nothing to protect.
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Manager A" });

    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: [] }),
      now,
      runId: "s1",
      trigger: "players-schedule",
    });

    expect(await h.db.select().from(squadMembers)).toHaveLength(0);
    expect(result.squadsSkipped).toBe(0);
  });

  it("drops a squad id the catalogue does not recognise, rather than failing the whole sweep", async () => {
    // Important 4: squad_members.player_id has an FK to players.id, and
    // onConflictDoNothing does not absorb an FK violation. Without filtering, a
    // single unrecognised id in one of thirteen squads would throw here, and
    // nextPlayerSweepAfterFailure would book an hourly retry that fails the same way
    // for ever.
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Manager A" });

    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0", "not-in-the-catalogue"] }),
      now,
      runId: "s1",
      trigger: "players-schedule",
    });

    const members = await h.db
      .select()
      .from(squadMembers)
      .where(eq(squadMembers.teamId, "t1"));
    expect(members.map((m) => m.playerId)).toEqual(["p0"]);
    expect(result.droppedSquadPlayers).toBe(1);

    const [run] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "s1"));
    expect(run.status).toBe("succeeded");
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
      getSquad: async (teamId) => ({ teamId, holdings: [], realTeams: [] }),
      getActivity: async () => [],
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

  it("writes one club row when two squads name the same club", async () => {
    await h.db.insert(teams).values([
      { id: "t1", managerId: 1, managerName: "A" },
      { id: "t2", managerId: 2, managerName: "B" },
    ]);

    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(
        catalogue(MINIMUM_CATALOGUE),
        { t1: ["p0"], t2: ["p1"] },
        { t1: [club("4", "FC Barcelona")], t2: [club("4", "FC Barcelona"), club("5", "Real Betis")] },
      ),
      now,
      runId: "s1",
      trigger: "players-manual",
    });

    const rows = await h.db.select().from(realTeams);
    expect(rows).toHaveLength(2);
    expect(result.realTeamsKnown).toBe(2);
  });

  it("refreshes a renamed club and keeps first_seen_at", async () => {
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "A" });
    const first = fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0"] }, { t1: [club("4", "Barcelona")] });
    await runPlayerSweep({ db: h.db, client: first, now, runId: "s1", trigger: "players-manual" });
    const [before] = await h.db.select().from(realTeams);

    const second = fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0"] }, { t1: [club("4", "FC Barcelona")] });
    await runPlayerSweep({ db: h.db, client: second, now: tomorrow, runId: "s2", trigger: "players-manual" });
    const [after] = await h.db.select().from(realTeams);

    expect(after.name).toBe("FC Barcelona");
    expect(after.firstSeenAt.getTime()).toBe(before.firstSeenAt.getTime());
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());
  });

  it("learns a club from a squad whose membership is skipped", async () => {
    // The empty-squad guard protects `first_seen_at` from a suspicious response. It is
    // not a verdict that a club NAME in that response is false — a club name is a
    // weaker claim than a membership list, not a stronger one.
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "A" });
    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0"] }, {}),
      now,
      runId: "s1",
      trigger: "players-manual",
    });

    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: [] }, { t1: [club("4", "FC Barcelona")] }),
      now: tomorrow,
      runId: "s2",
      trigger: "players-manual",
    });

    expect(result.squadsSkipped).toBe(1);
    expect(await h.db.select().from(realTeams)).toHaveLength(1);
  });

  it("reports every club known, not only the ones this sweep saw", async () => {
    // This pins the definition of realTeamsKnown. It is the accumulated total, because
    // the question it answers is "how many clubs can the catalogue name?" — and that is
    // the table the views resolve against. This assertion is what fails if someone
    // later "simplifies" it to a per-sweep count.
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "A" });
    await runPlayerSweep({
      db: h.db,
      client: fakeClient(
        catalogue(MINIMUM_CATALOGUE),
        { t1: ["p0"] },
        { t1: [club("4", "FC Barcelona"), club("5", "Real Betis"), club("6", "Celta")] },
      ),
      now,
      runId: "s1",
      trigger: "players-manual",
    });

    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0"] }, {}),
      now: tomorrow,
      runId: "s2",
      trigger: "players-manual",
    });

    expect(result.realTeamsKnown).toBe(3);
  });

  it("reports no clubs when none have ever been observed", async () => {
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "A" });
    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0"] }, {}),
      now,
      runId: "s1",
      trigger: "players-manual",
    });
    expect(result.realTeamsKnown).toBe(0);
  });

  const operation = (over: Partial<MarketOperationRow> = {}): MarketOperationRow => ({
    id: "op1",
    activityType: 31,
    actorManagerId: 1,
    counterpartyManagerId: null,
    playerId: "p0",
    amount: 2_000_000,
    weekNumber: null,
    occurredAt: new Date("2026-09-07T19:32:04Z"),
    ...over,
  });

  it("captures the operations the feed reports", async () => {
    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), {}, {}, [
        operation({ id: "op1" }),
        operation({ id: "op2", activityType: 33 }),
      ]),
      now,
      runId: "s1",
      trigger: "players-manual",
    });

    expect(await h.db.select().from(marketOperations)).toHaveLength(2);
    expect(result.operationsCaptured).toBe(2);
  });

  it("writes an operation once when consecutive sweeps overlap", async () => {
    // The window is seven days and the cadence is one day, so six days of every feed
    // have been seen before. The API's own id is the primary key precisely so that a
    // re-read corrects rather than duplicates.
    const feed = [operation({ id: "op1", amount: 2_000_000 })];
    await runPlayerSweep({ db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE), {}, {}, feed), now, runId: "s1", trigger: "players-manual" });

    const corrected = [operation({ id: "op1", amount: 2_500_000 })];
    await runPlayerSweep({ db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE), {}, {}, corrected), now: tomorrow, runId: "s2", trigger: "players-manual" });

    const rows = await h.db.select().from(marketOperations);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(2_500_000);
  });

  it("stores an operation naming a player the catalogue has never seen", async () => {
    // Ruling 7 from the writing side: no foreign key, so this is a row and not a
    // failed sweep.
    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), {}, {}, [
        operation({ id: "op1", playerId: "nobody-we-know" }),
      ]),
      now,
      runId: "s1",
      trigger: "players-manual",
    });
    const [row] = await h.db.select().from(marketOperations);
    expect(row.playerId).toBe("nobody-we-know");
  });

  it("fails the whole sweep when the operations cannot be fetched", async () => {
    // Ruling 6, and deliberately unlike every other tolerance in this file. A squad
    // that fails today can be re-read tomorrow against the same data; the activity
    // window will have rolled by then and those operations are gone for good. Failing
    // hands the retry to QStash, and every write here is idempotent, so a retry is free.
    //
    // Matches this file's existing failure tests (see "refuses an implausibly small
    // catalogue" and "records the run, and records a credential failure by name"):
    // runPlayerSweep rejects rather than returning a discriminated outcome. The
    // `outcome.status === "failed"` shape belongs to `runAndSchedule`, one layer up,
    // not to this function.
    const client: PlayerClient = {
      ...fakeClient(catalogue(MINIMUM_CATALOGUE)),
      getActivity: async () => {
        throw new Error("activity feed unavailable");
      },
    };
    await expect(
      runPlayerSweep({
        db: h.db,
        client,
        now,
        runId: "s1",
        trigger: "players-manual",
      }),
    ).rejects.toThrow("activity feed unavailable");

    const [failed] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "s1"));
    expect(failed.status).toBe("failed");
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
