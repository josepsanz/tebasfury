import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./testing";
import { gameweeks, syncRuns, teamGameweekStats, teams } from "./schema";
import { loadSnapshots } from "./queries";

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
});
