import { and, eq, isNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { gameweeks, players, roundLineupPlayers, roundLineups, teams } from "@/lib/db/schema";
import { loadStoredLineupWeeks } from "@/lib/db/queries";
import type { FantasyClient, LineupRow } from "@/lib/fantasy-client";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The one call a lineup capture needs. Narrower than `FantasyClient`, so a fake is a few lines. */
export type LineupClient = Pick<FantasyClient, "getLineup">;

export type LineupSweepResult = {
  /** Lineups fetched and written this sweep, settled or live. */
  captured: number;
  /** A settled week already stored, and correctly left alone — see the budget below. */
  skipped: number;
  /**
   * One team's fetch or write that failed, counted rather than raised — including an
   * eleven that filtered down to nobody at all (see `captureLineups`'s doc comment).
   */
  failed: number;
  /**
   * Fielded ids `players` did not recognise, dropped rather than failing the whole
   * eleven — the same tolerance `replaceSquads` applies to a squad response, but
   * checked against a different set. See `captureLineups` for why.
   */
  droppedPlayers: number;
};

/**
 * Captures what every known team fielded, for every gameweek that has started.
 *
 * "Started" comes from `gameweeks` alone — a row only exists there once a week has
 * gone live — never from a flag this function invents. That is the league's ruling
 * that the portal must not show a rival's provisional, pre-kickoff eleven, and it is
 * enforced here by which weeks are even considered, not by a check that could be
 * forgotten in some other caller.
 *
 * A settled (non-live) week already stored is skipped: a frozen lineup cannot change,
 * and thirteen calls a week against an unofficial API is the whole budget this
 * feature gets. The live week is re-asked on every sweep regardless of what is
 * stored, because its points keep climbing until the round settles.
 *
 * One team's failure — a bad fetch, or a write that could not go through — is caught,
 * counted and skipped; it never fails the other teams' lineups, and it never fails
 * the sweep that called this. See `runPlayerSweep`, which hangs this call with the
 * comment explaining why this ruling is the opposite of `getActivity`'s.
 *
 * The eleven is filtered against `players` — read here, fresh, not against
 * `runPlayerSweep`'s catalogue-only `knownPlayerIds` that `replaceSquads` uses. That
 * difference is deliberate, not an oversight to "harmonise" away:
 *
 *   - A squad is CURRENT state. A player no longer in today's catalogue should not
 *     still be sitting in someone's squad, so the catalogue itself IS the right
 *     universe to check a squad against.
 *   - A lineup is a HISTORICAL record of a round already played. A player fielded in
 *     week 2 who has since left LaLiga is correctly absent from today's catalogue —
 *     but `upsertCatalogue` never deletes a row, it only moves `status`, so that
 *     player is still sitting in `players`, which is what `round_lineup_players
 *     .player_id`'s foreign key actually targets. Filtering against the catalogue
 *     would be stricter than the constraint it exists to protect, and it would
 *     silently and permanently erase real history the moment a player's career ends —
 *     a settled round is written once, so there is no later sweep to correct it.
 *
 * Read after `upsertCatalogue` has run (see `runPlayerSweep`), `players` already holds
 * this sweep's fresh catalogue plus every id the portal has ever seen, so this one
 * query is both the looser and the correct universe for a lineup.
 */
export async function captureLineups(
  db: Db,
  client: LineupClient,
  { now }: { now: Date },
): Promise<LineupSweepResult> {
  const [weeks, knownTeams, stored, everKnownPlayers] = await Promise.all([
    db
      .select({ number: gameweeks.number, isLive: gameweeks.isLive })
      .from(gameweeks)
      .orderBy(gameweeks.number),
    // A departed manager's lineups are refused by the API, and the weeks they played
    // are already stored — see `teams.leftAt`.
    db.select({ id: teams.id }).from(teams).where(isNull(teams.leftAt)),
    loadStoredLineupWeeks(db),
    db.select({ id: players.id }).from(players),
  ]);
  const knownPlayerIds = new Set(everKnownPlayers.map((p) => p.id));

  let captured = 0;
  let skipped = 0;
  let failed = 0;
  let droppedPlayers = 0;

  for (const team of knownTeams) {
    for (const week of weeks) {
      const alreadyStored = stored.has(`${team.id}:${week.number}`);
      if (alreadyStored && !week.isLive) {
        skipped += 1;
        continue;
      }

      try {
        const lineup = await client.getLineup(team.id, week.number);
        const validPlayers = lineup.players.filter((p) => knownPlayerIds.has(p.playerId));
        droppedPlayers += lineup.players.length - validPlayers.length;

        if (validPlayers.length === 0) {
          // Every fielded id was unknown even to `players` — not one plausible eleven
          // to store. Writing the header alone here would produce exactly the empty
          // pitch Finding 1 was about, and `loadStoredLineupWeeks` only counts a pair
          // as stored when it has player rows behind it (see its own comment), so that
          // header would never be seen as done and would be re-fetched every sweep,
          // for ever — quietly burning the thirteen-calls-per-week budget for this one
          // team. Counting it as failed instead keeps the retry bounded and honest.
          failed += 1;
          continue;
        }

        await writeLineup(db, { ...lineup, players: validPlayers }, now);
        captured += 1;
      } catch {
        // One team's lineup, gone this sweep. The next sweep asks again — nothing here
        // is lost the way a missed activity page would be.
        failed += 1;
      }
    }
  }

  return { captured, skipped, failed, droppedPlayers };
}

/**
 * Writes one team's lineup: the header, then its eleven, in that order and as two
 * separate statements — never a transaction, Neon's HTTP driver has none.
 *
 * The header goes first on every call, including a retry: `round_lineup_players`
 * carries no foreign key back to `round_lineups` (see the schema comment), so nothing
 * stops the players from landing without their header. Writing the header first means
 * a sweep that dies between the two statements leaves an empty pitch — a header with
 * no eleven — rather than eleven rows nothing points to, which the page could not even
 * find to show as empty.
 *
 * The eleven are replaced by delete-then-insert, not upserted by player id: an upsert
 * would leave behind whoever was dropped from the lineup between two fetches of a live
 * round, and that is the one place a stale row could survive.
 */
async function writeLineup(db: Db, lineup: LineupRow, now: Date): Promise<void> {
  await db
    .insert(roundLineups)
    .values({
      teamId: lineup.teamId,
      gameweek: lineup.gameweek,
      formation: lineup.formation,
      points: lineup.points,
      snapshotTookOn: lineup.snapshotTookOn,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: [roundLineups.teamId, roundLineups.gameweek],
      set: {
        formation: sql`excluded.formation`,
        points: sql`excluded.points`,
        snapshotTookOn: sql`excluded.snapshot_took_on`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });

  await db
    .delete(roundLineupPlayers)
    .where(
      and(
        eq(roundLineupPlayers.teamId, lineup.teamId),
        eq(roundLineupPlayers.gameweek, lineup.gameweek),
      ),
    );

  if (lineup.players.length === 0) return;

  await db.insert(roundLineupPlayers).values(
    lineup.players.map((p) => ({
      teamId: lineup.teamId,
      gameweek: lineup.gameweek,
      playerId: p.playerId,
      line: p.line,
      weekPoints: p.weekPoints,
      inIdeal: p.inIdeal,
    })),
  );
}
