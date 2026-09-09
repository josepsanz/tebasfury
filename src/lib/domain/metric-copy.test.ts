import { describe, expect, it } from "vitest";
import {
  formatAverage,
  formatPointsPerMillion,
  formatValueTrend,
  formatRecord,
  formatRegularity,
  formatRoundsPlayed,
  formatStreak,
  formatTrend,
  formatWorstRecord,
} from "./metric-copy";

describe("formatTrend", () => {
  it("carries its unit, so a reader can judge how big the movement is", () => {
    expect(formatTrend({ slope: 6, rising: true })).toEqual({ value: "▲ 6 pts/round", tone: "up" });
    expect(formatTrend({ slope: -6, rising: false })).toEqual({
      value: "▼ 6 pts/round",
      tone: "down",
    });
  });

  it("says a flat run is flat rather than drawing an arrow", () => {
    expect(formatTrend({ slope: 0, rising: false })).toEqual({ value: "Flat" });
  });

  it("asks for another round instead of guessing from two", () => {
    expect(formatTrend(null)).toEqual({ value: "Needs another round" });
  });
});

describe("formatRecord", () => {
  const nameOf = (id: string) => (id === "t1" ? "Villaone" : id);

  it("names the manager and the round that set it", () => {
    expect(formatRecord({ points: 71, gameweek: 4, teamId: "t1" }, nameOf)).toEqual({
      value: "71",
      note: "Villaone, GW4",
    });
  });

  it("says nothing has been played rather than showing a dash", () => {
    expect(formatRecord(null, nameOf)).toEqual({ value: "No rounds yet" });
  });

  it("captions with just the gameweek when no nameOf is given", () => {
    // The team page's own header already says whose page this is (I3) — repeating the
    // manager's name in every tile caption would be the boundary leaking back in.
    expect(formatRecord({ points: 71, gameweek: 4, teamId: "t1" })).toEqual({
      value: "71",
      note: "GW4",
    });
  });
});

describe("formatAverage", () => {
  it("shows the figure as a plain string", () => {
    expect(formatAverage(42.3)).toEqual({ value: "42.3" });
  });

  it("uses the same wording formatRecord uses for nothing played yet", () => {
    expect(formatAverage(null)).toEqual({ value: "No rounds yet" });
  });
});

describe("formatWorstRecord", () => {
  const nameOf = (id: string) => (id === "t1" ? "Villaone" : id);

  it("carries the same caption as formatRecord, plus why zeros don't count", () => {
    expect(formatWorstRecord({ points: 12, gameweek: 4, teamId: "t1" }, nameOf)).toEqual({
      value: "12",
      note: "Villaone, GW4 · zeros excluded",
    });
  });

  it("says nothing has been played rather than showing a dash", () => {
    expect(formatWorstRecord(null, nameOf)).toEqual({ value: "No rounds yet" });
  });

  it("captions with just the gameweek and the zero note when no nameOf is given", () => {
    expect(formatWorstRecord({ points: 12, gameweek: 4, teamId: "t1" })).toEqual({
      value: "12",
      note: "GW4 · zeros excluded",
    });
  });
});

describe("formatRegularity", () => {
  it("shows the spread with its unit and a note on how to read it", () => {
    expect(formatRegularity(4.2)).toEqual({ value: "± 4.2 pts", note: "Lower is steadier" });
  });

  it("asks for a second round instead of computing a spread from one", () => {
    expect(formatRegularity(null)).toEqual({ value: "Needs two rounds" });
  });
});

describe("formatPointsPerMillion", () => {
  it("shows the figure as a plain string", () => {
    expect(formatPointsPerMillion(12.5)).toEqual({ value: "12.5" });
  });

  it("says no squad value was recorded rather than showing a dash", () => {
    expect(formatPointsPerMillion(null)).toEqual({ value: "No squad value recorded" });
  });
});

describe("formatStreak", () => {
  it("says nothing has been played, same wording as everywhere else, when there are no rounds", () => {
    expect(formatStreak({ rounds: 0, above: false }, 0)).toEqual({ value: "No rounds yet" });
  });

  it("distinguishes an actual level reading from having no rounds at all", () => {
    expect(formatStreak({ rounds: 0, above: false }, 5)).toEqual({
      value: "Level with the league",
    });
  });

  it("uses the singular for one round", () => {
    expect(formatStreak({ rounds: 1, above: true }, 3)).toEqual({
      value: "1 round above",
      tone: "up",
    });
  });

  it("uses the plural and the down tone for a run below", () => {
    expect(formatStreak({ rounds: 3, above: false }, 5)).toEqual({
      value: "3 rounds below",
      tone: "down",
    });
  });
});

describe("formatRoundsPlayed", () => {
  it("uses the singular for one round", () => {
    expect(formatRoundsPlayed(1)).toBe("1 round");
  });

  it("uses the plural for zero and for more than one", () => {
    expect(formatRoundsPlayed(0)).toBe("0 rounds");
    expect(formatRoundsPlayed(4)).toBe("4 rounds");
  });
});


describe("formatValueTrend", () => {
  it("carries its unit, so a reader can judge how fast the value is moving", () => {
    expect(formatValueTrend({ slope: 480_000, rising: true })).toEqual({
      value: "▲ 480K/day",
      tone: "up",
    });
    expect(formatValueTrend({ slope: -1_200_000, rising: false })).toEqual({
      value: "▼ 1.2M/day",
      tone: "down",
    });
  });

  it("says a flat value is flat, with no colour", () => {
    expect(formatValueTrend({ slope: 0, rising: false })).toEqual({ value: "Flat" });
  });

  it("gives its own reason rather than a dash when there is not enough history", () => {
    // A player swept twice has no direction yet, which is a different statement from flat.
    expect(formatValueTrend(null)).toEqual({ value: "Needs another day" });
  });
});
