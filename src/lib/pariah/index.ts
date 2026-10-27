import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { teams, user } from "@/lib/db/schema";

/** Neon HTTP in production, PGlite in tests. Generic over the driver, like the claims module. */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type PariahCandidate = {
  userId: string;
  name: string;
  teamName: string | null;
  isPariah: boolean;
};

/**
 * The only two roles this control moves between. A collaborator or an admin is never a
 * candidate: shunning the people who run the league would be a demotion dressed as a
 * punishment, and a demotion is a decision worth making somewhere less casual.
 */
const SHUNNABLE = ["user", "pariah"];

/**
 * A `null` role counts as an ordinary manager: every page a manager reads asks only for
 * a session, so that is how such an account already lives in the portal.
 */
const shunnable = () => or(inArray(user.role, SHUNNABLE), isNull(user.role));

/** Every manager who may be declared a pariah or pardoned, by name. */
export async function loadPariahCandidates(db: Db): Promise<PariahCandidate[]> {
  const rows = await db
    .select({ userId: user.id, name: user.name, teamName: teams.managerName, role: user.role })
    .from(user)
    .leftJoin(teams, eq(teams.userId, user.id))
    .where(shunnable())
    .orderBy(asc(user.name));
  return rows.map(({ role, ...row }) => ({ ...row, isPariah: role === "pariah" }));
}

/**
 * Declares a manager a pariah, or pardons one back to an ordinary manager.
 *
 * The role is read from the database on every request, so the change bites on the
 * pariah's next page load, with no need to end their session. The `where` is the guard
 * that matters: only a `user` or a `pariah` row is ever rewritten, so no form, forged
 * or not, can turn an admin into a pariah. Returns whether a row changed.
 */
export async function setPariah(
  db: Db,
  { userId, pariah }: { userId: string; pariah: boolean },
): Promise<boolean> {
  const updated = await db
    .update(user)
    .set({ role: pariah ? "pariah" : "user" })
    .where(and(eq(user.id, userId), shunnable()))
    .returning({ id: user.id });
  return updated.length === 1;
}
