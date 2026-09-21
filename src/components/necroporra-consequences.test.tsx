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
    const html = render({ apologists: [], denigrations: [], winnerTeamIds: [] });
    expect(html).toContain("owe the league an apology");
    expect(html).toContain("denigrating message");
  });

  it("names the apologist and the winner they picked, both by name", () => {
    const html = render({ apologists: ["b"], denigrations: [], winnerTeamIds: ["a"] });
    expect(html).toContain(
      "Ada won the round. Bruno named them for last, and owes the league an apology.",
    );
  });

  it("names every apologist when several called it wrong", () => {
    const html = render({ apologists: ["b", "d"], denigrations: [], winnerTeamIds: ["a"] });
    expect(html).toContain(
      "Ada won the round. Bruno and Dídac named them for last, and owe the league an apology.",
    );
  });

  it("says nobody named the winner rather than leaving a gap", () => {
    // A round where everybody called the bottom sensibly is a result, not a blank.
    const html = render({ apologists: [], denigrations: [], winnerTeamIds: ["a"] });
    expect(html).toContain("Ada won the round. Nobody named them for last.");
  });

  it("passes no verdict on a round that is not decided", () => {
    // The rules stay written down; the accusation does not appear before there is one.
    const html = render({ apologists: [], denigrations: [], winnerTeamIds: [] });
    expect(html).not.toContain("Nobody named");
    expect(html).not.toContain("won the round.");
  });

  it("falls back to the id rather than printing an empty name", () => {
    const html = render({ apologists: ["gone"], denigrations: [], winnerTeamIds: ["a"] });
    expect(html).toContain("Ada won the round. gone named them for last,");
  });

  it("names every co-leader, because the owner ruled they count equally", () => {
    // The API hands one of two level teams first place by a rule it does not publish.
    // Naming either of them is naming a winner, and the line says both.
    const html = render({ apologists: ["c"], denigrations: [], winnerTeamIds: ["a", "b"] });
    expect(html).toContain(
      "Ada and Bruno won the round together. Chus named one of them for last, and owes the league an apology.",
    );
  });

  it("says who earned the right to denigrate, over whom, and why", () => {
    // Both halves in one sentence, because this is the line that gets screenshotted into
    // the group chat on its own and has to make sense with nothing above it.
    const html = render({
      apologists: [],
      denigrations: [{ senderTeamId: "a", targetTeamIds: ["c"] }],
      winnerTeamIds: ["a"],
    });
    expect(html).toContain(
      "Ada won the round and named Chus for last, so Ada may send Chus a denigrating message.",
    );
  });

  it("says them all when a winner called both teams level at the bottom", () => {
    const html = render({
      apologists: [],
      denigrations: [{ senderTeamId: "a", targetTeamIds: ["c", "d"] }],
      winnerTeamIds: ["a"],
    });
    expect(html).toContain(
      "Ada won the round and named Chus and Dídac for last, so Ada may send them all a denigrating message.",
    );
  });

  it("gives each co-leader their own sentence, over the team they named themselves", () => {
    const html = render({
      apologists: [],
      denigrations: [
        { senderTeamId: "a", targetTeamIds: ["c"] },
        { senderTeamId: "b", targetTeamIds: ["d"] },
      ],
      winnerTeamIds: ["a", "b"],
    });
    expect(html).toContain("Ada won the round and named Chus for last");
    expect(html).toContain("Bruno won the round and named Dídac for last");
  });

  it("passes no denigration verdict in a round nobody earned one", () => {
    // The RULE still says "you may send that team a denigrating message" — it is printed
    // every week, earned or not. What must not appear is the verdict.
    const html = render({ apologists: ["b"], denigrations: [], winnerTeamIds: ["a"] });
    expect(html).not.toContain("won the round and named");
  });
});
