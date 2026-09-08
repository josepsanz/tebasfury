import { and, asc, eq, isNull, notExists, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { teams } from "@/lib/db/schema";

/** Neon HTTP in production, PGlite in tests. Generic over the driver, like the sweep. */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type ClaimOutcome = "claimed" | "taken" | "already-claimed-another";
export type ReleaseOutcome = "released" | "nothing-to-release";
export type ClaimRow = { teamId: string; managerName: string; claimedBy: string | null };
export type MyTeam = { teamId: string; managerName: string };

/**
 * Claims a team for a user, first come first served.
 *
 * ONE statement, because Neon's HTTP driver has no transactions and this is the only
 * concurrency primitive there is: the `where` clause is the whole rule, and whether it
 * matched a row is the whole answer. Reading first and writing second would open
 * exactly the window this closes.
 *
 * The follow-up read only chooses which of two sentences a loser is shown. It may be
 * out of date by the time it runs, and that costs nothing: the outcome was already
 * decided above, and no decision depends on this read.
 */
export async function claimTeam(
  db: Db,
  { userId, teamId }: { userId: string; teamId: string },
): Promise<ClaimOutcome> {
  const claimed = await db
    .update(teams)
    .set({ userId })
    .where(
      and(
        eq(teams.id, teamId),
        isNull(teams.userId),
        notExists(
          db.select({ one: sql`1` }).from(teams).where(eq(teams.userId, userId)),
        ),
      ),
    )
    .returning({ id: teams.id });

  if (claimed.length === 1) return "claimed";

  const held = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.userId, userId))
    .limit(1);

  return held.length === 1 ? "already-claimed-another" : "taken";
}

/**
 * Frees whatever team the caller holds.
 *
 * By user, never by team id: no request can free somebody else's claim, however it is
 * crafted, because the caller's own identity is the only thing the statement matches on.
 */
export async function releaseTeam(
  db: Db,
  { userId }: { userId: string },
): Promise<ReleaseOutcome> {
  const released = await db
    .update(teams)
    .set({ userId: null })
    .where(eq(teams.userId, userId))
    .returning({ id: teams.id });

  return released.length === 1 ? "released" : "nothing-to-release";
}

/**
 * Frees a named team, whoever holds it. The caller checks the permission; this
 * function does not, which is why it is a separate one from `releaseTeam`.
 */
export async function releaseTeamAsAdmin(
  db: Db,
  { teamId }: { teamId: string },
): Promise<ReleaseOutcome> {
  const released = await db
    .update(teams)
    .set({ userId: null })
    .where(and(eq(teams.id, teamId), sql`${teams.userId} is not null`))
    .returning({ id: teams.id });

  return released.length === 1 ? "released" : "nothing-to-release";
}

/**
 * Every team and whether it is claimed, ordered by manager name so the list reads the
 * same for everybody. `claimedBy` is an id and never reaches a rendered page: what a
 * reader sees is derived from whether it matches their own.
 */
export async function loadClaimBoard(db: Db): Promise<ClaimRow[]> {
  return db
    .select({
      teamId: teams.id,
      managerName: teams.managerName,
      claimedBy: teams.userId,
    })
    .from(teams)
    .orderBy(asc(teams.managerName));
}

/** The caller's own team, for the home page's line and the standings marker. */
export async function loadMyTeam(
  db: Db,
  { userId }: { userId: string },
): Promise<MyTeam | null> {
  const [row] = await db
    .select({ teamId: teams.id, managerName: teams.managerName })
    .from(teams)
    .where(eq(teams.userId, userId))
    .limit(1);

  return row ?? null;
}
