import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoundBallot } from "@/lib/domain/necroporra";
import { NecroporraBallots } from "./necroporra-ballots";

const names = new Map([["t1", "LILTEAM"], ["t2", "Villaone"]]);
const render = (
  rows: RoundBallot[],
  resolved = false,
  viewerTeamId: string | null = null,
  over: { castFor?: ((row: RoundBallot) => React.ReactNode) | null } = {},
) =>
  renderToStaticMarkup(
    <NecroporraBallots
      rows={rows}
      teamName={names}
      viewerTeamId={viewerTeamId}
      resolved={resolved}
      castFor={over.castFor ?? null}
    />,
  );

const row = (over: Partial<RoundBallot> = {}): RoundBallot => ({
  teamId: "t9",
  name: "Ada",
  picks: ["t1", "t2"],
  hit: false,
  enteredBy: null,
  castAt: null,
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

  it("says a ballot was entered, and when, without naming who did it", () => {
    // Not an admin-only detail: entering a ballot after the round has closed is a real
    // privilege, and a privilege nobody can see is not one the league has agreed to. But
    // WHICH admin is not the league's business — the owner asked for the act, not the
    // person. `necroporra_votes.entered_by` still records who, where accountability lives.
    const html = render([
      row({ enteredBy: "u-admin", castAt: new Date("2026-09-12T10:30:00Z") }),
    ]);
    expect(html).toContain("entered by an admin");
    expect(html).toContain("12 Sep");
    expect(html).not.toContain("u-admin");
  });

  it("says nothing extra about a ballot its own manager cast", () => {
    expect(render([row()])).not.toContain("entered by");
  });

  it("offers no control to a reader who may not enter ballots", () => {
    expect(render([row({ picks: [] })])).not.toContain("Enter picks");
  });

  it("offers an empty row a way to be filled in, and a full one a way to be changed", () => {
    const castFor = (r: RoundBallot) => <p>form for {r.teamId}</p>;
    expect(render([row({ picks: [] })], false, null, { castFor })).toContain("Enter picks");
    expect(render([row()], false, null, { castFor })).toContain("Edit picks");
  });

  it("hands the control the row it belongs to", () => {
    const castFor = (r: RoundBallot) => <p>form for {r.teamId}</p>;
    expect(render([row({ teamId: "t7" })], false, null, { castFor })).toContain("form for t7");
  });
});
