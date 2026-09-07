import { eq, lt } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { gameweeks, rawSyncPayloads, syncRuns, teamGameweekStats, teams } from "@/lib/db/schema";
import type { FantasyClient, Gameweek, StandingRow } from "@/lib/fantasy-client";
import { describeFailure } from "./failure";
import { decideNextRun } from "./next-run";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type SyncResult = { weeksSynced: number[]; nextRunAt: Date };

const PAYLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One sync run.
 *
 * Writes are plain sequential awaits — never wrapped in a database transaction and
 * never sent as a single batch: transactions work in tests but fail in production,
 * batching does the reverse. The upserts are idempotent, so a run that dies halfway
 * is corrected by the next one.
 *
 * Everything this reads about LaLiga arrives already mapped by `lib/fantasy-client/`.
 * No API-shaped type reaches here on purpose: the client is the only place that knows
 * what a field means, and the one time a raw entry crossed that line, the difference
 * between "the season so far" and "this week's score" crossed with it unexamined.
 */
export async function runSync(deps: {
  db: Db;
  client: FantasyClient;
  now: Date;
  runId: string;
  trigger: "schedule" | "manual";
}): Promise<SyncResult> {
  const { db, client, now, runId, trigger } = deps;

  await db.insert(syncRuns).values({ id: runId, trigger, status: "running" });

  try {
    const week = await client.getCurrentWeek();

    const existing = await db.select().from(teamGameweekStats);
    const settled = new Set(
      existing.filter((r) => !r.isProvisional).map((r) => r.gameweek),
    );

    // Every week up to the current one that we do not already hold as settled.
    const wanted: number[] = [];
    for (let w = 1; w <= week.number; w += 1) if (!settled.has(w)) wanted.push(w);

    const weeksSynced: number[] = [];
    for (const w of wanted) {
      const isCurrent = w === week.number;
      const live = isCurrent && week.isLive;
      const { rows, raw } = await client.getStanding(live ? undefined : w);
      if (rows.length === 0) continue;
      if (isCurrent && !live && !hasBeenPlayed(week, rows, now)) continue;

      // Only the current week's dates are reported, so a backfilled week leaves them
      // null; a later run that finds it current fills them in. Overwriting a known
      // pair with nulls is what the conditional spread avoids.
      const dates = isCurrent ? { opensAt: week.opensAt, closesAt: week.closesAt } : {};
      await db
        .insert(gameweeks)
        .values({ number: w, isLive: live, ...dates })
        .onConflictDoUpdate({ target: gameweeks.number, set: { isLive: live, ...dates } });

      for (const write of upsertTeams(db, rows)) await write;
      for (const write of upsertStats(db, rows, w, live)) await write;
      await db.insert(rawSyncPayloads).values({
        id: `${runId}-${w}`,
        endpoint: `standing/${live ? "live" : w}`,
        payload: raw,
      });

      weeksSynced.push(w);
    }

    await prunePayloads(db, now);

    const nextRunAt = decideNextRun(week, now);
    await db.update(syncRuns).set({
      status: "succeeded", finishedAt: new Date(), weeksSynced: weeksSynced.length,
    }).where(eq(syncRuns.id, runId));

    return { weeksSynced, nextRunAt };
  } catch (error) {
    await db.update(syncRuns).set({
      status: "failed",
      finishedAt: new Date(),
      error: describeFailure(error),
    }).where(eq(syncRuns.id, runId));
    throw error;
  }
}

/**
 * Whether the week the API still calls "current" has actually been played, and may
 * therefore be recorded as settled.
 *
 * Whether `week/current` waits for a round to open before naming it is not verified,
 * and cannot be probed from here — so the code has to be safe under either reading. A
 * round named early and written settled would land in the settled set for good: never
 * fetched again when it does go live, its live table lost and its team value null for
 * ever. That is the same permanent hole the provisional/settled split exists to
 * prevent, reached by a different door.
 *
 * Both signals must agree before we believe the round happened: its closing time is
 * behind us, and somebody scored something.
 */
function hasBeenPlayed(week: Gameweek, rows: StandingRow[], now: Date): boolean {
  const closed = week.closesAt.getTime() <= now.getTime();
  return closed && rows.some((row) => row.weekPoints !== 0);
}

function upsertTeams(db: Db, rows: StandingRow[]) {
  return rows.map((row) =>
    db.insert(teams).values({
      id: row.teamId,
      managerId: row.managerId,
      managerName: row.managerName,
    }).onConflictDoUpdate({
      target: teams.id,
      set: { managerName: row.managerName },
    }),
  );
}

/**
 * `teamValue` and `teamPoints` describe CURRENT state — verified identical between a
 * past gameweek's response and today's — so they are only truthful for the week we
 * are observing live. A backfilled week writes null for both.
 *
 * When a live week later settles, the update deliberately does NOT touch those two
 * columns: the value we recorded while the week was live is the only reading we will
 * ever have for it, and overwriting it with null would destroy the very history this
 * slice exists to build.
 */
function upsertStats(db: Db, rows: StandingRow[], gameweek: number, live: boolean) {
  return rows.map((row) => {
    const measured = {
      teamId: row.teamId,
      gameweek,
      points: row.weekPoints,
      roundPosition: row.roundPosition,
      livePoints: row.livePoints,
      isProvisional: live,
      syncedAt: new Date(),
    };

    return db
      .insert(teamGameweekStats)
      .values({
        ...measured,
        teamValue: live ? row.teamValue : null,
        teamPoints: live ? row.teamPoints : null,
      })
      .onConflictDoUpdate({
        target: [teamGameweekStats.teamId, teamGameweekStats.gameweek],
        set: live
          ? { ...measured, teamValue: row.teamValue, teamPoints: row.teamPoints }
          : measured,
      });
  });
}

/** Drops raw payloads past the retention window. They exist to debug a shape change, not to accumulate. */
async function prunePayloads(db: Db, now: Date) {
  const cutoff = new Date(now.getTime() - PAYLOAD_RETENTION_MS);
  await db.delete(rawSyncPayloads).where(lt(rawSyncPayloads.fetchedAt, cutoff));
}
