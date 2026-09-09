import { asc, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { allowedEmails } from "@/lib/db/schema";

/** Neon HTTP in production, PGlite in tests. Generic over the driver, like the claims module. */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type AllowedEmail = { email: string; addedAt: Date; addedBy: string };

/**
 * Every address on the list, oldest first.
 *
 * Read on each sign-in that is not the admin's — one indexed primary-key scan over a
 * table that holds thirteen rows and will never hold hundreds. Deliberately not cached:
 * an address added from the admin screen has to work on the next attempt, which is the
 * whole reason the list left the environment.
 */
export async function loadAllowedEmails(db: Db): Promise<string[]> {
  const rows = await db.select({ email: allowedEmails.email }).from(allowedEmails);
  return rows.map((row) => row.email);
}

/** The same list with who added each address and when, for the admin screen. */
export async function loadAllowedEmailRows(db: Db): Promise<AllowedEmail[]> {
  return db.select().from(allowedEmails).orderBy(asc(allowedEmails.addedAt));
}

/**
 * Adds addresses, ignoring any already on the list.
 *
 * `onConflictDoNothing` rather than a read-then-write: adding somebody who is already
 * allowed is not an error worth reporting, it is the same league either way, and the
 * conflict is the cheapest way to say so without a round trip. The caller has already
 * normalised and de-duplicated the input with `parseAllowlist`.
 *
 * Returns how many rows were actually inserted, so the screen can say "2 added" rather
 * than claiming it added five when three were already there.
 */
export async function addAllowedEmails(
  db: Db,
  { emails, addedBy }: { emails: string[]; addedBy: string },
): Promise<number> {
  if (emails.length === 0) return 0;
  const inserted = await db
    .insert(allowedEmails)
    .values(emails.map((email) => ({ email, addedBy })))
    .onConflictDoNothing({ target: allowedEmails.email })
    .returning({ email: allowedEmails.email });
  return inserted.length;
}

/**
 * Removes one address.
 *
 * Removing somebody stops them signing in AGAIN; it does not end a session they already
 * hold, which runs for seven days. Deleting their `user` row is what cuts that, and
 * `docs/deployment.md` carries the procedure — this function deliberately does not do it,
 * because a delete that cascades sessions and releases a claimed team is a bigger act
 * than taking a name off a list, and should not be a side effect of one.
 */
export async function removeAllowedEmail(db: Db, email: string): Promise<boolean> {
  const removed = await db
    .delete(allowedEmails)
    .where(eq(allowedEmails.email, email))
    .returning({ email: allowedEmails.email });
  return removed.length === 1;
}

/** Whether these addresses are already on the list — used to report what an add did. */
export async function existingAllowedEmails(db: Db, emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const rows = await db
    .select({ email: allowedEmails.email })
    .from(allowedEmails)
    .where(inArray(allowedEmails.email, emails));
  return rows.map((row) => row.email);
}
