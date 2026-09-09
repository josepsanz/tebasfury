import { describe, expect, it } from "vitest";
import type { CatalogueRow } from "./players";
import { FORMATIONS, eligible, formationName } from "./lineup";

const row = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id,
  nickname: id,
  position: "Midfielder",
  status: "ok",
  currentValue: 1_000_000,
  seasonPoints: 10,
  averagePoints: 2.5,
  gameweeksRecorded: 4,
  ownerTeamId: "t1",
  ownerName: "Ada",
  clubName: null,
  ...over,
});

describe("FORMATIONS", () => {
  it("holds the league's seven, and only those", () => {
    expect(FORMATIONS.map(formationName)).toEqual([
      "5-4-1",
      "5-3-2",
      "4-5-1",
      "4-4-2",
      "4-3-3",
      "3-5-2",
      "3-4-3",
    ]);
  });

  it("is ten outfield players in every one, so their totals are comparable", () => {
    // The whole reason a formation's total can be ranked against another's: both are
    // eleven players, never a bigger team against a smaller one.
    for (const f of FORMATIONS) {
      expect(f.defenders + f.midfielders + f.forwards).toBe(10);
    }
  });
});

describe("eligible", () => {
  it("keeps a fit player", () => {
    expect(eligible([row("a")]).map((r) => r.id)).toEqual(["a"]);
  });

  it("drops the three statuses that make a player unfieldable", () => {
    // An optimiser that fields a suspended player has given a wrong answer, confidently.
    const rows = [
      row("hurt", { status: "injured" }),
      row("banned", { status: "suspended" }),
      row("gone", { status: "out_of_league" }),
      row("fit"),
    ];
    expect(eligible(rows).map((r) => r.id)).toEqual(["fit"]);
  });

  it("keeps a doubtful player, because doubt is a judgement and not a fact", () => {
    expect(eligible([row("maybe", { status: "doubtful" })]).map((r) => r.id)).toEqual([
      "maybe",
    ]);
  });

  it("does not disturb the caller's array", () => {
    const rows = [row("a"), row("b", { status: "injured" })];
    eligible(rows);
    expect(rows).toHaveLength(2);
  });
});
