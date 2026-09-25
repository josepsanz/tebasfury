import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { squadMembers, teams } from "@/lib/db/schema";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Records that a team's manager has left the league.
 *
 * The squad goes with them: a departing manager's players go back to the market, so
 * rows left in `squad_members` would keep showing them as owned — with clauses and
 * locks — on /market, /teams and /fair-play. Everything else the team did stays; see
 * `teams.leftAt`.
 *
 * Idempotent: a team already marked keeps the date it was first found gone.
 */
export async function markDeparted(db: Db, teamId: string, now: Date): Promise<void> {
  await db
    .update(teams)
    .set({ leftAt: now })
    .where(and(eq(teams.id, teamId), isNull(teams.leftAt)));
  await db.delete(squadMembers).where(eq(squadMembers.teamId, teamId));
}

export type Reconciliation = { departed: string[]; returned: string[] };

/**
 * Brings `teams.leftAt` into line with the current week's table.
 *
 * Only the CURRENT week's table may be passed here. It is the league as it stands; a
 * backfilled week's is the league as it was, and reading a departure from it would be
 * reading the past as the present.
 *
 * A table that names fewer than half the active teams is not believed: that is the
 * shape of a truncated response, and believing it would mark half the league gone and
 * wipe their squads. A real departure is one or two managers, never half.
 */
export async function reconcileDepartures(
  db: Db,
  currentTeamIds: string[],
  now: Date,
): Promise<Reconciliation> {
  const present = new Set(currentTeamIds);
  const [active, gone] = await Promise.all([
    db.select({ id: teams.id }).from(teams).where(isNull(teams.leftAt)),
    db.select({ id: teams.id }).from(teams).where(isNotNull(teams.leftAt)),
  ]);

  if (present.size * 2 < active.length) return { departed: [], returned: [] };

  const departed = active.filter((t) => !present.has(t.id)).map((t) => t.id);
  const returned = gone.filter((t) => present.has(t.id)).map((t) => t.id);

  for (const id of departed) await markDeparted(db, id, now);
  for (const id of returned) {
    await db.update(teams).set({ leftAt: null }).where(eq(teams.id, id));
  }

  return { departed, returned };
}
