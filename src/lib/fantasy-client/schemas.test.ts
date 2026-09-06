import { describe, expect, it } from "vitest";
import live from "./__fixtures__/standing-live.json";
import settled from "./__fixtures__/standing-settled.json";
import week from "./__fixtures__/week-current.json";
import leagues from "./__fixtures__/leagues.json";
import { currentWeekSchema, leaguesSchema, standingSchema } from "./schemas";

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
