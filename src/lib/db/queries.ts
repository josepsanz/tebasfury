import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";
import type { Snapshot, TeamRef } from "@/lib/domain/standings";
import { gameweeks, syncRuns, teamGameweekStats, teams } from "./schema";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type PortalData = {
  snapshots: Snapshot[];
  teams: TeamRef[];
  lastSync: Date | null;
  currentGameweek: number | null;
  isLive: boolean;
};

/** Everything both views need, in one read. */
export async function loadSnapshots(db: Db): Promise<PortalData> {
  const [stats, teamRows, weeks, runs] = await Promise.all([
    db.select().from(teamGameweekStats),
    db.select().from(teams),
    db.select().from(gameweeks).orderBy(desc(gameweeks.number)).limit(1),
    db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.status, "succeeded"))
      .orderBy(desc(syncRuns.finishedAt))
      .limit(1),
  ]);

  return {
    snapshots: stats.map((r) => ({
      teamId: r.teamId,
      gameweek: r.gameweek,
      points: r.points,
      roundPosition: r.roundPosition,
      livePoints: r.livePoints,
      isProvisional: r.isProvisional,
      teamValue: r.teamValue,
    })),
    teams: teamRows.map((t) => ({ id: t.id, managerName: t.managerName })),
    lastSync: runs[0]?.finishedAt ?? null,
    currentGameweek: weeks[0]?.number ?? null,
    isLive: weeks[0]?.isLive ?? false,
  };
}
