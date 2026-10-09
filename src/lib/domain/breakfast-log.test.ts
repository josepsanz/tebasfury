import { describe, expect, it } from "vitest";
import {
  formatBreakfastDay,
  isPlanned,
  monthGrid,
  monthLabel,
  monthParam,
  parseMonth,
  shiftMonth,
  todayInLeague,
  validateBreakfast,
} from "./breakfast-log";

describe("todayInLeague", () => {
  it("is already tomorrow in Madrid at 23:30 UTC", () => {
    expect(todayInLeague(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
  });
  it("is the same day in the middle of it", () => {
    expect(todayInLeague(new Date("2026-10-09T10:00:00Z"))).toBe("2026-10-09");
  });
});

describe("parseMonth", () => {
  const today = "2026-10-09";
  it("reads a well-formed month", () => {
    expect(parseMonth("2026-08", today)).toEqual({ year: 2026, month: 8 });
  });
  it.each([undefined, "", "abc", "2026-13", "2026-00", "2026-1", "2026-10-01"])(
    "falls back to the current month for %s",
    (param) => {
      expect(parseMonth(param, today)).toEqual({ year: 2026, month: 10 });
    },
  );
});

describe("month arithmetic and wording", () => {
  it("steps across a year in both directions", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 });
  });
  it("writes the parameter zero-padded", () => {
    expect(monthParam({ year: 2026, month: 8 })).toBe("2026-08");
  });
  it("names the month", () => {
    expect(monthLabel({ year: 2026, month: 10 })).toBe("October 2026");
  });
  it("names a day the way the list reads it", () => {
    expect(formatBreakfastDay("2026-10-07")).toBe("Wed 7 Oct");
  });
});

describe("monthGrid", () => {
  const days = (grid: ReturnType<typeof monthGrid>) =>
    grid.map((week) => week.map((cell) => (cell === null ? 0 : cell.day)));

  it("starts on a Monday and pads the first week", () => {
    // 1 October 2026 is a Thursday.
    const grid = monthGrid({ year: 2026, month: 10 }, []);
    expect(days(grid)[0]).toEqual([0, 0, 0, 1, 2, 3, 4]);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(days(grid).flat().filter((d) => d > 0)).toHaveLength(31);
  });

  it("needs no padding when the month starts on a Monday", () => {
    // 1 June 2026 is a Monday.
    expect(days(monthGrid({ year: 2026, month: 6 }, []))[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("puts a Sunday first day in the last column", () => {
    // 1 November 2026 is a Sunday.
    expect(days(monthGrid({ year: 2026, month: 11 }, []))[0]).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it("knows February in a leap year", () => {
    const grid = monthGrid({ year: 2028, month: 2 }, []);
    expect(Math.max(...days(grid).flat())).toBe(29);
  });

  it("puts every entry of a day in that day's cell, in the order given", () => {
    const a = { id: 1, broughtOn: "2026-10-07" };
    const b = { id: 2, broughtOn: "2026-10-07" };
    const other = { id: 3, broughtOn: "2026-09-07" };
    const cells = monthGrid({ year: 2026, month: 10 }, [a, b, other]).flat();
    expect(cells.find((c) => c?.day === 7)?.entries).toEqual([a, b]);
    expect(cells.flatMap((c) => c?.entries ?? [])).toHaveLength(2);
    expect(cells.find((c) => c?.day === 7)?.iso).toBe("2026-10-07");
  });
});

describe("validateBreakfast", () => {
  const teams = [
    { id: "t1", leftAt: null },
    { id: "t9", leftAt: new Date("2026-09-01T00:00:00Z") },
  ];
  const ctx = { today: "2026-10-09", teams, mode: "create" as const };
  const ok = { teamId: "t1", broughtOn: "2026-10-09", what: "  Churros  " };

  it("accepts today and trims what", () => {
    expect(validateBreakfast(ok, ctx)).toEqual({
      ok: true,
      value: { teamId: "t1", broughtOn: "2026-10-09", what: "Churros" },
    });
  });
  it("stores an empty what as null", () => {
    const result = validateBreakfast({ ...ok, what: "   " }, ctx);
    expect(result.ok && result.value.what).toBeNull();
  });
  it.each(["", "2026-02-30", "09/10/2026", "2026-10-9"])("refuses the date %s", (broughtOn) => {
    expect(validateBreakfast({ ...ok, broughtOn }, ctx)).toEqual({ ok: false, reason: "bad-date" });
  });
  it("accepts a day in the future, which is how a breakfast is planned", () => {
    expect(validateBreakfast({ ...ok, broughtOn: "2026-10-16" }, ctx).ok).toBe(true);
  });
  it("refuses a team that is not in the league", () => {
    expect(validateBreakfast({ ...ok, teamId: "nope" }, ctx)).toEqual({
      ok: false,
      reason: "unknown-team",
    });
  });
  it("refuses a departed manager for a new entry but not for an edit", () => {
    expect(validateBreakfast({ ...ok, teamId: "t9" }, ctx)).toEqual({ ok: false, reason: "left-team" });
    expect(validateBreakfast({ ...ok, teamId: "t9" }, { ...ctx, mode: "edit" }).ok).toBe(true);
  });
  it("refuses a what longer than 200 characters, and takes exactly 200", () => {
    expect(validateBreakfast({ ...ok, what: "x".repeat(201) }, ctx)).toEqual({
      ok: false,
      reason: "too-long",
    });
    expect(validateBreakfast({ ...ok, what: "x".repeat(200) }, ctx).ok).toBe(true);
  });
});

describe("isPlanned", () => {
  // A planned breakfast becomes history on its own day, with nobody confirming it.
  it("calls tomorrow planned, and today already brought", () => {
    expect(isPlanned({ broughtOn: "2026-10-10" }, "2026-10-09")).toBe(true);
    expect(isPlanned({ broughtOn: "2026-10-09" }, "2026-10-09")).toBe(false);
    expect(isPlanned({ broughtOn: "2026-10-08" }, "2026-10-09")).toBe(false);
  });
});
