import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogueRow } from "@/lib/domain/players";
import type { ClauseStatus } from "@/lib/domain/market";
import { paginateCatalogue, PlayerCatalogue } from "./player-catalogue";

const row = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id,
  nickname: `Player ${id}`,
  position: "Midfielder",
  status: "ok",
  currentValue: 12_400_000,
  seasonPoints: 40,
  averagePoints: 10,
  gameweeksRecorded: 4,
  ownerTeamId: "t1",
  ownerName: "Manager A",
  clubName: null,
  ...over,
});

describe("PlayerCatalogue", () => {
  it("lists players with their value, points and owner", () => {
    const html = renderToStaticMarkup(
      <PlayerCatalogue rows={[row("p1", { nickname: "Ada" })]} ownershipKnown />,
    );
    expect(html).toContain("Ada");
    expect(html).toContain("12.4M");
    expect(html).toContain("40");
    expect(html).toContain("Manager A");
  });

  it("says a free agent is free", () => {
    const html = renderToStaticMarkup(
      <PlayerCatalogue
        rows={[row("p1", { ownerTeamId: null, ownerName: null })]}
        ownershipKnown
      />,
    );
    expect(html).toContain("Free agent");
  });

  it("does not call anyone free before the squads have been read", () => {
    // Before a sweep reads the squads every player is unowned in the database. Saying
    // "free agent" then would be a claim the portal cannot make.
    const html = renderToStaticMarkup(
      <PlayerCatalogue
        rows={[row("p1", { ownerTeamId: null, ownerName: null })]}
        ownershipKnown={false}
      />,
    );
    expect(html).not.toContain("Free agent");
    expect(html).toContain("Owners not swept yet");
  });

  it("surfaces a player who is not available, and stays quiet when they are", () => {
    const injured = renderToStaticMarkup(
      <PlayerCatalogue rows={[row("p1", { status: "injured" })]} ownershipKnown />,
    );
    expect(injured).toContain("Injured");

    const fine = renderToStaticMarkup(<PlayerCatalogue rows={[row("p1")]} ownershipKnown />);
    // The status renders as " · <status>", and matching that rather than a bare "ok"
    // keeps the test from passing or failing on some unrelated word in the markup.
    expect(fine).not.toContain(" · ok");
  });

  it("falls back to the raw status for a value outside the known five", () => {
    // Task 1 named five real status values, and this project translates every one of
    // them to proper English. A sixth value that shows up later must still be visible
    // rather than silently vanish, which is exactly what the `?? row.status` fallback
    // is for.
    const html = renderToStaticMarkup(
      <PlayerCatalogue rows={[row("p1", { status: "benched" })]} ownershipKnown />,
    );
    expect(html).toContain("benched");
  });

  it("shows a player with no snapshot yet as an absence, not as nothing owed", () => {
    const html = renderToStaticMarkup(
      <PlayerCatalogue
        rows={[row("p1", { currentValue: null, seasonPoints: 0, averagePoints: null })]}
        ownershipKnown
      />,
    );
    expect(html).toContain("—");
    expect(html).not.toContain("0.0M");
    expect(html).not.toContain("0.0 avg");
  });

  it("caps the list and says how much it is not showing", () => {
    const many = Array.from({ length: 90 }, (_, i) => row(`p${i}`));
    const html = renderToStaticMarkup(<PlayerCatalogue rows={many} ownershipKnown />);
    expect(html).toContain("Showing 60 of 90");
    expect(html).toContain("Show 60 more");
  });

  it("invites the first sweep when there is nothing to list", () => {
    const html = renderToStaticMarkup(<PlayerCatalogue rows={[]} ownershipKnown={false} />);
    expect(html).toContain("No players have been swept yet");
  });

  it("links each player to their own page", () => {
    const html = renderToStaticMarkup(<PlayerCatalogue rows={[row("p1")]} ownershipKnown />);
    expect(html).toContain('href="/players/p1"');
  });

  it("leads a row with its club, and falls back to the position without one", () => {
    // Rulings 4 and 5: the club takes the position's place on the meta line, and hands
    // it back when no squad response has named the club yet.
    const html = renderToStaticMarkup(
      <PlayerCatalogue
        rows={[
          row("p1", { nickname: "Ada", clubName: "Real Betis", position: "Forward" }),
          row("p2", { nickname: "Bo", clubName: null, position: "Goalkeeper" }),
        ]}
        ownershipKnown
      />,
    );
    // Asserted against the whole meta line, not the bare words: "Forward" and
    // "Goalkeeper" are also two of the fixed position filter pills, so a document-wide
    // `not.toContain("Forward")` can never pass however the row renders.
    expect(html).toContain("Real Betis · Manager A");
    expect(html).not.toContain("Forward · Manager A");
    expect(html).toContain("Goalkeeper · Manager A");
  });

  it("opens on the sort and ownership it was given, not on the defaults", () => {
    // This is what makes the home page's links land somewhere: the catalogue's opening
    // view comes from the URL, read on the server and handed down as props.
    const html = renderToStaticMarkup(
      <PlayerCatalogue rows={[row("p1")]} ownershipKnown initialSort="perMillion" initialOwnership="free" />,
    );
    // Asserted through the control's own state rather than a copy of its markup: the
    // previous version of this test pasted the pill's exact class and style strings, so
    // restyling the control broke it while the behaviour it guards was untouched.
    expect(html).toMatch(/<option value="perMillion"[^>]*selected/);
    expect(html).toMatch(/<option value="free"[^>]*selected/);
    expect(html).not.toMatch(/<option value="value"[^>]*selected/);
  });

});

describe("paginateCatalogue", () => {
  // The component's own filter state cannot be driven through renderToStaticMarkup
  // (there is no click or keystroke without a DOM library), so the property the
  // count line depends on — that it reports the FILTERED length, not the raw input
  // length — is proven here instead, by calling the pure function with a filter that
  // actually narrows the input. See the doc comment on paginateCatalogue.
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row(`f${i}`, { position: "Forward" })),
    ...Array.from({ length: 4 }, (_, i) => row(`m${i}`, { position: "Midfielder" })),
  ];

  it("reports the count of the filtered list, not the count of the input", () => {
    const { total, page } = paginateCatalogue(
      rows,
      { query: "", position: "Forward", ownership: "all" },
      "name",
      60,
    );
    // 6 Forwards out of 10 rows: a `total` that came from `rows.length` instead of
    // the filtered list would read 10 here, not 6.
    expect(total).toBe(6);
    expect(total).not.toBe(rows.length);
    expect(page).toHaveLength(6);
  });

  it("still pages the filtered list once it is narrower than one page", () => {
    const { total, page } = paginateCatalogue(
      rows,
      { query: "", position: "Forward", ownership: "all" },
      "name",
      3,
    );
    expect(total).toBe(6);
    expect(page).toHaveLength(3);
  });
});

/** One player, rendered with whatever clause states the case needs. */
const catalogue = ({ clauses }: { clauses?: Record<string, ClauseStatus> }) =>
  renderToStaticMarkup(
    <PlayerCatalogue rows={[row("p1", { nickname: "Ada" })]} ownershipKnown clauses={clauses} />,
  );

describe("PlayerCatalogue, clause state", () => {
  const takeable = { state: "takeable" as const, label: "takeable" };
  const soon = { state: "soon" as const, label: "free in 8 hours" };
  const locked = { state: "locked" as const, label: "locked until 14 Sept" };

  it("says when a lock lifts, in words and not only in colour", () => {
    const html = catalogue({ clauses: { p1: locked } });
    expect(html).toContain("locked until 14 Sept");
  });

  it("draws a padlock only on a locked player, so colour is not the only channel", () => {
    // A reader who cannot separate the greens from the grey still sees a padlock or none.
    expect(catalogue({ clauses: { p1: locked } })).toContain("<svg");
    expect(catalogue({ clauses: { p1: takeable } })).not.toContain("<svg");
    expect(catalogue({ clauses: { p1: soon } })).not.toContain("<svg");
  });

  it("writes no words beside a takeable player, which would be most of the catalogue", () => {
    const html = catalogue({ clauses: { p1: takeable } });
    expect(html).not.toContain("takeable<");
  });

  it("never spends the portal's amber on a clause state", () => {
    // Amber means "your team" and nothing else; a colour meaning two things means neither.
    for (const clause of [takeable, soon, locked]) {
      expect(catalogue({ clauses: { p1: clause } })).not.toContain("--board-you");
    }
  });

  it("leaves a player with no clause state alone", () => {
    const html = catalogue({});
    expect(html).not.toContain("locked until");
    expect(html).not.toContain("<svg");
  });
});
