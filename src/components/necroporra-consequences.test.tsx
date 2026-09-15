import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoundConsequences } from "@/lib/domain/necroporra";
import { NecroporraConsequences } from "./necroporra-consequences";

const names = new Map([
  ["a", "Ada"],
  ["b", "Bruno"],
  ["c", "Chus"],
  ["d", "Dídac"],
]);

const render = (consequences: RoundConsequences) =>
  renderToStaticMarkup(<NecroporraConsequences consequences={consequences} names={names} />);

describe("NecroporraConsequences", () => {
  it("writes both rules down, so nobody has to remember them", () => {
    const html = render({ apologists: [], hateTarget: null, winnerTeamId: null });
    expect(html).toContain("owe the league an apology");
    expect(html).toContain("hate message");
  });

  it("names the apologist and the winner they picked, both by name", () => {
    const html = render({ apologists: ["b"], hateTarget: null, winnerTeamId: "a" });
    expect(html).toContain("Bruno named Ada, who went on to win the round. They owe the league an apology.");
  });

  it("names every apologist when several called it wrong", () => {
    const html = render({ apologists: ["b", "d"], hateTarget: null, winnerTeamId: "a" });
    expect(html).toContain(
      "Bruno and Dídac named Ada, who went on to win the round. They owe the league an apology.",
    );
  });

  it("says who sends the hate message and who receives it", () => {
    const html = render({ apologists: ["d"], hateTarget: "d", winnerTeamId: "a" });
    expect(html).toContain("Dídac finished last as well, so Ada sends them a hate message.");
  });

  it("says nobody named the winner rather than leaving a gap", () => {
    // A round where everybody called the bottom sensibly is a result, not a blank.
    const html = render({ apologists: [], hateTarget: null, winnerTeamId: "a" });
    expect(html).toContain("Nobody named Ada for last.");
  });

  it("passes no verdict on a round that is not decided", () => {
    // The rules stay written down; the accusation does not appear before there is one.
    const html = render({ apologists: [], hateTarget: null, winnerTeamId: null });
    expect(html).not.toContain("Nobody named");
    expect(html).not.toContain("went on to win");
  });

  it("falls back to the id rather than printing an empty name", () => {
    const html = render({ apologists: ["gone"], hateTarget: null, winnerTeamId: "a" });
    expect(html).toContain("gone named Ada, who went on to win the round.");
  });
});
