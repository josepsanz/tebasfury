import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Pitch, type PitchLine, type PitchPlayer } from "./pitch";

const player = (over: Partial<PitchPlayer> = {}): PitchPlayer => ({
  id: "p1",
  nickname: "Courtois",
  imageUrl: null,
  figure: "7",
  ...over,
});

// Four empty lines with the caller's own vocabulary for `line` — the pitch does not
// care what a line is called, only that four of them are always drawn.
const emptyLines = (): PitchLine[] => [
  { line: "keeper", players: [] },
  { line: "defence", players: [] },
  { line: "midfield", players: [] },
  { line: "attack", players: [] },
];

describe("Pitch", () => {
  it("draws on the pitch background", () => {
    const html = renderToStaticMarkup(<Pitch lines={emptyLines()} />);
    expect(html).toContain("/pitch.svg");
  });

  it("reverses the DOM so the keeper reads at the foot of the pitch", () => {
    // Lines arrive keeper-first (the order a screen reader should hear); the CSS
    // reverses it so the pitch shows the keeper at the foot with the attack running up.
    const html = renderToStaticMarkup(<Pitch lines={emptyLines()} />);
    expect(html).toContain("flex-col-reverse");
    expect(html.indexOf('data-line="keeper"')).toBeLessThan(html.indexOf('data-line="attack"'));
  });

  it("gives every line supplied its own row, using the caller's own vocabulary", () => {
    const html = renderToStaticMarkup(<Pitch lines={emptyLines()} />);
    expect(html.match(/data-line="/g)).toHaveLength(4);
  });

  it("links a player's face and name to their own page", () => {
    const lines = emptyLines();
    lines[0].players = [player({ id: "38126770" })];
    const html = renderToStaticMarkup(<Pitch lines={lines} />);
    expect(html).toContain('href="/players/38126770"');
    // The face is inside the link, not beside it: on a phone the thumb aims at the shirt.
    const link = html.slice(html.indexOf("<a "), html.indexOf("</a>"));
    expect(link).toContain("Courtois");
  });

  it("draws a portrait with an empty alt, the name being right underneath", () => {
    const lines = emptyLines();
    lines[0].players = [
      player({ imageUrl: "https://assets-fantasy.llt-services.com/players/1.png" }),
    ];
    const html = renderToStaticMarkup(<Pitch lines={lines} />);
    expect(html).toContain("<img");
    expect(html).toMatch(/<img[^>]*alt=""/);
  });

  it("falls back to initials for a player with no portrait", () => {
    const lines = emptyLines();
    lines[0].players = [player({ nickname: "D. Cárdenas", imageUrl: null })];
    const html = renderToStaticMarkup(<Pitch lines={lines} />);
    expect(html).toContain("DC");
  });

  it("prints the figure verbatim — formatting is the caller's business", () => {
    const lines = emptyLines();
    lines[0].players = [player({ figure: "10.4 avg" })];
    const html = renderToStaticMarkup(<Pitch lines={lines} />);
    expect(html).toContain("10.4 avg");
  });

  it("paints a gaining figure green and a losing one red", () => {
    // A round of eleven numbers is scanned, not read: the sign is what the manager is
    // looking for, and the colour is what lets them find it without reading all eleven.
    const lines = emptyLines();
    lines[0].players = [player({ figure: "12", tone: "gain" })];
    lines[1].players = [player({ id: "p2", figure: "-4", tone: "loss" })];
    const html = renderToStaticMarkup(<Pitch lines={lines} />);
    expect(html).toContain("color:var(--board-gain)");
    expect(html).toContain("color:var(--board-alert)");
  });

  it("paints a flat figure in plain ink, brighter than the dim it defaults to", () => {
    // Zero is not a loss and not a gain. It gets the page's own ink so it reads as a
    // score that happened rather than one the portal could not work out.
    const lines = emptyLines();
    lines[0].players = [player({ figure: "0", tone: "flat" })];
    const html = renderToStaticMarkup(<Pitch lines={lines} />);
    expect(html).toContain("color:var(--board-ink)");
  });

  it("leaves a figure with no tone dim, because not every figure has a sign", () => {
    // The lineup board prints "—" for an average it has not measured. An unmeasured
    // figure is not a zero, and colouring it would say something the caller never said.
    const lines = emptyLines();
    lines[0].players = [player({ figure: "—" })];
    const html = renderToStaticMarkup(<Pitch lines={lines} />);
    expect(html).toContain("color:var(--board-ink-dim)");
  });

  it("renders zero or more marks, each with its own accessible name", () => {
    const lines = emptyLines();
    lines[0].players = [
      player({
        marks: [
          { symbol: "★", label: "Made the round's ideal eleven" },
          { symbol: "!", label: "Doubtful" },
        ],
      }),
    ];
    const html = renderToStaticMarkup(<Pitch lines={lines} />);
    expect(html).toMatch(/role="img"\s+aria-label="[^"]*ideal eleven[^"]*"/);
    expect(html).toMatch(/role="img"\s+aria-label="Doubtful"/);
  });

  it("renders no mark markup for a player with none", () => {
    const lines = emptyLines();
    lines[0].players = [player()];
    const html = renderToStaticMarkup(<Pitch lines={lines} />);
    expect(html).not.toContain('role="img"');
  });
});
