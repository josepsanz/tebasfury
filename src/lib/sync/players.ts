import { and, eq, notInArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import {
  playerGameweekPoints,
  playerValueSnapshots,
  players,
  squadMembers,
  syncRuns,
  teams,
} from "@/lib/db/schema";
import type { FantasyClient, PlayerRow } from "@/lib/fantasy-client";
import { describeFailure } from "./failure";
import { nextPlayerSweep } from "./next-run";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The two calls a sweep makes. Narrower than `FantasyClient`, so a fake is two lines. */
export type PlayerClient = Pick<FantasyClient, "getPlayers" | "getSquad">;

export type PlayerSweepResult = {
  playersSynced: number;
  squadsSynced: number;
  nextRunAt: Date;
};

/**
 * Below this, the response is treated as broken rather than believed.
 *
 * A truncated catalogue written over a good one is worse than a skipped day: the
 * players it drops keep their history but stop being listed, and nothing says why.
 * The real catalogue is around six hundred.
 */
export const MINIMUM_CATALOGUE = 100;

/**
 * Rows per statement.
 *
 * Writes go out as multi-row `INSERT … VALUES (…), (…) ON CONFLICT`, which is ONE
 * statement and one round trip — not `db.batch()`, which does not exist on the PGlite
 * instance the tests use, and not a transaction, which does not work on Neon's HTTP
 * driver. Row by row would be the alternative, and by the end of a season the points
 * backfill alone is six hundred players times thirty-eight weeks: twenty-two thousand
 * round trips, well past the function timeout. Postgres caps a statement at 65,535
 * bound parameters; 400 rows of seven columns (the widest write, `upsertCatalogue`'s)
 * is comfortably inside it.
 */
const CHUNK = 400;

function chunked<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/** The day a snapshot belongs to. UTC, so a sweep's zone cannot move the key. */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * One daily sweep of the player catalogue.
 *
 * A second cadence rather than more work inside the ten-minute standings chain:
 * player data does not move at that rate, and sweeping an unofficial, undocumented API
 * every ten minutes would be rude and pointless. Two calls plus one per team.
 *
 * Like `runSync`, writes are plain sequential awaits — never a transaction and never
 * `db.batch()` — and every one of them is idempotent, so a sweep that dies halfway is
 * corrected by the next one.
 */
export async function runPlayerSweep(deps: {
  db: Db;
  client: PlayerClient;
  now: Date;
  runId: string;
  trigger: "players-schedule" | "players-manual";
}): Promise<PlayerSweepResult> {
  const { db, client, now, runId, trigger } = deps;

  await db.insert(syncRuns).values({ id: runId, trigger, status: "running" });

  try {
    const catalogue = await client.getPlayers();

    if (catalogue.length < MINIMUM_CATALOGUE) {
      throw new Error(
        `The players endpoint returned only ${catalogue.length} players, which is ` +
          `below the ${MINIMUM_CATALOGUE} needed to be believable. The catalogue was ` +
          `left as it was.`,
      );
    }

    await upsertCatalogue(db, catalogue, now);
    await appendValueSnapshots(db, catalogue, now);
    await backfillPoints(db, catalogue);
    const squadsSynced = await replaceSquads(db, client);

    const nextRunAt = nextPlayerSweep(now);
    await db
      .update(syncRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(syncRuns.id, runId));

    return { playersSynced: catalogue.length, squadsSynced, nextRunAt };
  } catch (error) {
    await db
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date(), error: describeFailure(error) })
      .where(eq(syncRuns.id, runId));
    throw error;
  }
}

/**
 * `firstSeenAt` is never in the update set: it is when we first saw the player, and a
 * sweep that sees them again does not change that. `lastSeenAt` is, and it is the only
 * thing that will tell a player who left the competition from one who is merely
 * unowned.
 *
 * No `realTeamName` here: the `players` table Task 2 built has no such column — the
 * API's catalogue carries no club name anywhere, only `realTeamId`.
 */
async function upsertCatalogue(db: Db, catalogue: PlayerRow[], now: Date) {
  const rows = catalogue.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    position: p.position,
    realTeamId: p.realTeamId,
    status: p.status,
    imageUrl: p.imageUrl,
    lastSeenAt: now,
  }));

  for (const chunk of chunked(rows)) {
    await db
      .insert(players)
      .values(chunk)
      .onConflictDoUpdate({
        target: players.id,
        set: {
          nickname: sql`excluded.nickname`,
          position: sql`excluded.position`,
          realTeamId: sql`excluded.real_team_id`,
          status: sql`excluded.status`,
          imageUrl: sql`excluded.image_url`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
  }
}

/**
 * One dated reading per player per day.
 *
 * On conflict the day's value is UPDATED rather than left alone: a second sweep on the
 * same day carries the more recent measurement, and a day is the finest resolution
 * this cadence can honestly claim anyway.
 */
async function appendValueSnapshots(db: Db, catalogue: PlayerRow[], now: Date) {
  const takenOn = utcDate(now);
  const rows = catalogue.map((p) => ({ playerId: p.id, takenOn, value: p.marketValue }));

  for (const chunk of chunked(rows)) {
    await db
      .insert(playerValueSnapshots)
      .values(chunk)
      .onConflictDoUpdate({
        target: [playerValueSnapshots.playerId, playerValueSnapshots.takenOn],
        set: { value: sql`excluded.value` },
      });
  }
}

/**
 * Ruling 2: `weekPoints` carries its own gameweek label — `{ week, points }` — and it
 * must be read by that label, never by array position. The raw response's arrays are
 * unordered (179 of 836 captured players) and sparse (174 of 836), with gameweek 5
 * absent while 6 is present for clubs that played their sixth fixture before their
 * fourth. Reading `weekPoints[i]` as gameweek `i + 1` — the brief's original text —
 * would file one club's week-6 score under week 4. The client already sorts
 * ascending by week, but sorted-and-sparse is still not `1..n`, so the label is what
 * is trusted, not the position.
 *
 * Written on every sweep, not only the first: a gameweek in play has its points
 * revised, and the conflict update is what lets a later sweep correct an earlier one.
 */
async function backfillPoints(db: Db, catalogue: PlayerRow[]) {
  const rows = catalogue.flatMap((p) =>
    p.weekPoints.map(({ week, points }) => ({
      playerId: p.id,
      gameweek: week,
      points,
    })),
  );

  for (const chunk of chunked(rows)) {
    await db
      .insert(playerGameweekPoints)
      .values(chunk)
      .onConflictDoUpdate({
        target: [playerGameweekPoints.playerId, playerGameweekPoints.gameweek],
        set: { points: sql`excluded.points` },
      });
  }
}

/**
 * Squads, one call per team, from the teams the standings cadence has recorded.
 *
 * Insert-then-prune rather than delete-then-insert: `firstSeenAt` means "in this squad
 * since", and deleting every row each sweep would reset it to today for a player who
 * has not moved in months.
 */
async function replaceSquads(db: Db, client: PlayerClient): Promise<number> {
  const known = await db.select().from(teams);

  for (const team of known) {
    const squad = await client.getSquad(team.id);

    if (squad.playerIds.length > 0) {
      for (const chunk of chunked(squad.playerIds)) {
        await db
          .insert(squadMembers)
          .values(chunk.map((playerId) => ({ teamId: team.id, playerId })))
          .onConflictDoNothing({
            target: [squadMembers.teamId, squadMembers.playerId],
          });
      }
      await db
        .delete(squadMembers)
        .where(
          and(
            eq(squadMembers.teamId, team.id),
            notInArray(squadMembers.playerId, squad.playerIds),
          ),
        );
    } else {
      // `notInArray` against an empty list is not valid SQL, and an empty squad is a
      // real answer — an emptied team owns nobody.
      await db.delete(squadMembers).where(eq(squadMembers.teamId, team.id));
    }
  }

  return known.length;
}
