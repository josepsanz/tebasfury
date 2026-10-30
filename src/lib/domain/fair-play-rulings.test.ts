import { describe, expect, it } from "vitest";
import { MAX_NOTE, validateRuling } from "./fair-play-rulings";

describe("validateRuling", () => {
  it("accepts each of the three statuses", () => {
    for (const status of ["pending", "remedied", "waived"]) {
      expect(validateRuling({ saleId: "s1", status, note: "" })).toEqual({
        ok: true,
        value: { saleId: "s1", status, note: null },
      });
    }
  });

  it("refuses a status the league does not have", () => {
    expect(validateRuling({ saleId: "s1", status: "forgiven", note: "" })).toEqual({
      ok: false,
      reason: "unknown-status",
    });
  });

  it("trims the note, and stores an empty one as no note", () => {
    const verdict = validateRuling({ saleId: "s1", status: "waived", note: "  twelve minutes  " });
    expect(verdict).toMatchObject({ ok: true, value: { note: "twelve minutes" } });
    expect(validateRuling({ saleId: "s1", status: "waived", note: "   " })).toMatchObject({
      ok: true,
      value: { note: null },
    });
  });

  it("refuses a note longer than a line", () => {
    expect(validateRuling({ saleId: "s1", status: "remedied", note: "x".repeat(MAX_NOTE) }).ok).toBe(true);
    expect(validateRuling({ saleId: "s1", status: "remedied", note: "x".repeat(MAX_NOTE + 1) })).toEqual({
      ok: false,
      reason: "too-long",
    });
  });
});
