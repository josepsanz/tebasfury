import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./testing";
import { gameweeks, syncRuns, teamGameweekStats, teams } from "./schema";

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
