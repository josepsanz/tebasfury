import type { CatalogueRow } from "./players";

/**
 * The best eleven a squad can field, and which formation gets there.
 *
 * Pure, like every other file here: arithmetic over rows somebody else fetched.
 *
 * **This is not really a linear programming problem, although it can be written as one.**
 * Every player holds exactly one position and the constraints are "take exactly N from
 * each line", so the lines never compete for a player and the constraint matrix is
 * completely separable. Sorting each line once and taking its top N is therefore the
 * optimum itself, not an approximation — no solver, and no dependency.
 *
 * That stops being true only if some rule couples the lines, such as a cap on players
 * from one real club. The league has no such rule today; if one appears, this is the
 * reasoning to revisit.
 */

export type Formation = { defenders: number; midfielders: number; forwards: number };

const f = (defenders: number, midfielders: number, forwards: number): Formation => ({
  defenders,
  midfielders,
  forwards,
});

/**
 * The league's seven, as the owner states them.
 *
 * The goalkeeper is absent because it is always exactly one — a column that never varies
 * is noise in every row it appears in. Each formation is ten outfield players, which is
 * what makes two totals comparable: the choice is between elevens, never between a bigger
 * team and a smaller one.
 */
export const FORMATIONS: Formation[] = [
  f(5, 4, 1),
  f(5, 3, 2),
  f(4, 5, 1),
  f(4, 4, 2),
  f(4, 3, 3),
  f(3, 5, 2),
  f(3, 4, 3),
];

export const formationName = (formation: Formation): string =>
  `${formation.defenders}-${formation.midfielders}-${formation.forwards}`;

/** The statuses that make a player unfieldable. `doubtful` is deliberately not among them. */
const UNFIELDABLE = new Set(["injured", "suspended", "out_of_league"]);

/**
 * The players who could actually take the pitch.
 *
 * `injured`, `suspended` and `out_of_league` are out: an optimiser that fields a suspended
 * player has given a wrong answer, confidently, which is worse than giving none.
 *
 * `doubtful` stays. It is a judgement rather than a fact, so the player counts and the
 * view marks them — the reader decides. Measured cost of this rule on 2026-09-09: it drops
 * one manager from a single possible formation to none, and two others from seven to five
 * and five to three. That is the honest answer, not a regression.
 */
export function eligible(rows: CatalogueRow[]): CatalogueRow[] {
  return rows.filter((row) => !UNFIELDABLE.has(row.status));
}
