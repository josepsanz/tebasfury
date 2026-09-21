import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VoteTally } from "@/lib/domain/necroporra";
import { Hated, Haters, MostHated } from "./necroporra-hate";

const tally = (name: string, votes: number): VoteTally => ({ teamId: name.toLowerCase(), name, votes });

describe("MostHated", () => {
  it("names the team the league picks on, in a sentence and not only a table", () => {
    const html = renderToStaticMarkup(
      <MostHated rows={[tally("Chus", 3), tally("Bruno", 1), tally("Ada", 0)]} viewerTeamId={null} />,
    );
    expect(html).toContain("The league has named Chus more than anyone: 3 votes.");
  });

  it("names everybody tied at the top, because a tie has no single leader", () => {
    const html = renderToStaticMarkup(
      <MostHated rows={[tally("Bruno", 2), tally("Chus", 2), tally("Ada", 0)]} viewerTeamId={null} />,
    );
    expect(html).toContain("The league has named Bruno and Chus more than anyone: 2 votes each.");
  });

  it("says nobody has been named rather than crowning a team on nought", () => {
    // Every team sits on nought before the first round is voted. Calling one of them the
    // most hated would be an accusation the data has not made.
    const html = renderToStaticMarkup(
      <MostHated rows={[tally("Ada", 0), tally("Bruno", 0)]} viewerTeamId={null} />,
    );
    expect(html).toContain("Nobody has been named yet.");
    expect(html).not.toContain("more than anyone");
  });

  it("lists every team, including the ones nobody has ever named", () => {
    const html = renderToStaticMarkup(
      <MostHated rows={[tally("Chus", 3), tally("Ada", 0)]} viewerTeamId={null} />,
    );
    expect(html).toContain("Ada");
  });

  it("marks the reader's own row, which is the one they came to find", () => {
    const html = renderToStaticMarkup(
      <MostHated rows={[tally("Chus", 3), tally("Ada", 0)]} viewerTeamId="ada" />,
    );
    expect(html).toContain("--board-you");
  });
});

describe("Haters", () => {
  it("ranks whoever has picked you, most often first", () => {
    const html = renderToStaticMarkup(<Haters rows={[tally("Ada", 2), tally("Bruno", 1)]} />);
    expect(html.indexOf("Ada")).toBeLessThan(html.indexOf("Bruno"));
    expect(html).toContain("2");
  });

  it("says nobody has named you, which is a result and not an empty table", () => {
    expect(renderToStaticMarkup(<Haters rows={[]} />)).toContain("Nobody has named you yet.");
  });
});

describe("Hated", () => {
  it("lists the teams the reader names, most often first", () => {
    const html = renderToStaticMarkup(
      <Hated rows={[tally("Chus", 4), tally("Bruno", 1)]} />,
    );
    expect(html).toContain("Chus");
    expect(html).toContain("Bruno");
    expect(html.indexOf("Chus")).toBeLessThan(html.indexOf("Bruno"));
  });

  it("says the reader has named nobody rather than drawing an empty table", () => {
    const html = renderToStaticMarkup(<Hated rows={[]} />);
    expect(html).toContain("You have not named anybody yet.");
    expect(html).not.toContain("<ol");
  });
});

describe("the boards read for somebody other than the reader", () => {
  it("says nobody has named that manager, by name", () => {
    expect(renderToStaticMarkup(<Haters rows={[]} subject="Chus" />)).toContain(
      "Nobody has named Chus yet.",
    );
  });

  it("says that manager has named nobody, by name", () => {
    expect(renderToStaticMarkup(<Hated rows={[]} subject="Chus" />)).toContain(
      "Chus has not named anybody yet.",
    );
  });

  it("still addresses the reader directly when the boards are their own", () => {
    // "you" is the whole point of these two boards when they are yours. A page that said
    // "Ada has not named anybody yet" to Ada would be talking about her behind her back.
    expect(renderToStaticMarkup(<Haters rows={[]} />)).toContain("Nobody has named you yet.");
    expect(renderToStaticMarkup(<Hated rows={[]} />)).toContain(
      "You have not named anybody yet.",
    );
  });
});
