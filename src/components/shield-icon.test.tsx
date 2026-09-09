import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ShieldIcon } from "./shield-icon";

describe("ShieldIcon", () => {
  it("draws a shield", () => {
    expect(renderToStaticMarkup(<ShieldIcon />)).toContain("<path");
  });

  it("takes the colour of the text it sits in", () => {
    expect(renderToStaticMarkup(<ShieldIcon />)).toContain('stroke="currentColor"');
  });

  it("is hidden from screen readers, since the row carries the word", () => {
    expect(renderToStaticMarkup(<ShieldIcon />)).toContain("aria-hidden");
  });

  it("is a different SHAPE from the padlock, not a different colour", () => {
    // Three states have to be told apart by a reader who cannot separate the hues:
    // padlock, shield, or neither.
    expect(renderToStaticMarkup(<ShieldIcon />)).not.toContain("<rect");
  });
});
