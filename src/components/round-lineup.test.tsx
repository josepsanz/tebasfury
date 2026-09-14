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
  imageUrl: null,
  ...over,
});

const lineup = (over: Partial<RoundLineupData> = {}): RoundLineupData => ({
  gameweek: 4,
  formation: "4-4-2",
  points: 54,
  snapshotTookOn: new Date("2026-09-03T17:03:47Z"),
  players: [player(), player({ playerId: "p2", nickname: "Carvajal", line: "defender" })],
  ...over,
});

describe("RoundLineup", () => {
  it("orders the lines keeper first, which is the shape the data has", () => {
    // A lineup is read as a shape before it is read as a list: `5-3-2` means nothing
    // until the five are visibly standing across. The DOM order is that shape.
    const html = renderToStaticMarkup(<RoundLineup lineup={lineup()} />);
    expect(html.indexOf("Courtois")).toBeLessThan(html.indexOf("Carvajal"));
  });

  it("gives every line its own row, including an empty one", () => {
    // Four rows always, so the shape of a 5-4-1 and a 3-4-3 can be told apart at a glance
    // rather than read off the label.
    const html = renderToStaticMarkup(<RoundLineup lineup={lineup()} />);
    expect(html.match(/data-line="/g)).toHaveLength(4);
  });

  it("draws the eleven on a pitch, not on a panel", () => {
    // It began as hairline furniture, on the argument that this palette spends green on a
    // gain. The owner looked at it and said the pitch was poor, which is the end of that
    // argument: the image is a real pitch, dark enough that light names stay readable on
    // it, and it is ours — an SVG in `public/`, no licence and no raster to go soft.
    const html = renderToStaticMarkup(<RoundLineup lineup={lineup()} />);
    expect(html).toContain("/pitch.svg");
  });

  it("stands the keeper at the foot of the pitch, with the attack running up", () => {
    // The DOM is keeper-first — the order the data has and the order a screen reader
    // should hear — and the pitch is reversed in CSS so it reads the way every fantasy
    // game draws an eleven. Both claims at once, because either alone is half the shape.
    const html = renderToStaticMarkup(<RoundLineup lineup={lineup()} />);
    expect(html).toContain("flex-col-reverse");
    expect(html.indexOf('data-line="goalkeeper"')).toBeLessThan(
      html.indexOf('data-line="striker"'),
    );
  });

  it("puts each player's face on the pitch", () => {
    const html = renderToStaticMarkup(
      <RoundLineup
        lineup={lineup({
          players: [player({ imageUrl: "https://assets-fantasy.llt-services.com/players/1.png" })],
        })}
      />,
    );
    expect(html).toContain("<img");
    // Empty alt on purpose: the name is directly underneath, and an image announced as
    // "Courtois" above the word Courtois is the same fact twice.
    expect(html).toMatch(/<img[^>]*alt=""/);
  });

  it("draws initials for a player the API has never pictured", () => {
    // A hole in the eleven would read as a missing player rather than a missing photo.
    const html = renderToStaticMarkup(
      <RoundLineup lineup={lineup({ players: [player({ nickname: "D. Cárdenas", imageUrl: null })] })} />,
    );
    expect(html).toContain("DC");
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

  it("gives the per-row mark its own accessible name, not just the aggregate caption", () => {
    // The caption below the pitch is aggregate ("ideal eleven (1)") and cannot say
    // WHICH row it belongs to. A screen-reader user needs the mark on the row itself
    // named, the way HoldIcon names its own per-row icon on SquadList.
    const html = renderToStaticMarkup(
      <RoundLineup lineup={lineup({ players: [player({ inIdeal: true })] })} />,
    );
    expect(html).toMatch(/role="img"\s+aria-label="[^"]*ideal eleven[^"]*"/);
  });

  it("says a round has no lineup rather than drawing an empty pitch", () => {
    const html = renderToStaticMarkup(<RoundLineup lineup={null} />);
    expect(html).toContain("No lineup");
    expect(html).not.toContain("4-4-2");
  });

  it("names when the lineup froze, so two managers can be compared fairly", () => {
    expect(renderToStaticMarkup(<RoundLineup lineup={lineup()} />)).toContain("03 Sep");
  });
});
