import { describe, expect, it } from "vitest";
import { formatRecord, formatTrend } from "./metric-copy";

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
});
