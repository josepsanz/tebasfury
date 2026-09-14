import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GearIcon } from "./gear-icon";

describe("GearIcon", () => {
  it("draws a gear: a hub, a ring and its teeth", () => {
    const html = renderToStaticMarkup(<GearIcon />);
    expect(html.match(/<circle/g)).toHaveLength(2);
    expect(html.match(/<line/g)).toHaveLength(8);
  });

  it("takes the colour of the row it sits in", () => {
    expect(renderToStaticMarkup(<GearIcon />)).toContain('stroke="currentColor"');
  });

  it("is hidden from screen readers, since the disclosure carries the name", () => {
    expect(renderToStaticMarkup(<GearIcon />)).toContain("aria-hidden");
  });

  it("is small enough for a row of names by default", () => {
    // Twelve pixels beside a 12.5px line. An icon that out-measures the text it annotates
    // stops being an annotation.
    expect(renderToStaticMarkup(<GearIcon />)).toContain('width="12"');
  });
});
