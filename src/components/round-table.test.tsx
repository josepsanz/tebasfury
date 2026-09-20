import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoundRow } from "@/lib/domain/standings";
import type { BreakfastDuty } from "@/lib/domain/breakfast";
import { RoundTable } from "./round-table";

const row = (over: Partial<RoundRow> = {}): RoundRow => ({
  teamId: "a",
  managerName: "Manager A",
  position: 1,
  points: 50,
  positionDerived: false,
  ...over,
});

/**
 * Three rows standing in for a table with room for a bringer and a shielded team at
 * once, so the breakfast tests below can name "t2"/"t3" the way the task brief does
 * without each test having to invent its own rows.
 */
const threeRows = (): RoundRow[] => [
  row({ teamId: "t1", managerName: "Team One", position: 1, points: 60 }),
  row({ teamId: "t2", managerName: "Team Two", position: 2, points: 55 }),
  row({ teamId: "t3", managerName: "Team Three", position: 3, points: 40 }),
];

const render = (over: {
  rows?: RoundRow[];
  gameweek?: number;
  myTeamId?: string | null;
  duty?: BreakfastDuty | null;
} = {}): string =>
  renderToStaticMarkup(
    <RoundTable
      rows={over.rows ?? threeRows()}
      gameweek={over.gameweek ?? 4}
      myTeamId={over.myTeamId ?? null}
      duty={over.duty ?? null}
    />,
  );

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

  it("marks the team bringing breakfast, in a word and not only a colour", () => {
    const html = render({ duty: { gameweek: 4, bringers: ["t3"], shielded: [], provisional: false } });
    expect(html).toMatch(/brings breakfast/i);
  });

  it("marks a shielded team, and says how many rounds it has left", () => {
    // The reader is looking at the bottom of the table wondering why the last-placed team
    // is not the one named. The mark is the answer.
    const html = render({
      duty: { gameweek: 4, bringers: ["t2"], shielded: [{ teamId: "t3", roundsLeft: 2 }], provisional: false },
    });
    expect(html).toContain("shielded");
    expect(html).toContain("2");
  });

  it("spends neither the amber nor the green on these marks", () => {
    // The amber is the reader's own team and the green is a gain. A third meaning would
    // empty both of theirs.
    const html = render({
      duty: { gameweek: 4, bringers: ["t3"], shielded: [{ teamId: "t2", roundsLeft: 1 }], provisional: false },
    });
    expect(html).not.toContain("var(--board-you)");
    expect(html).not.toContain("var(--board-gain)");
  });

  it("draws the table unchanged when there is no duty", () => {
    expect(render({ duty: null })).not.toMatch(/breakfast|shielded/i);
  });

  it("states the breakfast mark flatly when the round is over", () => {
    // The counterpart to the provisional mark below: a settled duty carries no hedge, and
    // a test only for "brings breakfast" would pass whichever of the two was rendered.
    const html = render({ duty: { gameweek: 4, bringers: ["t3"], shielded: [], provisional: false } });
    expect(html).not.toMatch(/brings breakfast\?/i);
  });

  it("asks rather than states the breakfast mark while the round is being played", () => {
    const html = render({
      duty: { gameweek: 4, bringers: ["t3"], shielded: [], provisional: true },
    });
    expect(html).toMatch(/brings breakfast\?/i);
    expect(html).toContain("Provisionally brings breakfast");
  });

  it("keeps the shield mark firm while the round is being played", () => {
    // The shield was settled by the rounds that have finished. Hedging it would tell the
    // reader the one thing on this row that cannot move might move.
    const html = render({
      duty: { gameweek: 4, bringers: ["t2"], shielded: [{ teamId: "t3", roundsLeft: 2 }], provisional: true },
    });
    expect(html).toContain("Shielded, 2 rounds left");
    expect(html).not.toMatch(/shielded[^<]*\?/i);
  });
});
