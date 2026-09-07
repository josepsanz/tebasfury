import { describe, expect, it } from "vitest";
import live from "./__fixtures__/standing-live.json";
import settled from "./__fixtures__/standing-settled.json";
import week from "./__fixtures__/week-current.json";
import leagues from "./__fixtures__/leagues.json";
import playersFixture from "./__fixtures__/players.json";
import squadFixture from "./__fixtures__/squad.json";
import {
  currentWeekSchema,
  leaguesSchema,
  playersSchema,
  squadSchema,
  standingSchema,
} from "./schemas";

describe("schemas parse the real captured responses", () => {
  it("parses a live gameweek standing", () => {
    const parsed = standingSchema.parse(live);
    expect(parsed).toHaveLength(13);
    expect(parsed[0].livePoints).toEqual(expect.any(Number));
    expect(parsed[0].previousPosition).toEqual(expect.any(Number));
  });

  it("parses a settled gameweek standing, which carries neither live points nor a previous position", () => {
    const parsed = standingSchema.parse(settled);
    expect(parsed).toHaveLength(13);
    expect(parsed[0].livePoints).toBeUndefined();
    expect(parsed[0].previousPosition).toBeUndefined();
  });

  it("parses the current week", () => {
    const parsed = currentWeekSchema.parse(week);
    expect(parsed.weekNumber).toEqual(expect.any(Number));
    expect(parsed.isLive).toEqual(expect.any(Boolean));
    expect(parsed.openingWeekDate).toBeInstanceOf(Date);
  });

  it("parses the league list", () => {
    const parsed = leaguesSchema.parse(leagues);
    expect(parsed[0].id).toEqual(expect.any(String));
    expect(parsed[0].name).toEqual(expect.any(String));
  });

  it("rejects a standing entry that lost its points field", () => {
    const broken = structuredClone(live) as unknown[];
    delete (broken[0] as Record<string, unknown>).points;
    expect(() => standingSchema.parse(broken)).toThrowError();
  });
});

describe("the players schemas parse the real captured responses", () => {
  it("parses the catalogue", () => {
    const parsed = playersSchema.parse(playersFixture);
    expect(parsed.length).toBe(playersFixture.length);
    expect(parsed[0].nickname.length).toBeGreaterThan(0);
  });

  it("keeps every captured position inside the mapped range", () => {
    // A position the map does not know would reach a view as a bare number.
    const parsed = playersSchema.parse(playersFixture);
    expect(parsed.every((p) => p.positionId >= 1 && p.positionId <= 5)).toBe(true);
  });

  it("reads the catalogue's quoted numbers as numbers", () => {
    // `positionId`, `marketValue` and `lastSeasonPoints` all arrive as strings while
    // `points` and `averagePoints` do not, so the coercion is what keeps a numeric
    // column numeric.
    const parsed = playersSchema.parse(playersFixture);
    expect(parsed.every((p) => typeof p.marketValue === "number")).toBe(true);
    expect(parsed.every((p) => typeof p.positionId === "number")).toBe(true);
  });

  it("keeps the gameweek each score belongs to", () => {
    // The arrays are sparse and unordered, so the label is the only thing that says
    // which gameweek a score is. A bare number would lose it.
    const parsed = playersSchema.parse(playersFixture);
    const sparse = parsed.find((p) => p.id === "274");
    expect(sparse?.weekPoints.map((w) => w.weekNumber)).toEqual([2, 1, 3, 6]);
  });

  it("rejects a catalogue entry whose scores lost their gameweek", () => {
    const broken = structuredClone(playersFixture) as { weekPoints: unknown }[];
    broken[0].weekPoints = [1, 2, 3];
    expect(() => playersSchema.parse(broken)).toThrowError();
  });

  it("parses a squad", () => {
    const parsed = squadSchema.parse(squadFixture);
    expect(parsed.players.length).toBeGreaterThan(0);
  });
});
