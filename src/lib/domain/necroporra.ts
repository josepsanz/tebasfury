import type { Snapshot } from "./standings";

/**
 * The Necroporra: each week, name the two teams you think finish the round last.
 *
 * Pure, like every other file here. All of it — whether voting is open, whether a pair
 * is legal, who finished last, what a round is worth, the season table — is arithmetic
 * over rows somebody else fetched, and none of it needs a database to be proven.
 *
 * The rules were settled in conversation and are stated once, here:
 * two picks per manager, never your own team, one point if the team that actually
 * finished the round last is among them, and voting shuts when the round kicks off.
 */

/** Picks per manager per round. A schema fact as well as a rule — see `necroporra_votes`. */
export const MAX_VOTES = 2;

export type Round = { gameweek: number; closesAt: Date };

export type Ballot = {
  gameweek: number;
  userId: string;
  firstTeamId: string | null;
  secondTeamId: string | null;
};

export type PairRejection = "empty" | "too-many" | "duplicate" | "own-team" | "unknown-team";
export type PairVerdict = { ok: true } | { ok: false; reason: PairRejection };

export type SeasonRow = { userId: string; name: string; points: number; rounds: number };

/** The teams on a ballot, in order, with the empty slots dropped. */
export const picksOf = (ballot: Ballot): string[] =>
  [ballot.firstTeamId, ballot.secondTeamId].filter((id): id is string => id !== null);

/**
 * Whether a round still accepts votes.
 *
 * The deadline is the kickoff itself, and the comparison is strict: a vote landing on the
 * same instant as the whistle is late. Late is the safe direction for a poll whose whole
 * point is committing before you know anything.
 */
export function isOpen(round: Round | null, now: Date): boolean {
  return round !== null && now.getTime() < round.closesAt.getTime();
}

/**
 * Whether a set of picks is legal.
 *
 * `ownTeamId` may be null — a signed-in account with no claimed team. The page turns
 * those voters away earlier and for a different reason (they are not managers); the rule
 * itself must not crash on the null it will occasionally be handed.
 */
export function validatePair(
  picks: string[],
  { ownTeamId, teamIds }: { ownTeamId: string | null; teamIds: string[] },
): PairVerdict {
  // Not the same as declining to vote, which is simply having no row at all. An empty
  // submission is a form somebody filled in wrongly, and saying so beats saving nothing.
  if (picks.length === 0) return { ok: false, reason: "empty" };
  if (picks.length > MAX_VOTES) return { ok: false, reason: "too-many" };
  if (new Set(picks).size !== picks.length) return { ok: false, reason: "duplicate" };
  if (ownTeamId !== null && picks.includes(ownTeamId)) return { ok: false, reason: "own-team" };
  if (picks.some((id) => !teamIds.includes(id))) return { ok: false, reason: "unknown-team" };
  return { ok: true };
}

/**
 * The team that finished the round last, or null while that is not yet knowable.
 *
 * The API's own `roundPosition`, never a rank derived from points. Measured against
 * production on 2026-09-09: where two teams tie, the API hands out distinct sequential
 * places while a derived rank shares one — so deriving would leave "last" ambiguous
 * exactly in the week two teams tie at the bottom, which is the week it matters most.
 * The round table settled this with the same evidence.
 *
 * Null while any row of the round is provisional or has no position: a live response
 * reports the overall table position instead of a rank within the round, and scoring
 * then would be scoring a race that is still running. Null is "not yet", never "nobody".
 */
export function lastPlaced(snapshots: Snapshot[], gameweek: number): string | null {
  const round = snapshots.filter((s) => s.gameweek === gameweek);
  if (round.length === 0) return null;
  if (round.some((s) => s.isProvisional || s.roundPosition === null)) return null;

  return round.reduce((worst, s) =>
    (s.roundPosition ?? 0) > (worst.roundPosition ?? 0) ? s : worst,
  ).teamId;
}

/**
 * What each voter scored in one round.
 *
 * An unresolved round returns an EMPTY map rather than everyone on zero. "Nobody guessed
 * right" and "we do not know yet" are different claims, and a season table that added
 * them together would quietly count the round still being played as a round everybody
 * lost.
 */
export function scoreRound(ballots: Ballot[], lastTeamId: string | null): Map<string, number> {
  if (lastTeamId === null) return new Map();
  return new Map(
    ballots.map((ballot) => [ballot.userId, picksOf(ballot).includes(lastTeamId) ? 1 : 0]),
  );
}

/**
 * The season's table of who guesses best.
 *
 * `rounds` is the denominator of `points`: rounds this voter voted in AND which have
 * since been decided. Two things fall out of that, both wanted. Somebody who joins in
 * October reads as "2 from 2" rather than appearing to have missed everything before
 * they existed. And a round still being played is not counted against anybody — a voter
 * who has picked for it would otherwise read as "2 from 3", which looks like a miss and
 * is really a result nobody has yet.
 *
 * Ties break on name so the order cannot wobble between renders — the same habit
 * `rankAt` keeps in the standings.
 */
export function seasonTable(
  ballots: Ballot[],
  rounds: { gameweek: number; lastTeamId: string | null }[],
  names: Map<string, string>,
): SeasonRow[] {
  const resolved = new Map(
    rounds
      .filter((r): r is { gameweek: number; lastTeamId: string } => r.lastTeamId !== null)
      .map((r) => [r.gameweek, r.lastTeamId]),
  );

  const points = new Map<string, number>();
  const voted = new Map<string, number>();

  for (const ballot of ballots) {
    const lastTeamId = resolved.get(ballot.gameweek);
    // An unresolved round leaves the voter's row untouched in both figures, so a voter
    // who has ONLY picked for undecided rounds is absent from the table rather than
    // sitting at the bottom on nought.
    if (lastTeamId === undefined) continue;
    voted.set(ballot.userId, (voted.get(ballot.userId) ?? 0) + 1);
    points.set(
      ballot.userId,
      (points.get(ballot.userId) ?? 0) + (picksOf(ballot).includes(lastTeamId) ? 1 : 0),
    );
  }

  return [...voted.entries()]
    .map(([userId, roundsVoted]): SeasonRow => ({
      userId,
      name: names.get(userId) ?? userId,
      points: points.get(userId) ?? 0,
      rounds: roundsVoted,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

export type Voter = { userId: string; name: string };

export type RoundBallot = {
  userId: string;
  name: string;
  /** The teams picked, in order. Empty for a manager who has not voted. */
  picks: string[];
  /** True once the round is decided and this ballot named the team that finished last. */
  hit: boolean;
};

/**
 * Every eligible manager's ballot for one round, whether or not they voted.
 *
 * **Everybody's picks are visible, including while the round is still open.** That
 * reversed the original ruling, on the owner's reasoning: the argument between friends is
 * the product, and a poll nobody can needle each other about is a form. Somebody voting
 * late can see the earlier picks; in a league of thirteen who know each other, that is
 * something to be teased about rather than a hole to be closed.
 *
 * A manager who has not voted is RETURNED, with no picks, rather than left out. "Nobody
 * has heard from Bruno" is as much of a prod as the picks themselves, and an absence
 * shown as an absence cannot be mistaken for a manager who does not play.
 *
 * `hit` is false for every ballot while the round is undecided — not unknown, because
 * nothing renders it until there is a last-placed team to compare against.
 */
export function roundBallots(
  voters: Voter[],
  ballots: Ballot[],
  gameweek: number,
  lastTeamId: string | null,
): RoundBallot[] {
  const byUser = new Map(
    ballots.filter((b) => b.gameweek === gameweek).map((b) => [b.userId, b]),
  );

  return [...voters]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((voter) => {
      const picks = byUser.has(voter.userId) ? picksOf(byUser.get(voter.userId)!) : [];
      return {
        userId: voter.userId,
        name: voter.name,
        picks,
        hit: lastTeamId !== null && picks.includes(lastTeamId),
      };
    });
}
