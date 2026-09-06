import { eq, lt } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { gameweeks, rawSyncPayloads, syncRuns, teamGameweekStats, teams } from "@/lib/db/schema";
import type { FantasyClient } from "@/lib/fantasy-client";
import type { StandingEntry } from "@/lib/fantasy-client/schemas";
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
    for (let w = 1; w <= week.weekNumber; w += 1) if (!settled.has(w)) wanted.push(w);

    const weeksSynced: number[] = [];
    for (const w of wanted) {
      const isCurrent = w === week.weekNumber;
      const provisional = isCurrent && week.isLive;
      const entries = await client.getStanding(provisional ? undefined : w);
      if (entries.length === 0) continue;

      await db
        .insert(gameweeks)
        .values({
          number: w,
          opensAt: isCurrent ? week.openingWeekDate : now,
          closesAt: isCurrent ? week.closingWeekDate : now,
          isLive: provisional,
        })
        .onConflictDoUpdate({ target: gameweeks.number, set: { isLive: provisional } });

      for (const write of upsertTeams(db, entries)) await write;
      for (const write of upsertStats(db, entries, w, provisional)) await write;
      await db.insert(rawSyncPayloads).values({
        id: `${runId}-${w}`,
        endpoint: `standing/${provisional ? "live" : w}`,
        payload: entries,
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
      error: error instanceof Error ? error.message : String(error),
    }).where(eq(syncRuns.id, runId));
    throw error;
  }
}

function upsertTeams(db: Db, entries: StandingEntry[]) {
  return entries.map((e) =>
    db.insert(teams).values({
      id: e.team.id,
      managerId: e.team.managerId,
      managerName: e.team.manager.managerName,
    }).onConflictDoUpdate({
      target: teams.id,
      set: { managerName: e.team.manager.managerName },
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
function upsertStats(db: Db, entries: StandingEntry[], gameweek: number, live: boolean) {
  return entries.map((e) => {
    const measured = {
      teamId: e.team.id,
      gameweek,
      points: e.points,
      roundPosition: e.position,
      livePoints: e.livePoints ?? null,
      isProvisional: live,
      syncedAt: new Date(),
    };

    return db
      .insert(teamGameweekStats)
      .values({
        ...measured,
        teamValue: live ? e.team.teamValue : null,
        teamPoints: live ? e.team.teamPoints : null,
      })
      .onConflictDoUpdate({
        target: [teamGameweekStats.teamId, teamGameweekStats.gameweek],
        set: live
          ? { ...measured, teamValue: e.team.teamValue, teamPoints: e.team.teamPoints }
          : measured,
      });
  });
}

/** Drops raw payloads past the retention window. They exist to debug a shape change, not to accumulate. */
async function prunePayloads(db: Db, now: Date) {
  const cutoff = new Date(now.getTime() - PAYLOAD_RETENTION_MS);
  await db.delete(rawSyncPayloads).where(lt(rawSyncPayloads.fetchedAt, cutoff));
}
