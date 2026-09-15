import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NavLinks } from "./nav-links";

let pathname = "/market";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

describe("NavLinks", () => {
  beforeEach(() => {
    pathname = "/market";
  });

  it("marks the section you are in", () => {
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} myTeamId={null} />);
    expect(html).toContain('aria-current="page"');
    // The marked one is Market, not merely some link.
    expect(html).toMatch(/aria-current="page"[^>]*>Market</);
  });

  it("offers the four destinations every manager has", () => {
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} myTeamId={null} />);
    for (const label of ["Standings", "Progress", "Players", "Market"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("Sync");
  });

  it("offers the fair-play register, next to the market it is read from", () => {
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} myTeamId={null} />);
    expect(html).toContain('href="/fair-play"');
    expect(html).toContain("Fair play");
    // Beside the log the breaches come out of, and before the poll, which is a game
    // rather than a rule.
    expect(html.indexOf("Market")).toBeLessThan(html.indexOf("Fair play"));
    expect(html.indexOf("Fair play")).toBeLessThan(html.indexOf("Necroporra"));
  });

  it("adds Sync only for whoever can trigger one", () => {
    expect(renderToStaticMarkup(<NavLinks canTriggerSync myTeamId={null} />)).toContain("Sync");
  });

  it("wraps rather than clipping when the row runs out of width", () => {
    // At 375px the five labels come to about 340 of 347 available pixels. Wrapping is
    // what keeps a seventh destination, or a reader with larger system text, from
    // losing a destination off the edge entirely.
    expect(renderToStaticMarkup(<NavLinks canTriggerSync myTeamId={null} />)).toContain("flex-wrap");
  });

  it("marks a deeper path's section, not every link", () => {
    pathname = "/players/38128693";
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} myTeamId={null} />);
    expect(html).toMatch(/aria-current="page"[^>]*>Players</);
    expect(html).not.toMatch(/aria-current="page"[^>]*>Standings</);
  });

  it("marks nothing at the home page", () => {
    pathname = "/";
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} myTeamId={null} />);
    expect(html).not.toContain('aria-current="page"');
  });

  it("puts the reader's own team first, once they have claimed one", () => {
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} myTeamId="t-7" />);
    expect(html).toContain('href="/teams/t-7"');
    // First, because it is the one destination that is the reader's own. The order of
    // the rest is the league's: everybody's table, then everybody's market.
    expect(html.indexOf("My team")).toBeLessThan(html.indexOf("Standings"));
  });

  it("leaves it out entirely for somebody who has not claimed a team", () => {
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} myTeamId={null} />);
    expect(html).not.toContain("My team");
  });

  it("stays marked on the best-lineup page below the squad", () => {
    pathname = "/teams/t-7/lineup";
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} myTeamId="t-7" />);
    expect(html).toMatch(/aria-current="page"[^>]*>My team</);
  });

  it("does not light up on another manager's team", () => {
    // The tab says "My team", and a rival's squad is not it. `/teams/` as a section
    // would have been wrong here in a way no other destination is.
    pathname = "/teams/t-9";
    const html = renderToStaticMarkup(<NavLinks canTriggerSync={false} myTeamId="t-7" />);
    expect(html).not.toContain('aria-current="page"');
  });
});
