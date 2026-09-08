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
});
