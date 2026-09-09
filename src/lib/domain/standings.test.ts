import { describe, expect, it } from "vitest";
import {
  buildRoundTable,
  buildSeries,
  buildTable,
  type Snapshot,
  type TeamRef,
} from "./standings";

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

describe("buildRoundTable", () => {
  const three: TeamRef[] = [...teams, { id: "c", managerName: "Manager C" }];

  it("ranks one round by the position the API recorded, not by one we work out", () => {
    // Measured against production on 2026-09-09: where two teams tie, the API gives them
    // DISTINCT sequential places while a derived rank shares one. Seven of the 52 rows
    // disagreed, and every disagreement was a tie. Deriving would contradict the app the
    // league already compares against, in three of the four rounds played.
    const round = buildRoundTable(
      [snap("a", 1, 35, 6), snap("b", 1, 35, 5), snap("c", 1, 32, 9)],
      three,
      1,
    );
    expect(round.map((r) => [r.teamId, r.position, r.points])).toEqual([
      ["b", 5, 35],
      ["a", 6, 35],
      ["c", 9, 32],
    ]);
    expect(round.every((r) => r.positionDerived)).toBe(false);
  });

  it("derives places for a live round, where the API records none", () => {
    // A live response reports the overall table position instead of a rank within the
    // round, so `roundPosition` is null. This is the only case we rank anything ourselves.
    const round = buildRoundTable(
      [
        snap("a", 3, 20, 0, { roundPosition: null, isProvisional: true }),
        snap("b", 3, 40, 0, { roundPosition: null, isProvisional: true }),
      ],
      teams,
      3,
    );
    expect(round.map((r) => [r.teamId, r.position])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
    expect(round.every((r) => r.positionDerived)).toBe(true);
  });

  it("lets tied teams share a place when it has to derive, rather than inventing an order", () => {
    // We do not have the API's tie-break and will not guess one. Two on 1st, nobody 2nd.
    const round = buildRoundTable(
      [
        snap("a", 3, 40, 0, { roundPosition: null }),
        snap("b", 3, 40, 0, { roundPosition: null }),
        snap("c", 3, 10, 0, { roundPosition: null }),
      ],
      three,
      3,
    );
    expect(round.map((r) => r.position)).toEqual([1, 1, 3]);
  });

  it("leaves out a team with no row for that round", () => {
    const round = buildRoundTable([snap("a", 1, 50, 1)], teams, 1);
    expect(round.map((r) => r.teamId)).toEqual(["a"]);
  });

  it("is empty for a round nothing has been recorded for", () => {
    expect(buildRoundTable(season, teams, 9)).toEqual([]);
  });

  it("does not depend on the order the caller read the rows in", () => {
    // The module's standing habit: a pure function must not inherit its answer from the
    // order a query happened to return.
    const forwards = buildRoundTable([snap("a", 1, 50, 1), snap("b", 1, 10, 2)], teams, 1);
    const backwards = buildRoundTable([snap("b", 1, 10, 2), snap("a", 1, 50, 1)], teams, 1);
    expect(backwards).toEqual(forwards);
  });

  it("names the manager, so the table can link to them", () => {
    expect(buildRoundTable([snap("a", 1, 50, 1)], teams, 1)[0].managerName).toBe("Manager A");
  });
});
