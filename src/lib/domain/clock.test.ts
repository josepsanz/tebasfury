import { describe, expect, it } from "vitest";
import { formatLeagueMoment, formatSyncedAt } from "./clock";

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
