import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimLine } from "./claim-line";

describe("ClaimLine", () => {
  it("nudges whoever has no team, and links to the page", () => {
    const html = renderToStaticMarkup(<ClaimLine myTeamName={null} />);
    expect(html).toContain("No team claimed yet");
    expect(html).toContain('href="/claim"');
    expect(html).toContain("Claim yours");
  });

  it("names the team of whoever has one, and still links to the page", () => {
    const html = renderToStaticMarkup(<ClaimLine myTeamName="La Agustineta 96" />);
    expect(html).toContain("La Agustineta 96");
    expect(html).toContain('href="/claim"');
    expect(html).toContain("change");
    expect(html).not.toContain("No team claimed yet");
  });

  it("says the team is yours in amber, the portal's one word for it", () => {
    const html = renderToStaticMarkup(<ClaimLine myTeamName="JMjugon" myTeamId="t1" />);
    expect(html).toContain("var(--board-you)");
    expect(html).toContain("your team");
  });

  it("links the name to that manager's own page, where the rest of their season is", () => {
    const html = renderToStaticMarkup(<ClaimLine myTeamName="JMjugon" myTeamId="t1" />);
    expect(html).toContain('href="/teams/t1"');
  });

  it("still names the team when no id came with it, rather than dropping the heading", () => {
    // The id is optional so the component cannot be broken by a caller that has only the
    // name — the highlight is the point, and a plain heading keeps it.
    const html = renderToStaticMarkup(<ClaimLine myTeamName="JMjugon" />);
    expect(html).toContain("JMjugon");
    expect(html).toContain("var(--board-you)");
    expect(html).not.toContain("/teams/");
  });

  it("spends no amber on somebody with no team, since there is no 'you' yet", () => {
    const html = renderToStaticMarkup(<ClaimLine myTeamName={null} />);
    expect(html).not.toContain("var(--board-you)");
  });
});
