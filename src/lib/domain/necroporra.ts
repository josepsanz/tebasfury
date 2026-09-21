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
  /**
   * Whose ballot it is: the TEAM. Not the account, because two managers in this league
   * have none and vote in the group chat — an admin enters what they said, and it has to
   * hang off something that exists for every one of the thirteen.
   */
  teamId: string;
  firstTeamId: string | null;
  secondTeamId: string | null;
  /** The admin who typed it for them, or null when the manager cast it themselves. */
  enteredBy: string | null;
  /** When it was recorded — the other half of an entered ballot's mark. */
  castAt: Date;
};

export type PairRejection = "empty" | "too-many" | "duplicate" | "own-team" | "unknown-team";
export type PairVerdict = { ok: true } | { ok: false; reason: PairRejection };

export type SeasonRow = { teamId: string; name: string; points: number; rounds: number };

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
 * Whether this actor may record a ballot for this team.
 *
 * Two ways to be allowed and no third: it is your own team, or you hold the permission to
 * enter somebody else's. Pure, so the page and the action ask the same question of the
 * same function rather than each deciding for itself — the control being hidden from a
 * reader who may not use it is a courtesy, and this is the control.
 *
 * `teamId: null` is an account with no claim, which includes this league's own admin. It
 * is not a reason to refuse an admin: entering what the group chat said is the whole
 * point, and holding a team has nothing to do with it.
 */
export function canCastFor(
  actor: { teamId: string | null; mayCastForOthers: boolean },
  teamId: string,
): boolean {
  if (actor.teamId !== null && actor.teamId === teamId) return true;
  return actor.mayCastForOthers;
}

/**
 * Every team level at the bottom of the round, or empty while that is not yet knowable.
 *
 * **Ranked on POINTS, on the owner's ruling: several teams can have finished last, if
 * they made the identical lowest score.** This replaced a reading that took the API's
 * own `roundPosition` and so always named exactly one — measured on 2026-09-09, the API
 * breaks a tie into distinct sequential places by a rule it does not publish, and the
 * old reading took that arbitration as the answer. It is the arbitration; the points are
 * the fact. `roundLeaders` reads the top the same way, and `breakfastDuties` already read
 * the bottom this way, so the portal now says one thing about who came last.
 *
 * **This changed a score already given.** Gameweek 4 has La Agustineta 96 and PavelmacuFC
 * level on 24, and the API had put one of them thirteenth; naming either now earns the
 * point. No other round played so far has a tie at either end.
 *
 * Empty while any row of the round is provisional or has no position: a live response
 * reports the overall table position instead of a rank within the round, and scoring then
 * would be scoring a race that is still running. Empty is "not yet", never "nobody" — the
 * callers draw that line themselves.
 */
function settledRound(snapshots: Snapshot[], gameweek: number): Snapshot[] | null {
  const round = snapshots.filter((s) => s.gameweek === gameweek);
  if (round.length === 0) return null;
  if (round.some((s) => s.isProvisional || s.roundPosition === null)) return null;
  return round;
}

export function roundLast(snapshots: Snapshot[], gameweek: number): string[] {
  const round = settledRound(snapshots, gameweek);
  if (round === null) return [];

  const worst = Math.min(...round.map((s) => s.points));
  return round
    .filter((s) => s.points === worst)
    .map((s) => s.teamId)
    .sort();
}

/**
 * Every team level at the top of the round, or empty while that is not yet knowable.
 *
 * **Ranked on POINTS, unlike `lastPlaced` beside it, and on the owner's ruling: teams
 * level at the top are co-leaders, even though the API hands one of them first place.**
 * It breaks ties into distinct sequential positions by a rule it does not publish, so at
 * a tie the position is its arbitration and the points are the fact — the same reasoning
 * the breakfast rule already follows at the other end of the table.
 *
 * `lastPlaced` deliberately stays on the position: it is what the poll SCORES, a point
 * for naming the team that finished last, and a season of scores already rests on it.
 * Moving it is a separate ruling with a season of arithmetic behind it.
 *
 * The position is still what says a round has SETTLED — a live response reports the
 * overall table place rather than a rank within the round — so the shared guard reads it
 * even though the answer never does, and the two ends stay knowable together.
 *
 * Sorted, so a tie cannot reorder itself between loads. Shown and charged for, never
 * scored: the Necroporra's points remain about the bottom.
 */
export function roundLeaders(snapshots: Snapshot[], gameweek: number): string[] {
  const round = settledRound(snapshots, gameweek);
  if (round === null) return [];

  const best = Math.max(...round.map((s) => s.points));
  return round
    .filter((s) => s.points === best)
    .map((s) => s.teamId)
    .sort();
}

/**
 * What each voter scored in one round.
 *
 * An unresolved round returns an EMPTY map rather than everyone on zero. "Nobody guessed
 * right" and "we do not know yet" are different claims, and a season table that added
 * them together would quietly count the round still being played as a round everybody
 * lost.
 */
export function scoreRound(ballots: Ballot[], lastTeamIds: string[]): Map<string, number> {
  if (lastTeamIds.length === 0) return new Map();
  return new Map(
    ballots.map((ballot) => [
      ballot.teamId,
      // ONE point for naming any of them, never two for naming both: the ballot asks who
      // finishes last, and a week with two teams level does not double the prize.
      picksOf(ballot).some((pick) => lastTeamIds.includes(pick)) ? 1 : 0,
    ]),
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
  rounds: { gameweek: number; lastTeamIds: string[] }[],
  names: Map<string, string>,
): SeasonRow[] {
  const resolved = new Map(
    rounds.filter((r) => r.lastTeamIds.length > 0).map((r) => [r.gameweek, r.lastTeamIds]),
  );

  const points = new Map<string, number>();
  const voted = new Map<string, number>();

  for (const ballot of ballots) {
    const lastTeamIds = resolved.get(ballot.gameweek);
    // An unresolved round leaves the voter's row untouched in both figures, so a voter
    // who has ONLY picked for undecided rounds is absent from the table rather than
    // sitting at the bottom on nought.
    if (lastTeamIds === undefined) continue;
    voted.set(ballot.teamId, (voted.get(ballot.teamId) ?? 0) + 1);
    points.set(
      ballot.teamId,
      (points.get(ballot.teamId) ?? 0) +
        (picksOf(ballot).some((pick) => lastTeamIds.includes(pick)) ? 1 : 0),
    );
  }

  return [...voted.entries()]
    .map(([teamId, roundsVoted]): SeasonRow => ({
      teamId,
      name: names.get(teamId) ?? teamId,
      points: points.get(teamId) ?? 0,
      rounds: roundsVoted,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

/** A team and how many votes it is on. Both boards below count votes, not voters. */
export type VoteTally = { teamId: string; name: string; votes: number };

/**
 * Who the league names most: every vote received, all season, both picks counted.
 *
 * The complement of `seasonTable`, which measures the voters. This measures the voted —
 * the question the group actually argues about, which is not who guesses well but who
 * everybody thinks is worst.
 *
 * **Every team appears, including on nought.** Absence would read as missing data, while
 * nought is the interesting fact: a whole season and not one person named you.
 *
 * An OPEN round's votes count. The page already prints them as they land, under
 * "Everyone's picks so far", so there is no secret here to leak — and "so far" is the
 * question being asked.
 *
 * Ties break on the name, so the order cannot wobble between renders. Same habit as
 * `rankAt` and `seasonTable`.
 */
export function mostHated(ballots: Ballot[], names: Map<string, string>): VoteTally[] {
  const votes = new Map([...names.keys()].map((teamId) => [teamId, 0]));
  for (const ballot of ballots) {
    for (const teamId of picksOf(ballot)) {
      // A pick naming a team the roster has forgotten is still a vote that was cast, so
      // it is counted rather than dropped — it simply has no row of its own to sit in.
      if (votes.has(teamId)) votes.set(teamId, (votes.get(teamId) ?? 0) + 1);
    }
  }

  return [...votes.entries()]
    .map(([teamId, count]): VoteTally => ({
      teamId,
      name: names.get(teamId) ?? teamId,
      votes: count,
    }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}

/**
 * Who has picked one particular team, most often first.
 *
 * `mostHated` read from the other end: not how often a team is named, but by whom. It is
 * asked on behalf of the reader about their own team, which is why it takes one id.
 *
 * **Only those who have actually named them appear.** The league board above shows its
 * noughts; this one must not. It answers "who has it in for me", and a row reporting that
 * somebody has named you no times is not an answer to that question — it is the absence
 * of one, printed twelve times.
 */
export function haters(
  ballots: Ballot[],
  teamId: string,
  names: Map<string, string>,
): VoteTally[] {
  const votes = new Map<string, number>();
  for (const ballot of ballots) {
    if (!picksOf(ballot).includes(teamId)) continue;
    votes.set(ballot.teamId, (votes.get(ballot.teamId) ?? 0) + 1);
  }

  return [...votes.entries()]
    .map(([voterTeamId, count]): VoteTally => ({
      teamId: voterTeamId,
      name: names.get(voterTeamId) ?? voterTeamId,
      votes: count,
    }))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
}

/**
 * What a decided round costs the people who called it wrongly, and what it earns the one
 * who called it right.
 *
 * Two articles of the league's Constitution, neither of which the poll's points express
 * — see `domain/constitution.ts`, where they are written out:
 *
 * - **Name the team that WINS the round and you owe the league an apology.** The poll
 *   asks who finishes last; picking the eventual winner is as wrong as an answer gets.
 * - **Name a team that finishes LAST and win the round yourself, and you have earned the
 *   right to send that team a denigrating message.** Both halves, which is what makes it
 *   rare: calling the bottom right is worth a point to anybody, but only the round's
 *   winner may use it.
 *
 * Finishing last on its own earns nothing here — it already brings breakfast.
 */
export type Denigration = {
  /** The winner who called it: whose right this is. */
  senderTeamId: string;
  /**
   * The teams they may send it to: the ones they NAMED that finished last, never every
   * team at the bottom. Pairing the two is what keeps a winner from denigrating a team
   * they never called when two are level — and it settles the degenerate round where
   * every team is level and the first are also the last, because nobody may vote for
   * their own team and so nobody can end up denigrating themselves.
   */
  targetTeamIds: string[];
};

export type RoundConsequences = {
  /** Voters who named the round's winner, sorted so the sentence cannot reorder itself. */
  apologists: string[];
  /** Who has earned the right to denigrate, and over whom. Sorted by sender. */
  denigrations: Denigration[];
  /** The round's leaders, all of them on a tie. Empty while undecided. */
  winnerTeamIds: string[];
};

export function roundConsequences(
  ballots: Ballot[],
  gameweek: number,
  { firstTeamIds, lastTeamIds }: { firstTeamIds: string[]; lastTeamIds: string[] },
): RoundConsequences {
  // An undecided round returns an empty verdict rather than an accusation. `roundLeaders`
  // and `roundLast` share a guard, so in practice these are empty together.
  if (firstTeamIds.length === 0) return { apologists: [], denigrations: [], winnerTeamIds: [] };

  const thisRound = ballots.filter((ballot) => ballot.gameweek === gameweek);

  // Naming ANY of the co-leaders is naming a winner — the owner's ruling, which is why
  // this is an intersection and not an equality.
  const apologists = thisRound
    .filter((ballot) => picksOf(ballot).some((pick) => firstTeamIds.includes(pick)))
    .map((ballot) => ballot.teamId)
    .sort();

  // Sorted for the same reason the apologists are: row order from the database is
  // undefined, and these sentences are read out in order.
  const denigrations = thisRound
    .filter((ballot) => firstTeamIds.includes(ballot.teamId))
    .map((ballot) => ({
      senderTeamId: ballot.teamId,
      targetTeamIds: picksOf(ballot).filter((pick) => lastTeamIds.includes(pick)).sort(),
    }))
    .filter((one) => one.targetTeamIds.length > 0)
    .sort((a, b) => a.senderTeamId.localeCompare(b.senderTeamId));

  return { apologists, denigrations, winnerTeamIds: firstTeamIds };
}

export type Voter = { teamId: string; name: string };

export type RoundBallot = {
  teamId: string;
  name: string;
  /** The teams picked, in order. Empty for a manager who has not voted. */
  picks: string[];
  /** True once the round is decided and this ballot named the team that finished last. */
  hit: boolean;
  /** The admin who entered it, or null — drawn on the page for everyone to read. */
  enteredBy: string | null;
  /** When it was recorded. Null for a manager who has not voted at all. */
  castAt: Date | null;
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
 * shown as an absence cannot be mistaken for a manager who does not play. Since the vote
 * became the team's, that now includes the managers with no portal account at all: they
 * are voters whose ballot somebody else types, not people the poll has never heard of.
 *
 * `hit` is false for every ballot while the round is undecided — not unknown, because
 * nothing renders it until there is a last-placed team to compare against.
 */
export function roundBallots(
  voters: Voter[],
  ballots: Ballot[],
  gameweek: number,
  lastTeamIds: string[],
): RoundBallot[] {
  const byTeam = new Map(
    ballots.filter((b) => b.gameweek === gameweek).map((b) => [b.teamId, b]),
  );

  return [...voters]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((voter) => {
      const ballot = byTeam.get(voter.teamId) ?? null;
      const picks = ballot === null ? [] : picksOf(ballot);
      return {
        teamId: voter.teamId,
        name: voter.name,
        picks,
        hit: picks.some((pick) => lastTeamIds.includes(pick)),
        enteredBy: ballot?.enteredBy ?? null,
        castAt: ballot?.castAt ?? null,
      };
    });
}
