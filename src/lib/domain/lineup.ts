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

export type LineupMetric = "points" | "average";

export type Shortfall = {
  goalkeepers: number;
  defenders: number;
  midfielders: number;
  forwards: number;
};

export type RankedFormation = {
  formation: Formation;
  name: string;
  /** The eleven's total, or null when the formation cannot be fielded. */
  total: number | null;
  /** Empty when the formation cannot be fielded. */
  eleven: CatalogueRow[];
  /** Null when the formation CAN be fielded. */
  shortfall: Shortfall | null;
};

/** The line a player belongs to. One position each, which is why the lines are separable. */
const LINES = ["Goalkeeper", "Defender", "Midfielder", "Forward"] as const;

/**
 * What a player is worth under the chosen metric, or null when it is unknown.
 *
 * Null and not zero for an average nobody has: a player who has never featured has no
 * average at all, and treating the unknown as a low number would let them displace
 * somebody who has actually played. `sortCatalogue` draws the same distinction about an
 * unknown market value, and for the same reason.
 */
const valueOf = (row: CatalogueRow, metric: LineupMetric): number | null =>
  metric === "points" ? row.seasonPoints : row.averagePoints;

/**
 * Every formation, best first, with either its eleven or the reason it cannot be fielded.
 *
 * Each line is sorted ONCE and every formation then reads a prefix of it. That is not an
 * optimisation, it is the algorithm: because a player belongs to exactly one line, the
 * lines never compete, and the best N of a line is the best N of that line in every
 * formation that asks for N. Seven formations cost four sorts.
 *
 * An impossible formation carries a per-line shortfall rather than a bare `false`. "No
 * formation possible" on a squad of thirteen reads as a broken portal; "one midfielder
 * short" is a transfer instruction.
 */
export function rankFormations(
  rows: CatalogueRow[],
  metric: LineupMetric,
): RankedFormation[] {
  const fieldable = eligible(rows);

  const byLine = new Map<string, CatalogueRow[]>(
    LINES.map((line) => [
      line,
      fieldable
        .filter((row) => row.position === line)
        .sort((a, b) => {
          const left = valueOf(a, metric);
          const right = valueOf(b, metric);
          // An unknown value sinks, whichever side of the comparison it is on.
          if (left === null && right === null) return a.nickname.localeCompare(b.nickname);
          if (left === null) return 1;
          if (right === null) return -1;
          // Ties break on name so an eleven cannot wobble between renders.
          return right - left || a.nickname.localeCompare(b.nickname);
        }),
    ]),
  );

  const take = (line: string, n: number) => (byLine.get(line) ?? []).slice(0, n);
  const missing = (line: string, n: number) =>
    Math.max(0, n - (byLine.get(line) ?? []).length);

  const ranked = FORMATIONS.map((formation): RankedFormation => {
    const shortfall: Shortfall = {
      goalkeepers: missing("Goalkeeper", 1),
      defenders: missing("Defender", formation.defenders),
      midfielders: missing("Midfielder", formation.midfielders),
      forwards: missing("Forward", formation.forwards),
    };
    const short = Object.values(shortfall).some((n) => n > 0);

    if (short) {
      return { formation, name: formationName(formation), total: null, eleven: [], shortfall };
    }

    const eleven = [
      ...take("Goalkeeper", 1),
      ...take("Defender", formation.defenders),
      ...take("Midfielder", formation.midfielders),
      ...take("Forward", formation.forwards),
    ];
    // An unknown value CAN reach the eleven: when a line holds exactly as many players as
    // the formation demands, sinking cannot exclude anybody. It contributes nothing
    // countable, so the total understates that eleven — but not its ranking, because the
    // same forced player appears in every formation that can be fielded at all. Under the
    // default `points` metric this cannot arise: `seasonPoints` is a number, never null.
    const total = eleven.reduce((sum, row) => sum + (valueOf(row, metric) ?? 0), 0);
    return { formation, name: formationName(formation), total, eleven, shortfall: null };
  });

  // Possible first by total; impossible after, in the order FORMATIONS declares them so
  // the list never reorders itself between renders.
  return ranked.sort((a, b) => {
    if (a.shortfall === null && b.shortfall === null) return (b.total ?? 0) - (a.total ?? 0);
    if (a.shortfall === null) return -1;
    if (b.shortfall === null) return 1;
    return 0;
  });
}

/** How many players a shortfall is asking for in total. */
const missingCount = (shortfall: Shortfall): number =>
  shortfall.goalkeepers + shortfall.defenders + shortfall.midfielders + shortfall.forwards;

/**
 * The impossible formation closest to being possible, or null if any is possible already.
 *
 * This is what turns "no formation possible" into something a manager can act on: the
 * cheapest route back to fielding a team. Ties keep the earlier formation, which is
 * `FORMATIONS` order, so the answer never wobbles.
 */
export function nearestFormation(ranked: RankedFormation[]): RankedFormation | null {
  if (ranked.some((r) => r.shortfall === null)) return null;
  return ranked.reduce<RankedFormation | null>((best, candidate) => {
    if (candidate.shortfall === null) return best;
    if (best?.shortfall == null) return candidate;
    return missingCount(candidate.shortfall) < missingCount(best.shortfall) ? candidate : best;
  }, null);
}
