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

/** Postgres's SQLSTATE for a unique-constraint violation, e.g. `teams_user_id_unique`. */
const UNIQUE_VIOLATION = "23505";

/**
 * True only for an error object carrying Postgres's unique-violation SQLSTATE,
 * checked at any depth of `.cause`. drizzle-orm 0.45.2 wraps every driver error in
 * `DrizzleQueryError`, which exposes `query`, `params` and `cause` but no `code` of
 * its own — the SQLSTATE lives on the wrapped driver error instead (Neon's
 * `NeonDbError`, or PGlite's driver error), reached by walking `cause`. Read
 * narrowly off `unknown` — never matched on message text — and anything that isn't
 * this exact code, at any depth, is left for the caller to rethrow.
 */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e != null; e = (e as { cause?: unknown }).cause) {
    if (
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
  }
  return false;
}

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
 *
 * The `where` clause is not quite the whole story, though: two genuinely concurrent
 * calls by the SAME user for two DIFFERENT free teams each run their own MVCC
 * snapshot, so both can pass the `NOT EXISTS` sub-select before either commits — the
 * `where` clause alone cannot see the other transaction. `teams_user_id_unique`
 * (added in Task 1) is what actually stops the loser, by raising a unique-violation
 * error on commit. That index is the same authority as the `where` clause — it is
 * what makes the claim exclusive in the first place — so the outcome it produces is
 * the true one; this function's only remaining job is to keep its promise to resolve
 * a `ClaimOutcome` rather than let that error escape as a rejection. This branch is
 * unreachable from any sequential caller (PGlite included): a second statement from
 * the same session always loses to `NOT EXISTS` first.
 */
export async function claimTeam(
  db: Db,
  { userId, teamId }: { userId: string; teamId: string },
): Promise<ClaimOutcome> {
  let claimed: { id: string }[];
  try {
    claimed = await db
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
  } catch (err) {
    if (isUniqueViolation(err)) return "already-claimed-another";
    throw err;
  }

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
 * same for everybody. `claimedBy` DOES cross to the browser: `ClaimList` is a client
 * component, so these ids for all rows are serialized into the RSC payload inlined in
 * the HTML. What the privacy rule forbids is rendering WHO holds a team — no name is
 * exposed, and the ids are opaque, so that holds even though they leave the server.
 * Resolving each row's "is this mine" state on the server instead, rather than
 * shipping every `claimedBy` to the client, would keep the ids out entirely.
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
