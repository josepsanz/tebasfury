import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { squadByPosition, squadValue, type CatalogueRow } from "@/lib/domain/players";
import type { ClauseStatus } from "@/lib/domain/market";
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

describe("SquadList, clause state", () => {
  const takeable = { state: "takeable" as const, label: "takeable", shielded: false };
  const locked = { state: "locked" as const, label: "locked until 20 Sept", shielded: false };
  const shielded = { state: "shielded" as const, label: "shielded", shielded: true };

  /** One squad, rendered with whatever clause states the case needs. */
  const squad = (
    clauses?: Record<string, ClauseStatus>,
    rows: CatalogueRow[] = [p("Ada"), p("Bo")],
  ) => {
    const groups = squadByPosition(rows, "t1");
    return renderToStaticMarkup(
      <SquadList groups={groups} total={squadValue(groups)} ownershipKnown clauses={clauses} />,
    );
  };

  it("says when a lock lifts, in the same words the catalogue uses", () => {
    // One vocabulary across the portal: a reader should not have to learn "safe until"
    // here and "locked until" three pages away for the same fact.
    expect(squad({ Ada: locked })).toContain("locked until 20 Sept");
  });

  it("draws a mark on a blocked player, so colour is not the only channel", () => {
    expect(squad({ Ada: locked })).toContain("<svg");
    expect(squad({ Ada: shielded })).toContain("<svg");
    expect(squad({ Ada: takeable })).not.toContain("<svg");
  });

  it("writes no words beside a takeable player, which would be most of a squad", () => {
    expect(squad({ Ada: takeable })).not.toContain("takeable<");
  });

  it("keeps the marks outside the truncating span, so a long name cannot eat them", () => {
    // The defect this guards against is one this codebase has already had to fix once.
    const html = squad({ Ada: locked }, [
      p("Ada", { nickname: "A preposterously long footballer name indeed" }),
    ]);
    const truncated = html.slice(html.indexOf('class="truncate"'), html.indexOf("<svg"));
    expect(truncated).toContain("</span>");
  });

  it("leaves a squad with no clause states alone", () => {
    const html = squad();
    expect(html).not.toContain("locked until");
    expect(html).not.toContain("<svg");
  });
});

describe("SquadList, the buyout clause", () => {
  it("shows what a player would cost to take beside what they are worth", () => {
    // Not proportional: an owner can raise their own clause, so neither figure can be
    // read off the other and both are drawn.
    const html = render([p("Ada", { currentValue: 61_697_098, buyoutClause: 81_375_803 })]);
    expect(html).toContain("61.7M");
    expect(html).toContain("clause 81.4M");
  });

  it("says nothing about a clause the sweep has not recorded", () => {
    expect(render([p("Ada", { buyoutClause: null })])).not.toContain("clause ");
  });

  it("leaves the squad total to the market value, never the clause", () => {
    // The total answers "what is this squad worth", which is not "what would it cost to
    // buy it out from under them".
    const html = render([p("a", { currentValue: 2_000_000, buyoutClause: 9_000_000 })]);
    expect(html).toContain("2.0M at today");
  });
});
