import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClauseStatus } from "@/lib/domain/market";
import type { CatalogueRow } from "@/lib/domain/players";
import { squadByPosition, squadValue } from "@/lib/domain/players";
import { CLAUSE_COLOUR, ClauseNote } from "./clause-marks";
import { PlayerCatalogue } from "./player-catalogue";
import { SquadList } from "./squad-list";

const STATES: ClauseStatus[] = [
  { state: "takeable", label: "takeable", shielded: false },
  { state: "soon", label: "free in 8 hours", shielded: false },
  { state: "locked", label: "locked until 14 Sept", shielded: false },
  { state: "shielded", label: "shielded", shielded: true },
];

const row: CatalogueRow = {
  id: "p1", nickname: "Ada", position: "Midfielder", status: "ok",
  currentValue: 12_400_000, seasonPoints: 40, averagePoints: 10, gameweeksRecorded: 4,
  ownerTeamId: "t1", ownerName: "Manager A", clubName: null,
  buyoutClause: null, clauseLockedUntil: null, shielded: false,
};

const inCatalogue = (clause: ClauseStatus) =>
  renderToStaticMarkup(
    <PlayerCatalogue rows={[row]} ownershipKnown clauses={{ p1: clause }} />,
  );

const inSquad = (clause: ClauseStatus) => {
  const groups = squadByPosition([row], "t1");
  return renderToStaticMarkup(
    <SquadList
      groups={groups}
      total={squadValue(groups)}
      ownershipKnown
      clauses={{ p1: clause }}
    />,
  );
};

describe("clause marks", () => {
  it("draws a state the same way wherever it appears", () => {
    // The reason these live in one module. Two copies would drift on the first change,
    // and a portal where green means one thing on one page is worse than one that never
    // coloured a name at all.
    for (const clause of STATES) {
      expect(inCatalogue(clause)).toContain(CLAUSE_COLOUR[clause.state]);
      expect(inSquad(clause)).toContain(CLAUSE_COLOUR[clause.state]);
    }
  });

  it("never spends the portal's amber on a clause state", () => {
    // Amber means "your team" and nothing else; a colour meaning two things means neither.
    for (const clause of STATES) {
      expect(inCatalogue(clause)).not.toContain("--board-you");
      expect(inSquad(clause)).not.toContain("--board-you");
    }
  });

  it("carries its own separator, so a caller need not decide whether a dot is needed", () => {
    const html = renderToStaticMarkup(<ClauseNote clause={STATES[2]} />);
    expect(html).toContain("·");
    expect(html).toContain("locked until 14 Sept");
  });

  it("says nothing for a takeable player, or for one with no state at all", () => {
    expect(renderToStaticMarkup(<ClauseNote clause={STATES[0]} />)).toBe("");
    expect(renderToStaticMarkup(<ClauseNote />)).toBe("");
  });
});
