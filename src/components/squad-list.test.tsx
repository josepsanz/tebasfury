import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { squadByPosition, squadValue, type CatalogueRow } from "@/lib/domain/players";
import { SquadList } from "./squad-list";

const p = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id, nickname: id, position: "Midfielder", status: "ok",
  currentValue: 2_000_000, seasonPoints: 12, averagePoints: null, gameweeksRecorded: 0,
  ownerTeamId: "t1", ownerName: "Ada", clubName: null, buyoutClause: null, clauseLockedUntil: null, shielded: false, ...over,
});

const render = (rows: CatalogueRow[], ownershipKnown = true) => {
  const groups = squadByPosition(rows, "t1");
  return renderToStaticMarkup(
    <SquadList groups={groups} total={squadValue(groups)} ownershipKnown={ownershipKnown} />,
  );
};

describe("SquadList", () => {
  it("lists the players, grouped by position, each linking to their page", () => {
    const html = render([p("Ada"), p("Bo", { position: "Goalkeeper" })]);
    expect(html).toContain("Goalkeeper");
    expect(html).toContain("Midfielder");
    expect(html).toContain('href="/players/Ada"');
    expect(html).toContain('href="/players/Bo"');
  });

  it("counts the squad and totals its value", () => {
    const html = render([p("a"), p("b")]);
    expect(html).toContain("2 players");
    expect(html).toContain("4.0M at today");
    expect(html).toContain("values");
  });

  it("pluralises one player correctly", () => {
    expect(render([p("a")])).toContain("1 player ");
  });

  it("says the value is not fully recorded rather than under-reporting it", () => {
    // A total that quietly omits an unpriced player reads as the squad being cheaper
    // than it is.
    const html = render([p("a"), p("b", { currentValue: null })]);
    expect(html).toContain("value not fully recorded");
    expect(html).not.toContain("at today");
  });

  it("shows a player's club and their availability when there is something to say", () => {
    const html = render([p("a", { clubName: "Celta", status: "injured" })]);
    expect(html).toContain("Celta");
    expect(html).toContain("Injured");
  });

  it("says nothing about availability for a fit player", () => {
    expect(render([p("a", { status: "ok" })])).not.toContain("var(--board-alert)");
  });

  it("tells an empty squad apart from a portal that has read no squads at all", () => {
    // Before the first sweep, "no players" would be a claim about the manager rather
    // than about what we know.
    expect(render([], false)).toContain("No squad has been read yet");
    expect(render([], true)).toContain("No players recorded for this manager");
  });
});

describe("SquadList, clause protection", () => {
  const withProtection = (until: Map<string, Date | null>) => {
    const groups = squadByPosition([p("Ada"), p("Bo")], "t1");
    return renderToStaticMarkup(
      <SquadList
        groups={groups}
        total={squadValue(groups)}
        ownershipKnown
        protectedUntil={until}
      />,
    );
  };

  it("says how long a protected player is safe for", () => {
    const html = withProtection(new Map([["Ada", new Date("2026-09-20T10:00:00Z")]]));
    expect(html).toContain("safe until");
    expect(html).toContain("20 Sept");
  });

  it("marks only the locked, never the takeable", () => {
    // Saying "takeable" beside most of a squad would be noise; the market's clause board
    // is where that side is read.
    const html = withProtection(new Map([["Ada", new Date("2026-09-20T10:00:00Z")], ["Bo", null]]));
    expect(html.match(/safe until/g)).toHaveLength(1);
  });

  it("marks nobody when the caller has not worked protection out", () => {
    const groups = squadByPosition([p("Ada")], "t1");
    const html = renderToStaticMarkup(
      <SquadList groups={groups} total={squadValue(groups)} ownershipKnown />,
    );
    expect(html).not.toContain("safe until");
  });
});
