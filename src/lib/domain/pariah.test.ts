import { describe, expect, it } from "vitest";
import { PARIAH_LINES, pariahLine } from "./pariah";

describe("pariahLine", () => {
  it("picks the line the roll lands on", () => {
    expect(pariahLine(0)).toBe(PARIAH_LINES[0]);
    expect(pariahLine(0.999)).toBe(PARIAH_LINES.at(-1));
  });

  it("never runs off the end, even on a roll of exactly 1", () => {
    expect(pariahLine(1)).toBe(PARIAH_LINES.at(-1));
  });
});
