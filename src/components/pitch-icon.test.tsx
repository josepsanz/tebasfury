import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PitchIcon } from "./pitch-icon";

describe("PitchIcon", () => {
  it("draws a pitch: touchline, halfway line, centre circle and two boxes", () => {
    const html = renderToStaticMarkup(<PitchIcon />);
    expect(html.match(/<rect/g)).toHaveLength(3);
    expect(html).toContain("<line");
    expect(html).toContain("<circle");
  });

  it("takes the colour of whatever it sits in, rather than fixing one", () => {
    expect(renderToStaticMarkup(<PitchIcon />)).toContain('stroke="currentColor"');
  });

  it("is hidden from screen readers, because the control around it carries the name", () => {
    // Two names for one target is worse than none: the link's aria-label is the name.
    const html = renderToStaticMarkup(<PitchIcon />);
    expect(html).toContain("aria-hidden");
    expect(html).toContain('focusable="false"');
  });

  it("keeps the pitch's proportions at any size", () => {
    const html = renderToStaticMarkup(<PitchIcon size={30} />);
    expect(html).toContain('width="30"');
    expect(html).toContain('height="20"');
  });
});

describe("PitchIcon sizing", () => {
  it("rounds to whole pixels, since a fraction blurs a one-pixel stroke", () => {
    expect(renderToStaticMarkup(<PitchIcon />)).toContain('height="13"');
    expect(renderToStaticMarkup(<PitchIcon />)).not.toContain("13.33");
  });
});
