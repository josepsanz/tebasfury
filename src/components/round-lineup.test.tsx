import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoundLineup } from "./round-lineup";
import type { FieldedRow, RoundLineup as RoundLineupData } from "@/lib/db/queries";

const player = (over: Partial<FieldedRow> = {}): FieldedRow => ({
  playerId: "p1",
  nickname: "Courtois",
  line: "goalkeeper",
  weekPoints: 7,
  inIdeal: false,
  ...over,
});

const lineup = (over: Partial<RoundLineupData> = {}): RoundLineupData => ({
  gameweek: 4,
  formation: "1-4-4-2",
  points: 54,
  snapshotTookOn: new Date("2026-09-03T17:03:47Z"),
  players: [player(), player({ playerId: "p2", nickname: "Carvajal", line: "defender" })],
  ...over,
});

describe("RoundLineup", () => {
  it("lays the lines out left to right, keeper first", () => {
    // A lineup is read as a shape before it is read as a list: `1-5-3-2` means nothing
    // until the five are visibly standing across. The DOM order is that shape.
    const html = renderToStaticMarkup(<RoundLineup lineup={lineup()} />);
    expect(html.indexOf("Courtois")).toBeLessThan(html.indexOf("Carvajal"));
  });

  it("gives every line its own column, including an empty one", () => {
    // Four columns always, so the shape of a 1-5-4-1 and a 1-3-4-3 can be told apart at a
    // glance rather than read off the label.
    const html = renderToStaticMarkup(<RoundLineup lineup={lineup()} />);
    expect(html.match(/data-line="/g)).toHaveLength(4);
  });

  it("draws the pitch in hairlines and never in green", () => {
    // The palette spends green on a gain and amber on the reader's own team. A green field
    // would take one of those meanings away for decoration.
    const html = renderToStaticMarkup(<RoundLineup lineup={lineup()} />);
    expect(html).toContain("var(--board-line)");
    expect(html).not.toContain("var(--board-gain)");
  });

  it("gives each player their points for that round", () => {
    expect(renderToStaticMarkup(<RoundLineup lineup={lineup()} />)).toContain("7");
  });

  it("marks whoever made the round's ideal eleven, in a shape and a word", () => {
    const html = renderToStaticMarkup(
      <RoundLineup lineup={lineup({ players: [player({ inIdeal: true })] })} />,
    );
    expect(html).toContain("ideal eleven");
  });

  it("says a round has no lineup rather than drawing an empty pitch", () => {
    const html = renderToStaticMarkup(<RoundLineup lineup={null} />);
    expect(html).toContain("No lineup");
    expect(html).not.toContain("1-4-4-2");
  });

  it("names when the lineup froze, so two managers can be compared fairly", () => {
    expect(renderToStaticMarkup(<RoundLineup lineup={lineup()} />)).toContain("03 Sep");
  });
});
