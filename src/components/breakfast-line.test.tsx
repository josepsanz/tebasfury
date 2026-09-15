import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BreakfastLine } from "./breakfast-line";

const names = new Map([
  ["t1", "LILTEAM"],
  ["t2", "TheMessias"],
  ["t3", "Villaone"],
]);

describe("BreakfastLine", () => {
  it("names the team that brings it", () => {
    const html = renderToStaticMarkup(
      <BreakfastLine duty={{ gameweek: 5, bringers: ["t1"], shielded: [] }} gameweek={5} names={names} />,
    );
    expect(html).toContain("Round 5: LILTEAM brings breakfast.");
  });

  it("names every team when they tie, because every one of them brings it", () => {
    const html = renderToStaticMarkup(
      <BreakfastLine duty={{ gameweek: 5, bringers: ["t1", "t2"], shielded: [] }} gameweek={5} names={names} />,
    );
    expect(html).toContain("Round 5: LILTEAM and TheMessias bring breakfast.");
  });

  it("reads as a person's list when three or more tie", () => {
    const html = renderToStaticMarkup(
      <BreakfastLine
        duty={{ gameweek: 5, bringers: ["t1", "t2", "t3"], shielded: [] }}
        gameweek={5}
        names={names}
      />,
    );
    expect(html).toContain("Round 5: LILTEAM, TheMessias and Villaone bring breakfast.");
  });

  it("says a round is still being played rather than inventing a duty", () => {
    const html = renderToStaticMarkup(<BreakfastLine duty={null} gameweek={6} names={names} />);
    expect(html).toContain("Round 6 is still being played.");
  });

  it("falls back to the id rather than printing an empty name", () => {
    const html = renderToStaticMarkup(
      <BreakfastLine duty={{ gameweek: 5, bringers: ["gone"], shielded: [] }} gameweek={5} names={names} />,
    );
    // The whole sentence, not just the id: a fallback that printed the id somewhere other
    // than the subject of the sentence would still pass a `toContain`.
    expect(html).toContain("Round 5: gone brings breakfast.");
  });
});
