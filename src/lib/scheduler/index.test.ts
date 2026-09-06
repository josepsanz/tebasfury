import { describe, expect, it } from "vitest";
import { delaySecondsUntil } from "./index";

describe("delaySecondsUntil", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  it("converts a future instant into whole seconds of delay", () => {
    expect(delaySecondsUntil(new Date("2026-09-08T12:10:00Z"), now)).toBe(600);
  });

  it("never asks for a negative delay", () => {
    expect(delaySecondsUntil(new Date("2026-09-08T11:00:00Z"), now)).toBe(0);
  });

  it("rounds a sub-second delay up to zero rather than a fraction", () => {
    expect(delaySecondsUntil(new Date("2026-09-08T12:00:00.400Z"), now)).toBe(0);
  });
});
