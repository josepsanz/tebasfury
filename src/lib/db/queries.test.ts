import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./testing";
import {
  gameweeks,
  playerGameweekPoints,
  players,
  playerValueSnapshots,
  squadMembers,
  syncRuns,
  teamGameweekStats,
  teams,
} from "./schema";
import { loadPlayer, loadPlayerCatalogue, loadSnapshots } from "./queries";

describe("loadSnapshots", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(teams).values([
      { id: "t1", managerId: 1, managerName: "Manager A" },
      { id: "t2", managerId: 2, managerName: "Manager B" },
    ]);
    await h.db.insert(gameweeks).values([
      { number: 1, opensAt: new Date("2026-08-15T17:00:00Z"), closesAt: new Date("2026-08-18T01:00:00Z"), isLive: false },
      { number: 2, opensAt: new Date("2026-08-22T17:00:00Z"), closesAt: new Date("2026-08-25T01:00:00Z"), isLive: true },
    ]);
    await h.db.insert(teamGameweekStats).values([
      { teamId: "t1", gameweek: 1, points: 50, roundPosition: 1, isProvisional: false },
      { teamId: "t2", gameweek: 1, points: 10, roundPosition: 2, isProvisional: false },
      { teamId: "t1", gameweek: 2, points: 12, roundPosition: 2, isProvisional: true, livePoints: 12, teamValue: 250_000_000 },
      { teamId: "t2", gameweek: 2, points: 30, roundPosition: 1, isProvisional: true, livePoints: 30, teamValue: 210_000_000 },
    ]);
    await h.db.insert(syncRuns).values({
      id: "r1", trigger: "schedule", status: "succeeded",
      startedAt: new Date("2026-08-23T10:00:00Z"), finishedAt: new Date("2026-08-23T10:00:05Z"), weeksSynced: 1,
    });
    // A player sweep, later than the standings run above. It must not be what the
    // standings pages call their last sync: it wrote no snapshot of theirs.
    await h.db.insert(syncRuns).values({
      id: "s1", trigger: "players-schedule", status: "succeeded",
      startedAt: new Date("2026-08-24T04:00:00Z"),
      finishedAt: new Date("2026-08-24T04:00:20Z"),
    });
  });
  afterAll(async () => { await h.close(); });

  it("returns every snapshot with its team", async () => {
    const { snapshots, teams: refs } = await loadSnapshots(h.db);
    expect(snapshots).toHaveLength(4);
    expect(refs.map((t) => t.managerName).sort()).toEqual(["Manager A", "Manager B"]);
  });

  it("reports the current gameweek and whether it is live", async () => {
    const { currentGameweek, isLive } = await loadSnapshots(h.db);
    expect(currentGameweek).toBe(2);
    expect(isLive).toBe(true);
  });

  it("reports when the last successful sync finished", async () => {
    const { lastSync } = await loadSnapshots(h.db);
    expect(lastSync?.toISOString()).toBe("2026-08-23T10:00:05.000Z");
  });

  it("ignores failed runs when reporting the last sync", async () => {
    await h.db.insert(syncRuns).values({
      id: "r2", trigger: "schedule", status: "failed",
      startedAt: new Date("2026-08-24T10:00:00Z"), finishedAt: new Date("2026-08-24T10:00:01Z"),
      error: "boom",
    });
    const { lastSync } = await loadSnapshots(h.db);
    expect(lastSync?.toISOString()).toBe("2026-08-23T10:00:05.000Z");
  });

  it("reports the last standings sync, not the last run of any kind", async () => {
    const { lastSync } = await loadSnapshots(h.db);
    expect(lastSync?.toISOString()).toBe("2026-08-23T10:00:05.000Z");
  });
});

describe("loadPlayerCatalogue", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Manager A" });
    await h.db.insert(players).values([
      { id: "p1", nickname: "Ada", position: "Midfielder", realTeamId: "rt1", status: "ok" },
      { id: "p2", nickname: "Bruno", position: "Forward", realTeamId: "rt2", status: "injured" },
    ]);
    await h.db.insert(playerValueSnapshots).values([
      { playerId: "p1", takenOn: "2026-09-06", value: 11_000_000 },
      { playerId: "p1", takenOn: "2026-09-07", value: 12_000_000 },
      { playerId: "p2", takenOn: "2026-09-07", value: 4_000_000 },
    ]);
    await h.db.insert(playerGameweekPoints).values([
      { playerId: "p1", gameweek: 1, points: 12 },
      { playerId: "p1", gameweek: 2, points: 28 },
      { playerId: "p2", gameweek: 1, points: 9 },
    ]);
    await h.db.insert(squadMembers).values({ teamId: "t1", playerId: "p1" });
    await h.db.insert(syncRuns).values({
      id: "s1", trigger: "players-schedule", status: "succeeded",
      startedAt: new Date("2026-09-07T04:00:00Z"),
      finishedAt: new Date("2026-09-07T04:00:20Z"),
    });
  });
  afterAll(async () => { await h.close(); });

  it("returns the latest value per player, not every snapshot ever taken", async () => {
    // By May this table is six hundred players times a season of days. Reading all of
    // it to find today's value is the difference between a page and a timeout.
    const { values } = await loadPlayerCatalogue(h.db);
    expect(values).toHaveLength(2);
    expect(values.find((v) => v.playerId === "p1")).toMatchObject({
      value: 12_000_000,
      takenOn: "2026-09-07",
    });
  });

  it("aggregates the points in the database rather than shipping every row", async () => {
    const { totals } = await loadPlayerCatalogue(h.db);
    expect(totals.find((t) => t.playerId === "p1")).toEqual({
      playerId: "p1",
      seasonPoints: 40,
      gameweeksRecorded: 2,
    });
  });

  it("names the owner of an owned player", async () => {
    const { ownership } = await loadPlayerCatalogue(h.db);
    expect(ownership).toEqual([{ playerId: "p1", teamId: "t1", managerName: "Manager A" }]);
  });

  it("reports whether ownership is known at all", async () => {
    // Before a sweep reads the squads, every player would look free. That is a
    // different statement from "nobody owns them", and the view must be able to tell.
    const { ownershipKnown } = await loadPlayerCatalogue(h.db);
    expect(ownershipKnown).toBe(true);
  });

  it("reports when the catalogue was last swept", async () => {
    const { lastSweep } = await loadPlayerCatalogue(h.db);
    expect(lastSweep?.toISOString()).toBe("2026-09-07T04:00:20.000Z");
  });
});

describe("loadPlayer", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Manager A" });
    await h.db.insert(players).values({
      id: "p1", nickname: "Ada", position: "Midfielder",
      realTeamId: "rt1", status: "ok",
    });
    await h.db.insert(playerValueSnapshots).values([
      { playerId: "p1", takenOn: "2026-09-06", value: 11_000_000 },
      { playerId: "p1", takenOn: "2026-09-07", value: 12_000_000 },
    ]);
    await h.db.insert(playerGameweekPoints).values([
      { playerId: "p1", gameweek: 1, points: 12 },
      { playerId: "p1", gameweek: 2, points: 28 },
    ]);
    await h.db.insert(squadMembers).values({ teamId: "t1", playerId: "p1" });
    await h.db.insert(syncRuns).values({
      id: "s1", trigger: "players-schedule", status: "succeeded",
      startedAt: new Date("2026-09-07T04:00:00Z"),
      finishedAt: new Date("2026-09-07T04:00:20Z"),
    });
  });
  afterAll(async () => { await h.close(); });

  it("returns the player with their whole value and points history", async () => {
    const detail = await loadPlayer(h.db, "p1");
    expect(detail?.player.nickname).toBe("Ada");
    expect(detail?.values).toHaveLength(2);
    expect(detail?.points).toHaveLength(2);
    expect(detail?.owner?.managerName).toBe("Manager A");
  });

  it("reports when this player was last swept", async () => {
    const detail = await loadPlayer(h.db, "p1");
    expect(detail?.lastSweep?.toISOString()).toBe("2026-09-07T04:00:20.000Z");
  });

  it("reports ownership as known once any squad has been read", async () => {
    const detail = await loadPlayer(h.db, "p1");
    expect(detail?.ownershipKnown).toBe(true);
  });

  it("returns null for a player nobody has ever swept", async () => {
    expect(await loadPlayer(h.db, "nope")).toBeNull();
  });
});

describe("loadPlayer, before any squad has been read", () => {
  // Regression guard for Important 2: `replaceSquads` finding an empty `teams` table
  // (pressed "Sweep players" before any standings sync) or a `getSquad` call failing
  // mid-loop both leave every squad row absent while the player catalogue is full.
  // The page must not read that absence as "nobody owns this player" — that is a
  // fact the database cannot support until at least one squad has been recorded.
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(players).values({
      id: "p1", nickname: "Ada", position: "Midfielder",
      realTeamId: "rt1", status: "ok",
    });
  });
  afterAll(async () => { await h.close(); });

  it("does not report ownership as known when no squad has ever been read", async () => {
    const detail = await loadPlayer(h.db, "p1");
    expect(detail?.owner).toBeNull();
    expect(detail?.ownershipKnown).toBe(false);
  });
});
