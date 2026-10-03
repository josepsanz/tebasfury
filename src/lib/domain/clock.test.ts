import { describe, expect, it } from "vitest";
import { formatLeagueMoment, formatSyncedAt, leagueDate, leagueWallTime } from "./clock";

describe("formatSyncedAt", () => {
  it("gives just the hour when the sync happened today", () => {
    const at = new Date("2026-09-09T01:09:00Z");
    const now = new Date("2026-09-09T20:00:00Z");
    expect(formatSyncedAt(at, now)).toBe("03:09");
  });

  it("names the day once the sync is not today, so an old figure cannot pass for a fresh one", () => {
    // The failure this exists to prevent: a chain that died on Sunday still reporting
    // "synced 03:09" on Wednesday, which reads as three hours old rather than three days.
    const at = new Date("2026-09-06T01:09:00Z");
    const now = new Date("2026-09-09T20:00:00Z");
    // en-GB abbreviates September to "Sept", not "Sep" — four letters, and that is
    // the platform's call, not ours to reformat.
    expect(formatSyncedAt(at, now)).toBe("06 Sept 03:09");
  });

  it("counts the day in the league's own timezone, not in UTC", () => {
    // 23:30 UTC is already the next day in Madrid. A UTC comparison would call this
    // yesterday's sync and print a date the reader would have to translate.
    const at = new Date("2026-09-08T23:30:00Z");
    const now = new Date("2026-09-09T05:00:00Z");
    expect(formatSyncedAt(at, now)).toBe("01:30");
  });
});

describe("formatLeagueMoment", () => {
  it("names the day and the hour in Spain, not in UTC", () => {
    // 19:15Z in September is 21:15 in Madrid. A deadline given in the wrong timezone is
    // worse than none: it is two hours of false confidence.
    expect(formatLeagueMoment(new Date("2026-09-14T19:15:00Z"))).toBe("Mon 14 Sept, 21:15");
  });

  it("keeps the hour, because a date alone cannot be waited up for", () => {
    expect(formatLeagueMoment(new Date("2026-09-14T23:40:00Z"))).toContain("01:40");
    // And it rolls to the next day in Madrid, which is the point of formatting there.
    expect(formatLeagueMoment(new Date("2026-09-14T23:40:00Z"))).toContain("15 Sept");
  });
});

describe("leagueDate", () => {
  it("is the calendar day in Spain, not in UTC", () => {
    // 23:30 UTC on 3 October is already 01:30 on the 4th in Madrid (CEST, +2).
    expect(leagueDate(new Date("2026-10-03T23:30:00Z"))).toEqual({ year: 2026, month: 10, day: 4 });
  });
});

describe("leagueWallTime", () => {
  it("reads a summer wall time at +2", () => {
    expect(leagueWallTime(2026, 10, 3, 19, 45).toISOString()).toBe("2026-10-03T17:45:00.000Z");
  });

  it("reads a winter wall time at +1", () => {
    expect(leagueWallTime(2026, 12, 1, 19, 45).toISOString()).toBe("2026-12-01T18:45:00.000Z");
  });

  it("is right on both sides of the autumn change (25 Oct 2026, 03:00 CEST -> 02:00 CET)", () => {
    expect(leagueWallTime(2026, 10, 25, 1, 45).toISOString()).toBe("2026-10-24T23:45:00.000Z");
    expect(leagueWallTime(2026, 10, 25, 7, 45).toISOString()).toBe("2026-10-25T06:45:00.000Z");
  });

  it("is right on both sides of the spring change (28 Mar 2027, 02:00 CET -> 03:00 CEST)", () => {
    expect(leagueWallTime(2027, 3, 28, 1, 45).toISOString()).toBe("2027-03-28T00:45:00.000Z");
    expect(leagueWallTime(2027, 3, 28, 7, 45).toISOString()).toBe("2027-03-28T05:45:00.000Z");
  });

  it("rolls an overflowing day into the next month", () => {
    // 1 Nov, 01:45 CET (+1): the clocks went back on 25 Oct.
    expect(leagueWallTime(2026, 10, 32, 1, 45).toISOString()).toBe("2026-11-01T00:45:00.000Z");
  });
});
