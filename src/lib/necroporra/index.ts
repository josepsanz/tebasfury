import { and, eq, gt, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { necroporraRounds, necroporraVotes, teams } from "@/lib/db/schema";
import type { Ballot, Round, Voter } from "@/lib/domain/necroporra";

/** Neon HTTP in production, PGlite in tests. Generic over the driver, like the claims module. */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Makes sure a round exists for this gameweek, and keeps its deadline current.
 *
 * Called by `runSync`, from the `week/current` response it already fetches — so opening a
 * round needs no new scheduled chain, no second thing that can silently die, and no human
 * setting a date. `decideNextRun` caps an idle wait at 24 hours and the API names the
 * upcoming week three days ahead, so the round always exists well before it matters.
 *
 * The deadline is refreshed while voting is open, because a kickoff really can move. It
 * is NOT refreshed once the round has closed: reopening voting after the fact would let
 * somebody vote on a round they had already watched. The `where` clause is that rule, and
 * it is one statement, so two concurrent syncs cannot race each other into reopening one.
 */
export async function openRound(
  db: Db,
  { gameweek, closesAt, now }: { gameweek: number; closesAt: Date; now: Date },
): Promise<void> {
  await db
    .insert(necroporraRounds)
    .values({ gameweek, closesAt })
    .onConflictDoUpdate({
      target: necroporraRounds.gameweek,
      set: { closesAt },
      where: gt(necroporraRounds.closesAt, now),
    });
}

/** The round for a gameweek, or null if the sync has not named it yet. */
export async function loadRound(db: Db, gameweek: number): Promise<Round | null> {
  const [row] = await db
    .select({ gameweek: necroporraRounds.gameweek, closesAt: necroporraRounds.closesAt })
    .from(necroporraRounds)
    .where(eq(necroporraRounds.gameweek, gameweek));
  return row ?? null;
}

/** Every round the portal has opened, newest first. */
export async function loadRounds(db: Db): Promise<Round[]> {
  return db
    .select({ gameweek: necroporraRounds.gameweek, closesAt: necroporraRounds.closesAt })
    .from(necroporraRounds)
    .orderBy(necroporraRounds.gameweek);
}

/**
 * Records one voter's picks for one round, replacing whatever they had.
 *
 * ONE statement. Neon's HTTP driver has no transactions, so a delete followed by an
 * insert would leave a window in which the voter holds nothing — and it would open that
 * window precisely for the person who was mid-change. The pair living in one row makes
 * the replacement a single upsert, which is the same reasoning that made a team claim one
 * conditional `UPDATE`.
 *
 * The caller has already checked that voting is open and that the pair is legal. This
 * function does not re-check: it is the writer, and duplicating the rule here would put
 * the same decision in two places that could disagree.
 */
export async function castVotes(
  db: Db,
  {
    gameweek,
    teamId,
    picks,
    now,
    enteredBy,
  }: {
    gameweek: number;
    teamId: string;
    picks: string[];
    now: Date;
    enteredBy: string | null;
  },
): Promise<void> {
  const [firstTeamId = null, secondTeamId = null] = picks;
  await db
    .insert(necroporraVotes)
    .values({ gameweek, teamId, firstTeamId, secondTeamId, enteredBy, castAt: now })
    .onConflictDoUpdate({
      target: [necroporraVotes.gameweek, necroporraVotes.teamId],
      // `enteredBy` is in the SET on purpose: the row records who spoke LAST. A manager
      // replacing what an admin typed for them owns the ballot from that moment, and the
      // page stops saying it was entered.
      set: { firstTeamId, secondTeamId, enteredBy, castAt: now },
    });
}

/** Every ballot for the given rounds. Empty when no round is named. */
export async function loadBallots(db: Db, gameweeks: number[]): Promise<Ballot[]> {
  if (gameweeks.length === 0) return [];
  return db
    .select({
      gameweek: necroporraVotes.gameweek,
      teamId: necroporraVotes.teamId,
      firstTeamId: necroporraVotes.firstTeamId,
      secondTeamId: necroporraVotes.secondTeamId,
      enteredBy: necroporraVotes.enteredBy,
      castAt: necroporraVotes.castAt,
    })
    .from(necroporraVotes)
    .where(inArray(necroporraVotes.gameweek, gameweeks));
}

/** One team's ballot for one round, or null if nobody has voted for it. */
export async function loadMyBallot(
  db: Db,
  { gameweek, teamId }: { gameweek: number; teamId: string },
): Promise<Ballot | null> {
  const [row] = await db
    .select({
      gameweek: necroporraVotes.gameweek,
      teamId: necroporraVotes.teamId,
      firstTeamId: necroporraVotes.firstTeamId,
      secondTeamId: necroporraVotes.secondTeamId,
      enteredBy: necroporraVotes.enteredBy,
      castAt: necroporraVotes.castAt,
    })
    .from(necroporraVotes)
    .where(
      and(eq(necroporraVotes.gameweek, gameweek), eq(necroporraVotes.teamId, teamId)),
    );
  return row ?? null;
}

/**
 * Who may be voted for: every team in the league.
 *
 * It used to be every team with a claim, because a ballot hung off an account. The ballot
 * hangs off the team now, so a manager with no account is a voter who cannot yet vote for
 * themselves — and the page says exactly that, by drawing their row with no picks until
 * an admin enters what they sent by other means.
 *
 * The name comes from `teams.manager_name`, which is how this league knows each other and
 * what the standings print. That also retired `loadVoterNames`, whose whole job was
 * mapping accounts to manager names with a fallback for somebody who had released a team.
 */
export async function loadVoters(db: Db): Promise<Voter[]> {
  const rows = await db.select({ teamId: teams.id, name: teams.managerName }).from(teams);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
