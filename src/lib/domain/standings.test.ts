import { describe, expect, it } from "vitest";
import { buildSeries, buildTable, type Snapshot, type TeamRef } from "./standings";

const teams: TeamRef[] = [
  { id: "a", managerName: "Manager A" },
  { id: "b", managerName: "Manager B" },
];

const snap = (
  teamId: string, gameweek: number, points: number, roundPosition: number,
  extra: Partial<Snapshot> = {},
): Snapshot => ({
  teamId, gameweek, points, roundPosition,
  livePoints: null, isProvisional: false, teamValue: null, ...extra,
});

//  gw1: A 50 (1st in round), B 10 (2nd)
//  gw2: A 10 (2nd in round), B 40 (1st)
//  cumulative after gw2: A 60, B 50 — A leads the table although B won round 2.
const season: Snapshot[] = [
  snap("a", 1, 50, 1), snap("b", 1, 10, 2),
  snap("a", 2, 10, 2), snap("b", 2, 40, 1),
];

describe("buildTable", () => {
  it("ranks by cumulative points, not by the last round's position", () => {
    const table = buildTable(season, teams);
    expect(table.map((r) => r.teamId)).toEqual(["a", "b"]);
    expect(table[0]).toMatchObject({ position: 1, cumulativePoints: 60 });
    expect(table[1]).toMatchObject({ position: 2, cumulativePoints: 50 });
  });

  it("reports movement against the previous gameweek's table", () => {
    // After gw1 the table was A 1st, B 2nd; after gw2 it is unchanged.
    const table = buildTable(season, teams);
    expect(table[0].previousPosition).toBe(1);
    expect(table[1].previousPosition).toBe(2);
  });

  it("has no previous position when only one gameweek has been played", () => {
    const table = buildTable([snap("a", 1, 50, 1), snap("b", 1, 10, 2)], teams);
    expect(table[0].previousPosition).toBeNull();
  });

  it("marks the table provisional while the latest gameweek is live", () => {
    const live = [...season, snap("a", 3, 5, 2, { isProvisional: true, livePoints: 5 })];
    const table = buildTable(live, teams);
    expect(table.find((r) => r.teamId === "a")?.isProvisional).toBe(true);
    expect(table.find((r) => r.teamId === "a")?.livePoints).toBe(5);
  });

  it("includes a team with no snapshots at all, on zero", () => {
    const table = buildTable([snap("a", 1, 50, 1)], teams);
    expect(table.find((r) => r.teamId === "b")).toMatchObject({ cumulativePoints: 0 });
  });

  it("breaks ties by manager name so the order is stable", () => {
    const tied = [snap("a", 1, 10, 1), snap("b", 1, 10, 1)];
    expect(buildTable(tied, teams).map((r) => r.teamId)).toEqual(["a", "b"]);
  });
});

describe("buildSeries", () => {
  it("returns points scored in each gameweek", () => {
    const { pointsPerWeek } = buildSeries(season, teams);
    expect(pointsPerWeek).toContainEqual({ teamId: "a", gameweek: 2, value: 10 });
  });

  it("accumulates points across gameweeks", () => {
    const { cumulativePoints } = buildSeries(season, teams);
    expect(cumulativePoints).toContainEqual({ teamId: "a", gameweek: 2, value: 60 });
    expect(cumulativePoints).toContainEqual({ teamId: "b", gameweek: 2, value: 50 });
  });

  it("computes table position per gameweek from the cumulative totals", () => {
    const { tablePosition } = buildSeries(season, teams);
    // B won round 2 but is still 2nd in the table.
    expect(tablePosition).toContainEqual({ teamId: "b", gameweek: 2, value: 2 });
    expect(tablePosition).toContainEqual({ teamId: "a", gameweek: 2, value: 1 });
  });

  it("leaves team value null for gameweeks that never recorded one", () => {
    const withValue = [...season, snap("a", 3, 20, 1, { teamValue: 250_000_000 })];
    const { teamValue } = buildSeries(withValue, teams);
    expect(teamValue).toContainEqual({ teamId: "a", gameweek: 1, value: null });
    expect(teamValue).toContainEqual({ teamId: "a", gameweek: 3, value: 250_000_000 });
  });
});
