import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { gameweeks, roundLineupPlayers, roundLineups, teams } from "@/lib/db/schema";
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
  /** One team's fetch or write that failed, counted rather than raised. */
  failed: number;
  /**
   * Fielded ids the catalogue did not recognise, dropped rather than failing the
   * whole eleven — the same tolerance `replaceSquads` applies to a squad response.
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
 * `knownPlayerIds` is the same set `runPlayerSweep` builds from this sweep's own
 * catalogue for `replaceSquads`, passed in rather than re-read here. `round_lineup_players
 * .player_id` carries the identical foreign key to `players.id` that `squad_members
 * .player_id` does, and the eleven go in as one multi-row insert — one id the catalogue
 * does not recognise would otherwise throw and fail all eleven, after the delete has
 * already run.
 */
export async function captureLineups(
  db: Db,
  client: LineupClient,
  { now, knownPlayerIds }: { now: Date; knownPlayerIds: Set<string> },
): Promise<LineupSweepResult> {
  const [weeks, knownTeams, stored] = await Promise.all([
    db
      .select({ number: gameweeks.number, isLive: gameweeks.isLive })
      .from(gameweeks)
      .orderBy(gameweeks.number),
    db.select({ id: teams.id }).from(teams),
    loadStoredLineupWeeks(db),
  ]);

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
