import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./testing";
import {
  gameweeks,
  syncRuns,
  teamGameweekStats,
  teams,
  players,
  playerGameweekPoints,
  playerValueSnapshots,
  squadMembers,
  realTeams,
} from "./schema";

describe("the standings schema", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    // team_gameweek_stats.gameweek is a foreign key to gameweeks.number, so
    // every gameweek the tests reference — 3 (a backfilled snapshot) and 4 (a
    // live one) — must exist before either snapshot is inserted.
    await h.db.insert(gameweeks).values([
      {
        number: 3,
        opensAt: new Date("2026-08-28T21:00:00Z"),
        closesAt: new Date("2026-09-01T03:00:00Z"),
        isLive: false,
      },
      {
        number: 4,
        opensAt: new Date("2026-09-04T21:00:00Z"),
        closesAt: new Date("2026-09-08T03:00:00Z"),
        isLive: true,
      },
    ]);
  });
  afterAll(async () => {
    await h.close();
  });

  it("stores a team keyed by the id the API gives it", async () => {
    await h.db.insert(teams).values({ id: "38128693", managerId: 9878336, managerName: "Manager A" });
    const [row] = await h.db.select().from(teams);
    expect(row).toMatchObject({ id: "38128693", managerName: "Manager A" });
    expect(row.userId).toBeNull();
  });

  it("stores a gameweek", async () => {
    const [row] = await h.db.select().from(gameweeks).where(eq(gameweeks.number, 4));
    expect(row.number).toBe(4);
    expect(row.isLive).toBe(true);
  });

  it("stores a snapshot with team value left unknown, as a backfilled week has it", async () => {
    await h.db.insert(teamGameweekStats).values({
      teamId: "38128693", gameweek: 3, points: 36, roundPosition: 9, isProvisional: false,
    });
    const [row] = await h.db
      .select()
      .from(teamGameweekStats)
      .where(eq(teamGameweekStats.gameweek, 3));
    expect(row).toMatchObject({ gameweek: 3, points: 36, roundPosition: 9 });
    expect(row.teamValue).toBeNull();
    expect(row.livePoints).toBeNull();
  });

  it("keeps one snapshot per team and gameweek", async () => {
    await h.db.insert(teamGameweekStats).values({
      teamId: "38128693", gameweek: 4, points: 43, roundPosition: 1, isProvisional: true, livePoints: 43,
    });
    await h.db.insert(teamGameweekStats).values({
      teamId: "38128693", gameweek: 4, points: 51, roundPosition: 1, isProvisional: false,
    }).onConflictDoUpdate({
      target: [teamGameweekStats.teamId, teamGameweekStats.gameweek],
      set: { points: 51, isProvisional: false, livePoints: null },
    });
    const rows = await h.db.select().from(teamGameweekStats);
    const week4 = rows.filter((r) => r.gameweek === 4);
    expect(week4).toHaveLength(1);
    expect(week4[0]).toMatchObject({ points: 51, isProvisional: false });
  });

  it("records a sync run", async () => {
    await h.db.insert(syncRuns).values({ id: "run-1", trigger: "manual", status: "running" });
    const [row] = await h.db.select().from(syncRuns);
    expect(row).toMatchObject({ trigger: "manual", status: "running" });
    expect(row.finishedAt).toBeNull();
  });
});

describe("the players schema", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Manager A" });
    await h.db.insert(players).values({
      id: "p1",
      nickname: "A Player",
      position: "Midfielder",
      realTeamId: "rt1",
      status: "ok",
      imageUrl: "https://example.test/p1.png",
    });
  });
  afterAll(async () => {
    await h.close();
  });

  it("stores a player keyed by the id the API gives it", async () => {
    const [row] = await h.db.select().from(players);
    expect(row).toMatchObject({ id: "p1", nickname: "A Player", status: "ok" });
    expect(row.firstSeenAt).toBeInstanceOf(Date);
  });

  it("keeps one points row per player per gameweek", async () => {
    await h.db.insert(playerGameweekPoints).values({ playerId: "p1", gameweek: 1, points: 7 });
    await h.db
      .insert(playerGameweekPoints)
      .values({ playerId: "p1", gameweek: 1, points: 9 })
      .onConflictDoUpdate({
        target: [playerGameweekPoints.playerId, playerGameweekPoints.gameweek],
        set: { points: 9 },
      });

    const rows = await h.db.select().from(playerGameweekPoints);
    expect(rows).toHaveLength(1);
    expect(rows[0].points).toBe(9);
  });

  it("records a value snapshot per day, not per sweep", async () => {
    // The date primary key is what makes a second sweep on the same day idempotent.
    await h.db
      .insert(playerValueSnapshots)
      .values({ playerId: "p1", takenOn: "2026-09-07", value: 12_400_000 });
    await h.db
      .insert(playerValueSnapshots)
      .values({ playerId: "p1", takenOn: "2026-09-07", value: 12_500_000 })
      .onConflictDoUpdate({
        target: [playerValueSnapshots.playerId, playerValueSnapshots.takenOn],
        set: { value: 12_500_000 },
      });
    await h.db
      .insert(playerValueSnapshots)
      .values({ playerId: "p1", takenOn: "2026-09-08", value: 12_600_000 });

    const rows = await h.db.select().from(playerValueSnapshots);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.takenOn === "2026-09-07")?.value).toBe(12_500_000);
  });

  it("stores squad membership as current state, keyed by team and player", async () => {
    await h.db.insert(squadMembers).values({ teamId: "t1", playerId: "p1" });
    const [row] = await h.db.select().from(squadMembers);
    expect(row).toMatchObject({ teamId: "t1", playerId: "p1" });
    expect(row.firstSeenAt).toBeInstanceOf(Date);
  });
});

describe("the club table", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
  });
  afterAll(async () => {
    await h.close();
  });

  it("stores a club keyed by the id the API gives it, with the badge nullable", async () => {
    await h.db.insert(realTeams).values({
      id: "21",
      name: "Deportivo Alavés",
      slug: "deportivo-alaves",
      badgeUrl: null,
    });
    const [row] = await h.db.select().from(realTeams);
    expect(row).toMatchObject({ id: "21", name: "Deportivo Alavés", badgeUrl: null });
    expect(row.firstSeenAt).toBeInstanceOf(Date);
    expect(row.lastSeenAt).toBeInstanceOf(Date);
  });

  it("does not constrain players to a known club", async () => {
    // Ruling 2: inside a sweep the catalogue is written BEFORE any squad is read, so
    // on the first sweep every player is written when no club is known at all. A
    // foreign key here would fail the sweep and every retry after it, for ever.
    await h.db.insert(players).values({
      id: "p1",
      nickname: "Nobody's Club",
      position: "Midfielder",
      realTeamId: "not-a-club-we-have-seen",
      status: "ok",
      imageUrl: null,
    });
    const [row] = await h.db.select().from(players).where(eq(players.id, "p1"));
    expect(row.realTeamId).toBe("not-a-club-we-have-seen");
  });
});
