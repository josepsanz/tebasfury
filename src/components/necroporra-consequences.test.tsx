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
    const html = render({ apologists: [], hateTargets: [], winnerTeamIds: [] });
    expect(html).toContain("owe the league an apology");
    expect(html).toContain("hate message");
  });

  it("names the apologist and the winner they picked, both by name", () => {
    const html = render({ apologists: ["b"], hateTargets: [], winnerTeamIds: ["a"] });
    expect(html).toContain(
      "Ada won the round. Bruno named them for last, and owes the league an apology.",
    );
  });

  it("names every apologist when several called it wrong", () => {
    const html = render({ apologists: ["b", "d"], hateTargets: [], winnerTeamIds: ["a"] });
    expect(html).toContain(
      "Ada won the round. Bruno and Dídac named them for last, and owe the league an apology.",
    );
  });

  it("says who sends the hate message and who receives it", () => {
    const html = render({ apologists: ["d"], hateTargets: ["d"], winnerTeamIds: ["a"] });
    expect(html).toContain("Dídac finished last as well, so Ada sends them a hate message.");
  });

  it("says nobody named the winner rather than leaving a gap", () => {
    // A round where everybody called the bottom sensibly is a result, not a blank.
    const html = render({ apologists: [], hateTargets: [], winnerTeamIds: ["a"] });
    expect(html).toContain("Ada won the round. Nobody named them for last.");
  });

  it("passes no verdict on a round that is not decided", () => {
    // The rules stay written down; the accusation does not appear before there is one.
    const html = render({ apologists: [], hateTargets: [], winnerTeamIds: [] });
    expect(html).not.toContain("Nobody named");
    expect(html).not.toContain("won the round.");
  });

  it("falls back to the id rather than printing an empty name", () => {
    const html = render({ apologists: ["gone"], hateTargets: [], winnerTeamIds: ["a"] });
    expect(html).toContain("Ada won the round. gone named them for last,");
  });

  it("names every co-leader, because the owner ruled they count equally", () => {
    // The API hands one of two level teams first place by a rule it does not publish.
    // Naming either of them is naming a winner, and the line says both.
    const html = render({ apologists: ["c"], hateTargets: [], winnerTeamIds: ["a", "b"] });
    expect(html).toContain(
      "Ada and Bruno won the round together. Chus named one of them for last, and owes the league an apology.",
    );
  });

  it("has both co-leaders send the hate message", () => {
    const html = render({ apologists: ["c"], hateTargets: ["c"], winnerTeamIds: ["a", "b"] });
    expect(html).toContain("Chus finished last as well, so Ada and Bruno send them a hate message.");
  });

  it("sends the hate message to everyone level at the bottom who named a winner", () => {
    // Both halves of a tie can owe it. The sentence says "them all" so nobody reads it as
    // one message shared between two people.
    const html = render({
      apologists: ["c", "d"],
      hateTargets: ["c", "d"],
      winnerTeamIds: ["a"],
    });
    expect(html).toContain(
      "Chus and Dídac finished last as well, so Ada sends them all a hate message.",
    );
  });
});
