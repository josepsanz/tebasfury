import { describe, expect, it } from "vitest";
import type { MoneySide } from "./market";
import {
  formatAverage,
  formatAveragePrice,
  formatBalance,
  formatBiggestDeal,
  formatPointsPerMillion,
  formatTraded,
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

describe("the market money wording", () => {
  const side = (over: Partial<MoneySide> = {}): MoneySide => ({
    count: 2,
    total: 8_000_000,
    average: 4_000_000,
    biggest: { playerId: "p1", amount: 6_000_000 },
    ...over,
  });
  const empty: MoneySide = { count: 0, total: 0, average: null, biggest: null };

  it("puts the operation count in the caption, so a total can be read fairly", () => {
    // 300M across seventeen buys and 300M across two are different seasons.
    expect(formatTraded(side())).toEqual({ value: "8.0M", note: "2 operations" });
  });

  it("pluralises one operation correctly", () => {
    expect(formatTraded(side({ count: 1 })).note).toBe("1 operation");
  });

  it("says nothing was traded rather than printing nought", () => {
    expect(formatTraded(empty).value).toBe("Nothing yet");
    expect(formatAveragePrice(empty).value).toBe("Nothing yet");
    expect(formatBiggestDeal(empty, () => "x").value).toBe("Nothing yet");
  });

  it("names the player of the biggest deal", () => {
    expect(formatBiggestDeal(side(), () => "F. Garcés")).toEqual({
      value: "6.0M",
      note: "F. Garcés",
    });
  });

  it("keeps the figure when the catalogue has never seen that player", () => {
    // The market log is the target of no foreign key on purpose, so an operation can
    // name a player no other table knows. The money is still true.
    expect(formatBiggestDeal(side(), () => undefined)).toEqual({ value: "6.0M", note: undefined });
  });

  it("signs and colours the balance, because the direction is the whole content", () => {
    expect(formatBalance(3_000_000)).toEqual({ value: "+3.0M", tone: "up" });
    expect(formatBalance(-3_000_000)).toEqual({ value: "−3.0M", tone: "down" });
  });

  it("leaves an exactly level balance uncoloured", () => {
    // Neither made nor lost. Tinting it would make a reader look for a reason.
    expect(formatBalance(0)).toEqual({ value: "0K" });
  });
});
