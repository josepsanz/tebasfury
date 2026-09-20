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
      <BreakfastLine duty={{ gameweek: 5, bringers: ["t1"], shielded: [], provisional: false }} gameweek={5} names={names} />,
    );
    expect(html).toContain("Round 5: LILTEAM brings breakfast.");
  });

  it("names every team when they tie, because every one of them brings it", () => {
    const html = renderToStaticMarkup(
      <BreakfastLine duty={{ gameweek: 5, bringers: ["t1", "t2"], shielded: [], provisional: false }} gameweek={5} names={names} />,
    );
    expect(html).toContain("Round 5: LILTEAM and TheMessias bring breakfast.");
  });

  it("reads as a person's list when three or more tie", () => {
    const html = renderToStaticMarkup(
      <BreakfastLine
        duty={{ gameweek: 5, bringers: ["t1", "t2", "t3"], shielded: [], provisional: false }}
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
      <BreakfastLine duty={{ gameweek: 5, bringers: ["gone"], shielded: [], provisional: false }} gameweek={5} names={names} />,
    );
    // The whole sentence, not just the id: a fallback that printed the id somewhere other
    // than the subject of the sentence would still pass a `toContain`.
    expect(html).toContain("Round 5: gone brings breakfast.");
  });

  describe("a round still being played", () => {
    const provisional = (over = {}) => ({
      gameweek: 6,
      bringers: ["t1"],
      shielded: [],
      provisional: true as const,
      ...over,
    });

    it("says the name is provisional and will move", () => {
      const html = renderToStaticMarkup(
        <BreakfastLine duty={provisional()} gameweek={6} names={names} />,
      );
      expect(html).toContain(
        "Provisional: as it stands, LILTEAM brings breakfast, and that changes while the round is played.",
      );
    });

    it("uses the plural when several are level at the bottom so far", () => {
      const html = renderToStaticMarkup(
        <BreakfastLine duty={provisional({ bringers: ["t1", "t2"] })} gameweek={6} names={names} />,
      );
      // The whole sentence: "… bring breakfast" alone is a substring of the settled
      // branch too, so a test asserting only that would pass without this branch existing.
      expect(html).toContain(
        "Provisional: as it stands, LILTEAM and TheMessias bring breakfast, and that changes while the round is played.",
      );
    });

    it("names the shielded teams, which the finished rounds already settled", () => {
      const html = renderToStaticMarkup(
        <BreakfastLine
          duty={provisional({ shielded: [{ teamId: "t3", roundsLeft: 2 }, { teamId: "t2", roundsLeft: 1 }] })}
          gameweek={6}
          names={names}
        />,
      );
      // Alphabetical, not the order the duty arrived in: row order from the database is
      // undefined, so an unsorted sentence would swap the two names between loads.
      expect(html).toContain("TheMessias and Villaone are shielded for round 6.");
    });

    it("says nothing about shields when nobody is covered", () => {
      const html = renderToStaticMarkup(
        <BreakfastLine duty={provisional()} gameweek={6} names={names} />,
      );
      expect(html).not.toContain("shielded");
    });

    it("refuses to name anybody before a point has been scored", () => {
      const html = renderToStaticMarkup(
        <BreakfastLine duty={provisional({ bringers: [] })} gameweek={6} names={names} />,
      );
      expect(html).toContain("Nobody has scored in round 6 yet, so there is no last place to name.");
      expect(html).not.toContain("brings breakfast");
    });

    it("still names the shielded teams before a point has been scored", () => {
      // The half that carries no disclaimer has to survive the half that does.
      const html = renderToStaticMarkup(
        <BreakfastLine
          duty={provisional({ bringers: [], shielded: [{ teamId: "t3", roundsLeft: 2 }] })}
          gameweek={6}
          names={names}
        />,
      );
      expect(html).toContain("Villaone is shielded for round 6.");
    });

    it("falls back to the id in the shield sentence too", () => {
      const html = renderToStaticMarkup(
        <BreakfastLine
          duty={provisional({ shielded: [{ teamId: "gone", roundsLeft: 1 }] })}
          gameweek={6}
          names={names}
        />,
      );
      expect(html).toContain("gone is shielded for round 6.");
    });
  });
});
