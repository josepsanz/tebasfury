import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LockIcon } from "./lock-icon";

describe("LockIcon", () => {
  it("draws a body and a shackle", () => {
    const html = renderToStaticMarkup(<LockIcon />);
    expect(html).toContain("<rect");
    expect(html).toContain("<path");
  });

  it("takes the colour of the text it sits in", () => {
    expect(renderToStaticMarkup(<LockIcon />)).toContain('stroke="currentColor"');
  });

  it("is hidden from screen readers, because the row already says 'locked until'", () => {
    expect(renderToStaticMarkup(<LockIcon />)).toContain("aria-hidden");
  });

  it("rounds to whole pixels, since a fraction blurs a one-pixel stroke", () => {
    expect(renderToStaticMarkup(<LockIcon />)).toContain('height="12"');
  });
});
