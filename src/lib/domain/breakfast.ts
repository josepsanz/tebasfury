import type { Snapshot } from "./standings";

/**
 * How many rounds AFTER the one it was earned in a shield covers: bring breakfast in
 * round N and you are covered in N+1, N+2 and N+3. That is why `roundsLeft` adds one —
 * at N+1 the shield still has all three rounds left, and `3 - (N+1 - N) + 1 = 3`. The
 * `+ 1` is the rule, not an off-by-one.
 */
export const SHIELD_ROUNDS = 3;

export type Shield = { teamId: string; roundsLeft: number };

export type BreakfastDuty = {
  gameweek: number;
  /**
   * Every team that brings it — more than one only on a tie. Empty ONLY on a provisional
   * duty for a round nobody has scored in yet; a settled round always names somebody.
   */
  bringers: string[];
  /** Who a shield protected during this round, and for how many more rounds counting it. */
  shielded: Shield[];
  /**
   * True when the round is still being played, so `bringers` is where the round stands
   * rather than where it ended. `shielded` is settled either way — it is decided by
   * rounds that have finished — which is why only one half of this carries a disclaimer.
   */
  provisional: boolean;
};

/**
 * Whether a round is still being played, and so has no last place to punish yet. A
 * provisional row and a missing rank within the round are the same claim by two names:
 * the live response reports the overall position rather than a rank, and the points are
 * still climbing. `lastPlaced` refuses the same question in the same words.
 */
function inPlay(rows: Snapshot[]): boolean {
  return rows.some((s) => s.isProvisional || s.roundPosition === null);
}

/** Who is covered as the round `gameweek` is read, given the round each team last brought it in. */
function shieldsAt(broughtIn: Map<string, number>, rows: Snapshot[], gameweek: number): Shield[] {
  return rows.flatMap((row) => {
    const last = broughtIn.get(row.teamId);
    if (last === undefined) return [];
    const roundsLeft = SHIELD_ROUNDS - (gameweek - last) + 1;
    return roundsLeft > 0 ? [{ teamId: row.teamId, roundsLeft }] : [];
  });
}

/**
 * The walk up the table. Taking the lowest points among the unshielded IS walking up
 * until somebody is not shielded — the league says it the first way, the code says it
 * the second. If the walk runs out of table the shields yield: somebody always brings it.
 *
 * Ties come from ROUND POINTS, never from `roundPosition`. This inverts the ruling
 * `buildRoundTable` made for the same data (see its doc comment in `standings.ts`,
 * measured against production on 2026-09-09): the API hands out distinct sequential
 * places by a tie-break it does not publish, so where two teams share the bottom score a
 * position would name one of them and the league would be short a breakfast.
 *
 * Sorted, because a tie is read out loud as a sentence and row order from the database is
 * undefined — the same two names would swap places between loads. `rankAt` breaks its
 * ties on the manager's name for the same reason.
 */
function bringersAmong(rows: Snapshot[], shielded: Shield[]): string[] {
  const covered = new Set(shielded.map((s) => s.teamId));
  const candidates = rows.filter((row) => !covered.has(row.teamId));
  const eligible = candidates.length > 0 ? candidates : rows;

  const lowest = Math.min(...eligible.map((row) => row.points));
  return eligible
    .filter((row) => row.points === lowest)
    .map((row) => row.teamId)
    .sort();
}

/**
 * Works out, round by round, who brings breakfast: the team that finished the round
 * last. Bringing it earns a shield for the next three rounds, during which the
 * obligation walks up the table to the next team that is not shielded; if several
 * tie at whatever height the walk stops, they all bring it.
 *
 * SETTLED ROUNDS ONLY. A round still being played is skipped rather than guessed at, so
 * `duties.at(-1)` is always a fact — the season sentence on `/standings` reads it that
 * way. Where the round in play is the question, `projectedDuty` answers it and labels
 * the answer.
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
    if (inPlay(rows)) continue;

    const shielded = shieldsAt(broughtIn, rows, gameweek);
    const bringers = bringersAmong(rows, shielded);

    for (const teamId of bringers) broughtIn.set(teamId, gameweek);
    duties.push({ gameweek, bringers, shielded, provisional: false });
  }

  return duties;
}

/**
 * Where a round still being played is heading, for the two questions the league asks
 * mid-week: who is covered, and who is currently on the hook.
 *
 * The two halves are not equally firm, and the duty says so. `shielded` falls out of the
 * rounds that have FINISHED — it was settled on Monday and will not move — while
 * `bringers` reads the points as they stand, on the same `points` field `buildRoundTable`
 * is drawing on screen, so the sentence and the table can never name different teams.
 *
 * Before anybody has scored every team is level, and the tie rule would name every
 * unshielded team at once — ten of thirteen, which answers nothing. The owner ruled that
 * case out on 2026-09-20: `bringers` is empty until one team is ahead of another, and the
 * shields are reported regardless. That empty list is the ONLY way a `bringers` is empty;
 * a settled round always names somebody.
 *
 * Null when the round is settled — `dutyFor` already answers for it, and a projection
 * beside it would be a second answer — or when nothing has been recorded for it at all.
 */
export function projectedDuty(
  snapshots: Snapshot[],
  duties: BreakfastDuty[],
  gameweek: number,
): BreakfastDuty | null {
  const rows = snapshots.filter((s) => s.gameweek === gameweek);
  if (rows.length === 0 || !inPlay(rows)) return null;

  // Only rounds BEFORE this one can have shielded it. Duties arrive oldest first, so the
  // last write per team wins, which is the round it most recently brought breakfast in.
  const broughtIn = new Map<string, number>();
  for (const duty of duties) {
    if (duty.gameweek >= gameweek) continue;
    for (const teamId of duty.bringers) broughtIn.set(teamId, duty.gameweek);
  }

  const shielded = shieldsAt(broughtIn, rows, gameweek);
  const started = rows.some((row) => row.points !== 0);

  return {
    gameweek,
    bringers: started ? bringersAmong(rows, shielded) : [],
    shielded,
    provisional: true,
  };
}

export function dutyFor(duties: BreakfastDuty[], gameweek: number): BreakfastDuty | null {
  return duties.find((duty) => duty.gameweek === gameweek) ?? null;
}
