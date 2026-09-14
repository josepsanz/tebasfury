import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoundBallot } from "@/lib/domain/necroporra";
import { NecroporraBallots } from "./necroporra-ballots";

const names = new Map([["t1", "LILTEAM"], ["t2", "Villaone"]]);
const render = (rows: RoundBallot[], resolved = false, viewerTeamId: string | null = null) =>
  renderToStaticMarkup(
    <NecroporraBallots rows={rows} teamName={names} viewerTeamId={viewerTeamId} resolved={resolved} />,
  );

const row = (over: Partial<RoundBallot> = {}): RoundBallot => ({
  teamId: "t9",
  name: "Ada",
  picks: ["t1", "t2"],
  hit: false,
  enteredBy: null,
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
    expect(render([row()], false, "t9")).toContain("var(--board-you)");
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

  it("says why the list is empty, which now means the league itself is", () => {
    // It used to read "no manager has claimed a team", because a claim was what made a
    // voter. Every team is a voter now, so the only way to have no rows is to have no
    // teams — which happens before the first sync and never again.
    expect(render([])).toContain("the league has no teams");
  });
});
