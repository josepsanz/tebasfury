import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import type { CatalogueRow } from "@/lib/domain/players";
import { OpportunityBoard } from "./opportunity-board";

const row = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id,
  nickname: `Player ${id}`,
  position: "Midfielder",
  status: "ok",
  currentValue: 2_000_000,
  seasonPoints: 20,
  averagePoints: 5,
  gameweeksRecorded: 4,
  ownerTeamId: null,
  ownerName: null,
  clubName: "Celta",
  ...over,
});

type BoardProps = ComponentProps<typeof OpportunityBoard>;

const board = (rows: CatalogueRow[], over: Partial<BoardProps> = {}) =>
  renderToStaticMarkup(
    <OpportunityBoard
      title="Best value for money"
      note="Points per million of market value."
      rows={rows}
      emptyNote="No player has three recorded gameweeks yet."
      figure={() => ({ value: "7.4", unit: "pts/M€" })}
      link={{ href: "/players?sort=perMillion", label: "All players by value for money" }}
      ownershipKnown
      {...over}
    />,
  );

describe("OpportunityBoard", () => {
  it("renders a row's club, owner and figure", () => {
    const html = board([row("p1", { nickname: "Ada", clubName: "Celta", ownerTeamId: "t1", ownerName: "Manager B" })]);
    expect(html).toContain("Ada");
    expect(html).toContain("Celta");
    expect(html).toContain("Manager B");
    expect(html).toContain("7.4");
    expect(html).toContain("pts/M€");
  });

  it("shows an unavailable player's status rather than dropping them", () => {
    // Ruling 5, the owner's explicit call: nobody disappears from the board, and the
    // status is what stops that being misleading. This test is the cost being paid
    // out loud, so a later reader cannot mistake it for an oversight.
    const html = board([row("p1", { nickname: "Ada", status: "injured" })]);
    expect(html).toContain("Ada");
    expect(html).toContain("Injured");
  });

  it("renders its empty note and no list when there are no rows", () => {
    const html = board([]);
    expect(html).toContain("No player has three recorded gameweeks yet.");
    expect(html).not.toContain("<ol");
  });

  it("says ownership has not been read, instead of calling anyone free", () => {
    // Ruling 6. An absent owner row means "we have not looked" until a squad has been
    // read, and this is the easiest place in the portal to state the wrong one.
    const html = board([row("p1", { nickname: "Ada" })], {
      ownershipKnown: false,
      unknownOwnershipNote: "No squad has been read yet, so nobody can be called free.",
    });
    expect(html).toContain("No squad has been read yet, so nobody can be called free.");
    expect(html).not.toContain("Ada");
  });

  it("links where it was told to", () => {
    const html = board([row("p1")]);
    expect(html).toContain('href="/players?sort=perMillion"');
    expect(html).toContain("All players by value for money");
  });

  it("omits the link entirely when the page passes none", () => {
    // The page omits `link` before the first sweep, when the catalogue itself is
    // empty — a "see all" pointing at a catalogue that says nothing has been swept is
    // worse than no link at all.
    const html = board([row("p1")], { link: undefined });
    expect(html).not.toContain("href=\"/players?sort=perMillion\"");
    expect(html).not.toContain("All players by value for money");
  });

  it("says owners are not swept yet on a board that is not blocked", () => {
    // The value board gets no `unknownOwnershipNote` — Ruling 6 is a claim about
    // ownership, which this board makes none of. So it renders rows, and each row
    // must say the owner is unknown rather than calling anyone free.
    const html = board([row("p1", { ownerTeamId: null, ownerName: null })], { ownershipKnown: false });
    expect(html).toContain("Owners not swept yet");
    expect(html).not.toContain("Free agent");
  });

  it("calls an unowned player free once a squad has been read", () => {
    expect(board([row("p1", { ownerTeamId: null, ownerName: null })])).toContain("Free agent");
  });
});
