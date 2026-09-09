import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoundRow } from "@/lib/domain/standings";
import { RoundTable } from "./round-table";

const row = (over: Partial<RoundRow> = {}): RoundRow => ({
  teamId: "a",
  managerName: "Manager A",
  position: 1,
  points: 50,
  positionDerived: false,
  ...over,
});

describe("RoundTable", () => {
  it("shows the round's own points and names the round in the column", () => {
    const html = renderToStaticMarkup(<RoundTable rows={[row()]} gameweek={3} />);
    expect(html).toContain("Round 3");
    expect(html).toContain("50");
    expect(html).toContain("Manager A");
  });

  it("links each manager to their page", () => {
    const html = renderToStaticMarkup(<RoundTable rows={[row({ teamId: "t7" })]} gameweek={1} />);
    expect(html).toContain('href="/teams/t7"');
  });

  it("marks your own row", () => {
    const html = renderToStaticMarkup(
      <RoundTable rows={[row({ teamId: "mine" })]} gameweek={1} myTeamId="mine" />,
    );
    expect(html).toContain("Your team");
  });

  it("says nothing about provisional places for a finished round", () => {
    const html = renderToStaticMarkup(<RoundTable rows={[row()]} gameweek={1} />);
    expect(html).not.toContain("provisional");
  });

  it("says the places are its own when the round is live", () => {
    // The reader has to be able to see, without hovering anything, why this table might
    // disagree with the official app mid-round.
    const html = renderToStaticMarkup(
      <RoundTable rows={[row({ positionDerived: true })]} gameweek={5} />,
    );
    expect(html).toContain("provisional");
    expect(html).toContain("worked out from points");
  });
});
