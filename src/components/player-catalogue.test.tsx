import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogueRow } from "@/lib/domain/players";
import { PlayerCatalogue } from "./player-catalogue";

const row = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id,
  nickname: `Player ${id}`,
  position: "Midfielder",
  status: "ok",
  currentValue: 12_400_000,
  seasonPoints: 40,
  averagePoints: 10,
  ownerTeamId: "t1",
  ownerName: "Manager A",
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

  it("shows a player with no snapshot yet as an absence, not as nothing owed", () => {
    const html = renderToStaticMarkup(
      <PlayerCatalogue
        rows={[row("p1", { currentValue: null, seasonPoints: 0, averagePoints: null })]}
        ownershipKnown
      />,
    );
    expect(html).toContain("—");
    expect(html).not.toContain("0.0M");
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
});
