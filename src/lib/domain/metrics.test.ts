import { describe, expect, it } from "vitest";
import type { Snapshot } from "./standings";
import { leagueMetrics, teamMetrics } from "./metrics";

const snap = (teamId: string, gameweek: number, points: number, over: Partial<Snapshot> = {}): Snapshot => ({
  teamId,
  gameweek,
  points,
  roundPosition: null,
  livePoints: null,
  isProvisional: false,
  teamValue: null,
  ...over,
});

describe("teamMetrics", () => {
  it("reports the best and worst round a team actually played", () => {
    const m = teamMetrics([snap("a", 1, 40), snap("a", 2, 61), snap("a", 3, 22)], "a");
    expect(m.best).toEqual({ points: 61, gameweek: 2, teamId: "a" });
    expect(m.worst).toEqual({ points: 22, gameweek: 3, teamId: "a" });
  });

  it("does not let a blank gameweek become the worst round, but does let it lower the average", () => {
    // Ruling 1. A zero is a missing lineup, so it is not a performance — but the season
    // did go worse for it, and the average is a statement about the season.
    const m = teamMetrics([snap("a", 1, 40), snap("a", 2, 0), snap("a", 3, 20)], "a");
    expect(m.worst).toEqual({ points: 20, gameweek: 3, teamId: "a" });
    expect(m.average).toBe(20);
  });

  it("gives a record to the first gameweek that set it, when two are equal", () => {
    const m = teamMetrics([snap("a", 1, 50), snap("a", 2, 50)], "a");
    expect(m.best?.gameweek).toBe(1);
  });

  it("gives a record to the first gameweek that set it, when two are equal (worst too)", () => {
    const m = teamMetrics([snap("a", 1, 50), snap("a", 2, 50)], "a");
    expect(m.worst?.gameweek).toBe(1);
  });

  it("reads the season in gameweek order, however the rows arrive", () => {
    // Gameweeks: 1=50, 2=10 (value 100M), 3=20, 4=30, 5=50 (value 200M).
    // The array below lists them out of order — nothing here is ascending by gameweek.
    //
    // Best (tie-break): gameweeks 1 and 5 both scored 50. Sorted by gameweek, the
    // reduce starts at gameweek 1 and gameweek 5's equal 50 never replaces it, so the
    // record stays gameweek 1. Without the sort, the reduce would start at gameweek 5
    // (first in this array) and never be displaced by gameweek 1 appearing later — the
    // wrong answer would be gameweek 5.
    //
    // Trend: the true last three BY GAMEWEEK are 3, 4, 5 (points 20, 30, 50), whose
    // least-squares slope is 15. The last three array ELEMENTS are gameweeks 4, 3, 2
    // (points 30, 20, 10), whose slope is 10 — a different, wrong answer, confirmed by
    // hand: (4,30),(3,20),(2,10) has mean (3,20) and slope (1*10 + 0*0 + -1*-10) / (1+0+1) = 10.
    //
    // Points per million: the latest GAMEWEEK with a value is 5 (200,000,000), giving
    // 160/200 = 0.8. The last ARRAY element with a value is gameweek 2 (100,000,000),
    // which would wrongly give 160/100 = 1.6.
    const rows = [
      snap("a", 5, 50, { teamValue: 200_000_000 }),
      snap("a", 1, 50),
      snap("a", 4, 30),
      snap("a", 3, 20),
      snap("a", 2, 10, { teamValue: 100_000_000 }),
    ];
    const m = teamMetrics(rows, "a");
    expect(m.best).toEqual({ points: 50, gameweek: 1, teamId: "a" });
    expect(m.trend).toEqual({ slope: 15, rising: true });
    expect(m.pointsPerMillion).toBe(0.8);
  });

  it("has no trend until three rounds have been played", () => {
    expect(teamMetrics([snap("a", 1, 40), snap("a", 2, 61)], "a").trend).toBeNull();
  });

  it("reads a rising and a falling trend from the last three rounds", () => {
    const rising = teamMetrics([snap("a", 1, 10), snap("a", 2, 20), snap("a", 3, 30)], "a");
    expect(rising.trend).toEqual({ slope: 10, rising: true });

    const falling = teamMetrics([snap("a", 1, 30), snap("a", 2, 20), snap("a", 3, 10)], "a");
    expect(falling.trend).toEqual({ slope: -10, rising: false });
  });

  it("reads only the last three rounds, so an old collapse does not haunt a recovery", () => {
    const m = teamMetrics(
      [snap("a", 1, 80), snap("a", 2, 10), snap("a", 3, 20), snap("a", 4, 30)],
      "a",
    );
    expect(m.trend).toEqual({ slope: 10, rising: true });
  });

  it("does not call a flat run rising", () => {
    const m = teamMetrics([snap("a", 1, 30), snap("a", 2, 30), snap("a", 3, 30)], "a");
    expect(m.trend).toEqual({ slope: 0, rising: false });
  });

  it("measures regularity as the spread of the rounds, and needs two of them", () => {
    expect(teamMetrics([snap("a", 1, 30)], "a").regularity).toBeNull();
    expect(teamMetrics([snap("a", 1, 30), snap("a", 2, 30)], "a").regularity).toBe(0);
    // 20 and 40 sit ten either side of their mean.
    expect(teamMetrics([snap("a", 1, 20), snap("a", 2, 40)], "a").regularity).toBe(10);
  });

  it("counts a streak back from the latest round and stops where it breaks", () => {
    // League averages: GW1 30, GW2 30, GW3 30. Team a is above, above, below.
    const rows = [
      snap("a", 1, 40), snap("b", 1, 20),
      snap("a", 2, 40), snap("b", 2, 20),
      snap("a", 3, 10), snap("b", 3, 50),
    ];
    expect(teamMetrics(rows, "a").streak).toEqual({ rounds: 1, above: false });
    expect(teamMetrics(rows, "b").streak).toEqual({ rounds: 1, above: true });
  });

  it("breaks a streak on a round exactly level with the league", () => {
    const rows = [snap("a", 1, 40), snap("b", 1, 20), snap("a", 2, 30), snap("b", 2, 30)];
    expect(teamMetrics(rows, "a").streak).toEqual({ rounds: 0, above: false });
  });

  it("divides points by the most recent squad value it was given", () => {
    const m = teamMetrics(
      [snap("a", 1, 40, { teamValue: 100_000_000 }), snap("a", 2, 60, { teamValue: 200_000_000 })],
      "a",
    );
    expect(m.pointsPerMillion).toBe(0.5);
  });

  it("has no points per million when no gameweek recorded a squad value", () => {
    expect(teamMetrics([snap("a", 1, 40)], "a").pointsPerMillion).toBeNull();
  });

  it("renders as a page rather than a crash before the first sync", () => {
    const m = teamMetrics([], "a");
    expect(m).toEqual({
      best: null,
      worst: null,
      average: null,
      trend: null,
      regularity: null,
      streak: { rounds: 0, above: false },
      pointsPerMillion: null,
      roundsPlayed: 0,
    });
  });

  describe("a round still being played (C1)", () => {
    // upsertStats sets isProvisional: live for the current gameweek and rewrites it to
    // false once the round settles — so a metric that only reads settled rows loses no
    // history, only the two or three days a round is open.
    it("does not let a live partial score change the average", () => {
      const settled = [snap("a", 1, 50), snap("a", 2, 40)];
      const withLive = [...settled, snap("a", 3, 8, { isProvisional: true })];
      expect(teamMetrics(withLive, "a").average).toBe(teamMetrics(settled, "a").average);
    });

    it("does not let a live partial score become the worst round", () => {
      const rows = [
        snap("a", 1, 50),
        snap("a", 2, 40),
        snap("a", 3, 8, { isProvisional: true }),
      ];
      expect(teamMetrics(rows, "a").worst).toEqual({ points: 40, gameweek: 2, teamId: "a" });
    });

    it("does not let a live partial score become the best round", () => {
      const rows = [
        snap("a", 1, 50),
        snap("a", 2, 40),
        snap("a", 3, 90, { isProvisional: true }),
      ];
      expect(teamMetrics(rows, "a").best).toEqual({ points: 50, gameweek: 1, teamId: "a" });
    });

    it("does not let a live round extend a streak", () => {
      // League averages over the settled rounds: GW1 30, GW2 30. Team a is above both.
      const settled = [
        snap("a", 1, 40), snap("b", 1, 20),
        snap("a", 2, 40), snap("b", 2, 20),
      ];
      // A live GW3 where team a is scoring far below the (also live, and irrelevant)
      // league figure must not stretch or break the streak computed from GW1-2.
      const withLive = [
        ...settled,
        snap("a", 3, 2, { isProvisional: true }),
        snap("b", 3, 90, { isProvisional: true }),
      ];
      expect(teamMetrics(withLive, "a").streak).toEqual(teamMetrics(settled, "a").streak);
    });

    it("does not let a live round break a streak", () => {
      const settled = [
        snap("a", 1, 40), snap("b", 1, 20),
        snap("a", 2, 40), snap("b", 2, 20),
      ];
      // Live GW3 has team a BELOW the live league figure — if this leaked in, it would
      // break the above-streak the settled rounds actually show.
      const withLive = [
        ...settled,
        snap("a", 3, 5, { isProvisional: true }),
        snap("b", 3, 90, { isProvisional: true }),
      ];
      expect(teamMetrics(withLive, "a").streak).toEqual({ rounds: 2, above: true });
    });

    it("does not count a live round as one played", () => {
      const rows = [snap("a", 1, 40), snap("a", 2, 8, { isProvisional: true })];
      expect(teamMetrics(rows, "a").roundsPlayed).toBe(1);
    });

    it("before any match kicks off, all-zero live rows do not read as a wiped-out average", () => {
      // Every team is 0 while live and unplayed — those rows must not enter the
      // average at all, settled or otherwise, rather than being read as thirteen
      // blank lineups.
      const settled = [snap("a", 1, 40), snap("a", 2, 60)];
      const withLiveZero = [...settled, snap("a", 3, 0, { isProvisional: true })];
      expect(teamMetrics(withLiveZero, "a").average).toBe(teamMetrics(settled, "a").average);
    });
  });
});

describe("leagueMetrics", () => {
  it("finds the best and worst round anyone played, and says who", () => {
    const m = leagueMetrics([
      snap("a", 1, 40), snap("b", 1, 71),
      snap("a", 2, 12), snap("b", 2, 30),
    ]);
    expect(m.best).toEqual({ points: 71, gameweek: 1, teamId: "b" });
    expect(m.worst).toEqual({ points: 12, gameweek: 2, teamId: "a" });
  });

  it("skips blank gameweeks in its records too", () => {
    const m = leagueMetrics([snap("a", 1, 40), snap("b", 1, 0)]);
    expect(m.worst).toEqual({ points: 40, gameweek: 1, teamId: "a" });
  });

  it("averages every round played by anybody", () => {
    expect(leagueMetrics([snap("a", 1, 40), snap("b", 1, 20)]).average).toBe(30);
  });

  it("trends on the league's own average per round", () => {
    // Averages: 10, 20, 30 — the league is scoring more each week.
    const m = leagueMetrics([
      snap("a", 1, 5), snap("b", 1, 15),
      snap("a", 2, 15), snap("b", 2, 25),
      snap("a", 3, 25), snap("b", 3, 35),
    ]);
    expect(m.trend).toEqual({ slope: 10, rising: true });
  });

  it("says nothing about an empty league", () => {
    expect(leagueMetrics([])).toEqual({ best: null, worst: null, average: null, trend: null });
  });

  describe("a round still being played (C1)", () => {
    it("does not let a live partial score change the league average", () => {
      const settled = [snap("a", 1, 40), snap("b", 1, 20)];
      const withLive = [
        ...settled,
        snap("a", 2, 5, { isProvisional: true }),
        snap("b", 2, 3, { isProvisional: true }),
      ];
      expect(leagueMetrics(withLive).average).toBe(leagueMetrics(settled).average);
    });

    it("does not let a live partial score become the league's best or worst round", () => {
      const rows = [
        snap("a", 1, 40), snap("b", 1, 20),
        snap("a", 2, 90, { isProvisional: true }), snap("b", 2, 1, { isProvisional: true }),
      ];
      expect(leagueMetrics(rows).best).toEqual({ points: 40, gameweek: 1, teamId: "a" });
      expect(leagueMetrics(rows).worst).toEqual({ points: 20, gameweek: 1, teamId: "b" });
    });
  });

  describe("a same-gameweek tie", () => {
    it("names the same record-holder whichever order the rows arrive in", () => {
      // Two teams tied for the season's best round, in the same gameweek — heap order
      // from the database is not something the domain may rely on to pick a winner.
      const forward = [snap("z", 4, 71), snap("a", 4, 71)];
      const backward = [snap("a", 4, 71), snap("z", 4, 71)];
      expect(leagueMetrics(forward).best).toEqual(leagueMetrics(backward).best);
      expect(leagueMetrics(forward).best?.teamId).toBe("a");
    });
  });
});
