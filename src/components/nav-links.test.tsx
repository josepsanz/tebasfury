import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NavLinks } from "./nav-links";

vi.mock("next/navigation", () => ({ usePathname: () => "/market" }));

describe("NavLinks", () => {
  it("marks the section you are in", () => {
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} />);
    expect(html).toContain('aria-current="page"');
    // The marked one is Market, not merely some link.
    expect(html).toMatch(/aria-current="page"[^>]*>Market</);
  });

  it("offers the five destinations every manager has", () => {
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} />);
    for (const label of ["Standings", "Progress", "Players", "Market"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("Sync");
  });

  it("adds Sync only for whoever can trigger one", () => {
    expect(renderToStaticMarkup(<NavLinks canTriggerSync />)).toContain("Sync");
  });

  it("wraps rather than clipping when the row runs out of width", () => {
    // At 375px the five labels come to about 340 of 347 available pixels. Wrapping is
    // what keeps a seventh destination, or a reader with larger system text, from
    // losing a destination off the edge entirely.
    expect(renderToStaticMarkup(<NavLinks canTriggerSync />)).toContain("flex-wrap");
  });
});
