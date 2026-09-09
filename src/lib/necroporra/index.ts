import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { necroporraRounds, necroporraVotes, teams, user } from "@/lib/db/schema";
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
    userId,
    picks,
    now,
  }: { gameweek: number; userId: string; picks: string[]; now: Date },
): Promise<void> {
  const [firstTeamId = null, secondTeamId = null] = picks;
  await db
    .insert(necroporraVotes)
    .values({ gameweek, userId, firstTeamId, secondTeamId, castAt: now })
    .onConflictDoUpdate({
      target: [necroporraVotes.gameweek, necroporraVotes.userId],
      set: { firstTeamId, secondTeamId, castAt: now },
    });
}

/** Every ballot for the given rounds. Empty when no round is named. */
export async function loadBallots(db: Db, gameweeks: number[]): Promise<Ballot[]> {
  if (gameweeks.length === 0) return [];
  return db
    .select({
      gameweek: necroporraVotes.gameweek,
      userId: necroporraVotes.userId,
      firstTeamId: necroporraVotes.firstTeamId,
      secondTeamId: necroporraVotes.secondTeamId,
    })
    .from(necroporraVotes)
    .where(inArray(necroporraVotes.gameweek, gameweeks));
}

/** One voter's ballot for one round, or null if they have not voted. */
export async function loadMyBallot(
  db: Db,
  { gameweek, userId }: { gameweek: number; userId: string },
): Promise<Ballot | null> {
  const [row] = await db
    .select({
      gameweek: necroporraVotes.gameweek,
      userId: necroporraVotes.userId,
      firstTeamId: necroporraVotes.firstTeamId,
      secondTeamId: necroporraVotes.secondTeamId,
    })
    .from(necroporraVotes)
    .where(
      and(eq(necroporraVotes.gameweek, gameweek), eq(necroporraVotes.userId, userId)),
    );
  return row ?? null;
}

/**
 * Voter names, for the season table and for a closed round's ballots.
 *
 * The manager's name from `teams`, not the Google display name from `user`: the league
 * knows each other by manager name, and this table sits beside the standings, which uses
 * the same one. Falls back to the account name for a voter who has since released their
 * team, so a past round's ballot never renders as a bare id.
 */
export async function loadVoterNames(db: Db): Promise<Map<string, string>> {
  const [managers, accounts] = await Promise.all([
    db
      .select({ userId: teams.userId, managerName: teams.managerName })
      .from(teams),
    db.select({ id: user.id, name: user.name }).from(user),
  ]);

  const names = new Map(accounts.map((a) => [a.id, a.name]));
  for (const m of managers) if (m.userId !== null) names.set(m.userId, m.managerName);
  return names;
}

/**
 * Who may vote: every manager who has claimed a team.
 *
 * The eligible set, not the set who voted — the page shows a manager with no ballot as
 * exactly that, and it cannot do so without knowing who was expected. Read from `teams`
 * rather than from `user`, because holding a team is what makes somebody a voter: an
 * account with no claim can read the Necroporra and cannot vote in it.
 */
export async function loadVoters(db: Db): Promise<Voter[]> {
  const rows = await db
    .select({ userId: teams.userId, name: teams.managerName })
    .from(teams)
    .where(isNotNull(teams.userId));
  return rows
    .filter((row): row is { userId: string; name: string } => row.userId !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
