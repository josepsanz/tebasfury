import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimList } from "./claim-list";

const noop = async () => ({ ok: true, message: "" });

const rows = [
  { teamId: "t1", managerName: "La rataneta", claimedBy: null },
  { teamId: "t2", managerName: "LamineTheTuareg", claimedBy: "bruno" },
  { teamId: "t3", managerName: "La Agustineta 96", claimedBy: "alice" },
];

const render = (over: Partial<Parameters<typeof ClaimList>[0]> = {}) =>
  renderToStaticMarkup(
    <ClaimList
      rows={rows}
      viewerId="alice"
      canReleaseAny={false}
      claimAction={noop}
      releaseAction={noop}
      {...over}
    />,
  );

describe("ClaimList", () => {
  it("names every manager, whatever the state of their row", () => {
    const html = render();
    for (const name of ["La rataneta", "LamineTheTuareg", "La Agustineta 96"]) {
      expect(html).toContain(name);
    }
  });

  it("never names who holds a team", () => {
    const html = render();
    expect(html).not.toContain("bruno");
    expect(html).not.toContain("alice");
  });

  it("says a team someone else holds is claimed, and offers no control for it", () => {
    const html = render({ rows: [rows[1]] });
    expect(html).toContain("Claimed");
    expect(html).not.toContain("<button");
  });

  it("offers the claim button only while the viewer holds nothing", () => {
    const free = render({ rows: [rows[0]] });
    expect(free).toContain("This is me");

    const busy = render({ rows: [rows[0], rows[2]] });
    expect(busy).not.toContain("This is me");
    expect(busy).toContain("one team per person");
  });

  it("offers release on the viewer's own row", () => {
    expect(render()).toContain("Release");
  });

  it("offers release on somebody else's row only to whoever may correct data", () => {
    const plain = render({ rows: [rows[1]] });
    expect(plain).not.toContain("Release");

    const privileged = render({ rows: [rows[1]], canReleaseAny: true });
    expect(privileged).toContain("Release");
    // Still no name, even here.
    expect(privileged).not.toContain("bruno");
  });
});
