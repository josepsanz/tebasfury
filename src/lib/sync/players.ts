import { and, count, eq, notInArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import {
  marketOperations,
  playerGameweekPoints,
  playerValueSnapshots,
  players,
  realTeams,
  squadMembers,
  syncRuns,
  teams,
} from "@/lib/db/schema";
import type { FantasyClient, MarketOperationRow, PlayerRow, RealTeamRow } from "@/lib/fantasy-client";
import { describeFailure } from "./failure";
import { nextPlayerSweep } from "./next-run";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The calls a sweep makes. Narrower than `FantasyClient`, so a fake is a few lines. */
export type PlayerClient = Pick<FantasyClient, "getPlayers" | "getSquad" | "getActivity">;

export type PlayerSweepResult = {
  playersSynced: number;
  squadsSynced: number;
  /**
   * Teams whose squad response came back empty (or entirely of unknown player ids)
   * while the database already held members for them. Skipped rather than wiped —
   * see `replaceSquads` — because a team in a 13-manager league cannot own nobody,
   * so an empty response reads as an API hiccup, not a fact.
   */
  squadsSkipped: number;
  /** Squad member ids the catalogue did not recognise, dropped rather than failing the sweep. */
  droppedSquadPlayers: number;
  /**
   * How many clubs the catalogue can put a NAME to — the row count of `real_teams`
   * after this sweep, not the number of clubs this sweep happened to observe. The two
   * differ whenever a club was learned earlier and not seen today, and the accumulated
   * total is the one that answers the question actually being asked.
   *
   * Ruling 1 accepts that coverage may never reach twenty. This counter is the only
   * place that gap is visible without opening the database.
   */
  realTeamsKnown: number;
  /**
   * Market operations written by this sweep — the size of the feed, not the number of
   * new rows, because the seven-day window overlaps six days with yesterday's read.
   *
   * Reported on every sweep rather than only when it is zero: a feed that suddenly
   * returns nothing is the shape of a broken capture, and a number that only appears
   * when something is wrong cannot show that nothing is.
   */
  operationsCaptured: number;
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
 * Rows per statement, sized per write rather than once for all four.
 *
 * Writes go out as multi-row `INSERT … VALUES (…), (…) ON CONFLICT`, which is ONE
 * statement and one round trip — not `db.batch()`, which does not exist on the PGlite
 * instance the tests use, and not a transaction, which does not work on Neon's HTTP
 * driver. Row by row would be the alternative, and by the end of a season the points
 * backfill alone is eight hundred players times thirty-eight weeks: thirty-two
 * thousand round trips, far past the function timeout.
 *
 * Postgres caps a statement at 65,535 bound parameters, and that cap is `rows ×
 * columns` — so it is a budget per write, not one number for the sweep. A single
 * constant tuned for the widest write made the narrowest one, the points backfill,
 * take five times the round trips it needs, and the points backfill is the only write
 * here that grows every gameweek:
 *
 *   `players`                 7 columns × 400   = 2,800 parameters
 *   `player_value_snapshots`  3 columns × 2,000 = 6,000 parameters
 *   `player_gameweek_points`  3 columns × 2,000 = 6,000 parameters
 *   `squad_members`           2 columns × 2,000 = 4,000 parameters
 *
 * Every one of those is an order of magnitude inside the cap, which is deliberate:
 * a column added to any of these tables must not silently cross it. What the larger
 * sizes buy is round trips — a full-season points backfill of ~32,000 rows goes out
 * in 16 statements instead of 80, which is the difference the function timeout cares
 * about. Anything raised here must be re-checked against `65,535 / columns`.
 */
export const CHUNK_CATALOGUE = 400;
export const CHUNK_VALUES = 2_000;
export const CHUNK_POINTS = 2_000;
export const CHUNK_SQUAD = 2_000;

function chunked<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
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
    // The FK from squad_members.player_id targets players.id, so the id set the squad
    // response is checked against is exactly what upsertCatalogue just wrote — not a
    // stale read of the table from before this sweep.
    const knownPlayerIds = new Set(catalogue.map((p) => p.id));
    const squads = await replaceSquads(db, client, knownPlayerIds);

    await upsertRealTeams(db, squads.realTeams, now);
    const [clubCount] = await db.select({ value: count() }).from(realTeams);

    // Ruling 6: NOT wrapped in a tolerance. If this throws, the sweep fails, QStash
    // retries, and every write above is idempotent so the retry is free. The
    // alternative — carrying on quietly — loses operations that no later sweep can
    // recover, because the feed's window will have rolled past them.
    const operations = await client.getActivity();
    await upsertOperations(db, operations);

    const nextRunAt = nextPlayerSweep(now);
    await db
      .update(syncRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(syncRuns.id, runId));

    return {
      playersSynced: catalogue.length,
      squadsSynced: squads.squadsSynced,
      squadsSkipped: squads.squadsSkipped,
      droppedSquadPlayers: squads.droppedSquadPlayers,
      realTeamsKnown: clubCount.value,
      operationsCaptured: operations.length,
      nextRunAt,
    };
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

  for (const chunk of chunked(rows, CHUNK_CATALOGUE)) {
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

  for (const chunk of chunked(rows, CHUNK_VALUES)) {
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

  for (const chunk of chunked(rows, CHUNK_POINTS)) {
    await db
      .insert(playerGameweekPoints)
      .values(chunk)
      .onConflictDoUpdate({
        target: [playerGameweekPoints.playerId, playerGameweekPoints.gameweek],
        set: { points: sql`excluded.points` },
      });
  }
}

type SquadSweepResult = {
  squadsSynced: number;
  squadsSkipped: number;
  droppedSquadPlayers: number;
  realTeams: RealTeamRow[];
};

/**
 * Squads, one call per team, from the teams the standings cadence has recorded.
 *
 * Insert-then-prune rather than delete-then-insert: `firstSeenAt` means "in this squad
 * since", and deleting every row each sweep would reset it to today for a player who
 * has not moved in months.
 *
 * Two defensive checks against an undocumented, unofficial API:
 *
 * - Every incoming id is checked against `knownPlayerIds` (this sweep's own catalogue)
 *   before it is inserted. `squad_members.player_id` has an FK to `players.id`, and
 *   `onConflictDoNothing` does not absorb an FK violation — a single squad naming a
 *   player the catalogue did not return would otherwise throw, failing the whole sweep
 *   and every hourly retry after it, for ever.
 * - A response that, after that filter, names nobody is refused rather than believed
 *   for a team that already had members. A team in a 13-manager league cannot field a
 *   lineup of nobody, so an empty response is far more likely a fetch hiccup than a
 *   fact, and deleting would wipe `firstSeenAt` — the one column nothing can recompute.
 *   A team that has genuinely never had a recorded squad (the very first sweep, before
 *   any of its players were seen) has nothing to protect, so that case still clears.
 */
async function replaceSquads(
  db: Db,
  client: PlayerClient,
  knownPlayerIds: Set<string>,
): Promise<SquadSweepResult> {
  const known = await db.select().from(teams);
  let squadsSkipped = 0;
  let droppedSquadPlayers = 0;
  const clubs = new Map<string, RealTeamRow>();

  for (const team of known) {
    const squad = await client.getSquad(team.id);

    // Clubs are learned from every response that PARSED — including one whose
    // membership the guard below then refuses. That guard protects `firstSeenAt` from
    // a suspicious response; it does not make a club name in it false.
    for (const c of squad.realTeams) clubs.set(c.id, c);

    const validIds = squad.playerIds.filter((id) => knownPlayerIds.has(id));
    droppedSquadPlayers += squad.playerIds.length - validIds.length;

    if (validIds.length > 0) {
      for (const chunk of chunked(validIds, CHUNK_SQUAD)) {
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
            notInArray(squadMembers.playerId, validIds),
          ),
        );
      continue;
    }

    // `notInArray` against an empty list is not valid SQL, and an empty (or entirely
    // unrecognised) response is not automatically a real answer the way it is for the
    // catalogue floor above — see the plausibility check in the doc comment.
    const [existing] = await db
      .select({ playerId: squadMembers.playerId })
      .from(squadMembers)
      .where(eq(squadMembers.teamId, team.id))
      .limit(1);

    if (existing) {
      squadsSkipped += 1;
      continue;
    }

    await db.delete(squadMembers).where(eq(squadMembers.teamId, team.id));
  }

  return {
    squadsSynced: known.length,
    squadsSkipped,
    droppedSquadPlayers,
    realTeams: [...clubs.values()],
  };
}

/**
 * The clubs observed this sweep, deduplicated across every squad.
 *
 * One statement, unchunked, and that is deliberate: a competition has about twenty
 * clubs, so ~20 rows × 6 columns ≈ 120 bound parameters — three orders of magnitude
 * inside Postgres's 65,535 cap. Like every other write in this file, a column added
 * here must be re-checked against `65,535 / columns`.
 *
 * `firstSeenAt` is never in the update set; `lastSeenAt` always is. Name, slug and
 * badge are overwritten, so a rebranded club's newest observation wins.
 */
async function upsertRealTeams(db: Db, clubs: RealTeamRow[], now: Date) {
  if (clubs.length === 0) return;

  await db
    .insert(realTeams)
    .values(clubs.map((c) => ({ ...c, lastSeenAt: now })))
    .onConflictDoUpdate({
      target: realTeams.id,
      set: {
        name: sql`excluded.name`,
        slug: sql`excluded.slug`,
        badgeUrl: sql`excluded.badge_url`,
        lastSeenAt: sql`excluded.last_seen_at`,
      },
    });
}

/**
 * The operations the feed reported, upserted by the API's own id.
 *
 * One statement, unchunked: a week of this league's activity was ninety-four rows of
 * eight columns, about 750 bound parameters against Postgres's 65,535 cap. Re-check
 * against `65,535 / columns` if a column is ever added.
 *
 * `firstSeenAt` is never in the update set — it answers "how far back does our log
 * reach", and a re-read of a six-day-old operation must not move that answer forward.
 * Everything else is overwritten, so a corrected amount wins.
 */
async function upsertOperations(db: Db, operations: MarketOperationRow[]) {
  if (operations.length === 0) return;

  await db
    .insert(marketOperations)
    .values(operations)
    .onConflictDoUpdate({
      target: marketOperations.id,
      set: {
        activityType: sql`excluded.activity_type`,
        actorManagerId: sql`excluded.actor_manager_id`,
        counterpartyManagerId: sql`excluded.counterparty_manager_id`,
        playerId: sql`excluded.player_id`,
        amount: sql`excluded.amount`,
        weekNumber: sql`excluded.week_number`,
        occurredAt: sql`excluded.occurred_at`,
      },
    });
}
