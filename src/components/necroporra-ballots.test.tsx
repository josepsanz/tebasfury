import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoundBallot } from "@/lib/domain/necroporra";
import { NecroporraBallots } from "./necroporra-ballots";

const names = new Map([["t1", "LILTEAM"], ["t2", "Villaone"]]);
const render = (rows: RoundBallot[], resolved = false, viewerId = "nobody") =>
  renderToStaticMarkup(
    <NecroporraBallots rows={rows} teamName={names} viewerId={viewerId} resolved={resolved} />,
  );

const row = (over: Partial<RoundBallot> = {}): RoundBallot => ({
  userId: "u1",
  name: "Ada",
  picks: ["t1", "t2"],
  hit: false,
  ...over,
});

describe("NecroporraBallots", () => {
  it("shows every manager's picks by team name", () => {
    const html = render([row()]);
    expect(html).toContain("Ada");
    expect(html).toContain("LILTEAM, Villaone");
  });

  it("says out loud that a manager has not voted", () => {
    // The prod is the point: an absence shown as an absence cannot be misread as
    // somebody who does not play.
    const html = render([row({ picks: [] })]);
    expect(html).toContain("has not voted");
  });

  it("marks your own row in amber", () => {
    expect(render([row()], false, "u1")).toContain("var(--board-you)");
  });

  it("ticks the managers who named the team that finished last", () => {
    const html = render([row({ hit: true })], true);
    expect(html).toContain("✓");
    expect(html).toContain("var(--board-gain)");
  });

  it("ticks nobody while the round is still undecided", () => {
    // An open round shows the picks — that is the whole change — but a tick would be a
    // verdict on a result nobody has.
    const html = render([row({ hit: true })], false);
    expect(html).not.toContain("✓");
  });

  it("says why the list is empty when nobody may vote", () => {
    expect(render([])).toContain("no manager has claimed a team");
  });
});
