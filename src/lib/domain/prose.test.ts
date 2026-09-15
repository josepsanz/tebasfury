import { describe, expect, it } from "vitest";
import { HOLD_HOURS } from "./market";
import { shortOfTheHold } from "./prose";

describe("shortOfTheHold", () => {
  it("writes a miss of minutes as minutes, because that is what it was", () => {
    // Valverde, sold 2026-09-08 three minutes before the rule let go of him. Rounded to
    // a day this reads as a manager who sold on day five, which is the opposite of what
    // the log is for.
    expect(shortOfTheHold(119.95)).toBe("3 minutes short");
    expect(shortOfTheHold(119.8)).toBe("12 minutes short");
  });

  it("writes hours as hours", () => {
    expect(shortOfTheHold(110)).toBe("10 hours short");
    expect(shortOfTheHold(119)).toBe("1 hour short");
  });

  it("writes a day or more as days", () => {
    expect(shortOfTheHold(96)).toBe("1 day short");
    // Marcos Llorente: 3.998 days held, a day and minutes short of the rule.
    expect(shortOfTheHold(95.95)).toBe("1 day short");
    // Maffeo: 2.091 days held, and the roundest description of 69.8 hours is three days.
    expect(shortOfTheHold(50.18)).toBe("3 days short");
  });

  it("never claims a miss of zero", () => {
    // A sale seconds early is still early. "0 minutes short" would read as no miss at
    // all, next to a period that says otherwise.
    expect(shortOfTheHold(119.999)).toBe("seconds short");
  });

  it("refuses a holding that met the rule", () => {
    // Not a breach, so there is no shortfall to describe. Loud, because the only way to
    // get here is a caller that skipped the `breach` filter.
    expect(() => shortOfTheHold(HOLD_HOURS)).toThrow(/not short/i);
    expect(() => shortOfTheHold(500)).toThrow(/not short/i);
  });
});
