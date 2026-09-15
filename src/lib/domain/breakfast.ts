import type { Snapshot } from "./standings";

/** How many rounds a shield covers, counting the round it was earned in. */
export const SHIELD_ROUNDS = 3;

export type BreakfastDuty = {
  gameweek: number;
  /** Every team that brings it — more than one only on a tie. */
  bringers: string[];
  /** Who a shield protected during this round, and for how many more rounds counting it. */
  shielded: { teamId: string; roundsLeft: number }[];
};

/**
 * Works out, round by round, who brings breakfast: the team that finished the round
 * last. Bringing it earns a shield for the next three rounds, during which the
 * obligation walks up the table to the next team that is not shielded; if several
 * tie at whatever height the walk stops, they all bring it.
 *
 * Ties come from ROUND POINTS, never from `roundPosition`. This inverts the ruling
 * `buildRoundTable` made for the same data (see its doc comment in `standings.ts`,
 * measured against production on 2026-09-09): the API hands out distinct sequential
 * places by a tie-break it does not publish, so where two teams share the bottom
 * score a position would name one of them and the league would be short a
 * breakfast. `roundPosition` still appears below, for the one thing it is good for —
 * telling a round still being played from one that is settled.
 *
 * A shield is earned IN the round a team brings breakfast and covers the three
 * rounds AFTER it — so a team read at gameweek N+1 has three rounds of cover left,
 * at N+2 two, at N+3 one, and by N+4 it is exposed again.
 *
 * Somebody always brings breakfast. If every team left standing in a round is
 * shielded, the shields yield to that requirement and the round's bottom score
 * brings it regardless — there is no "nobody" outcome for this rule to produce, even
 * though thirteen shields can never actually cover thirteen teams at once.
 */
export function breakfastDuties(snapshots: Snapshot[]): BreakfastDuty[] {
  const gameweeks = [...new Set(snapshots.map((s) => s.gameweek))].sort((a, b) => a - b);
  // Team id to the LAST round it brought breakfast in. The shield covers the three rounds
  // after that one, so this is all the history the fold has to carry.
  const broughtIn = new Map<string, number>();
  const duties: BreakfastDuty[] = [];

  for (const gameweek of gameweeks) {
    const rows = snapshots.filter((s) => s.gameweek === gameweek);
    // The same line `lastPlaced` draws: a round with a provisional row, or one the API gave
    // no rank within, is still being played and has no last place to punish.
    if (rows.some((s) => s.isProvisional || s.roundPosition === null)) continue;

    const shielded = rows.flatMap((row) => {
      const last = broughtIn.get(row.teamId);
      if (last === undefined) return [];
      const roundsLeft = SHIELD_ROUNDS - (gameweek - last) + 1;
      return roundsLeft > 0 ? [{ teamId: row.teamId, roundsLeft }] : [];
    });

    const covered = new Set(shielded.map((s) => s.teamId));
    // Walking up the table until somebody is not shielded IS taking the lowest points
    // among the unshielded — the league says it the first way, the code says it the second.
    // And if the walk runs out of table, the shields yield: somebody always brings it.
    const candidates = rows.filter((row) => !covered.has(row.teamId));
    const eligible = candidates.length > 0 ? candidates : rows;

    const lowest = Math.min(...eligible.map((row) => row.points));
    const bringers = eligible.filter((row) => row.points === lowest).map((row) => row.teamId);

    for (const teamId of bringers) broughtIn.set(teamId, gameweek);
    duties.push({ gameweek, bringers, shielded });
  }

  return duties;
}

export function dutyFor(duties: BreakfastDuty[], gameweek: number): BreakfastDuty | null {
  return duties.find((duty) => duty.gameweek === gameweek) ?? null;
}
