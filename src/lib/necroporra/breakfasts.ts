import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { breakfasts, teams } from "@/lib/db/schema";
import {
  MAX_WHAT,
  formatBreakfastDay,
  isPlanned,
  todayInLeague,
  validateBreakfast,
  type BreakfastInput,
  type BreakfastRejection,
} from "@/lib/domain/breakfast-log";

/** Neon HTTP in production, PGlite in tests. Generic over the driver, like the ballot queries. */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Breakfast = { id: number; teamId: string; broughtOn: string; what: string | null };
export type BreakfastResult = { ok: boolean; message: string };

const VANISHED: BreakfastResult = { ok: false, message: "That breakfast is no longer there." };

/** The wording of every refusal, in one place, as the ballot actions keep theirs. */
const refusal = (reason: BreakfastRejection, name: string): string =>
  ({
    "bad-date": "That is not a day.",
    "unknown-team": "That manager is not in this league.",
    "left-team": `${name} has left the league.`,
    "too-long": `Keep what they brought under ${MAX_WHAT} characters.`,
  })[reason];

/** Every breakfast ever recorded, newest first, and the later entry first within a day. */
export async function loadBreakfasts(db: Db): Promise<Breakfast[]> {
  return db
    .select({
      id: breakfasts.id,
      teamId: breakfasts.teamId,
      broughtOn: breakfasts.broughtOn,
      what: breakfasts.what,
    })
    .from(breakfasts)
    .orderBy(desc(breakfasts.broughtOn), desc(breakfasts.id));
}

/**
 * Records a breakfast, or corrects one when `id` is given.
 *
 * The rules are checked here, against the league as it is now, and not trusted from the
 * form. The caller has already checked the permission. An `id` that matches nothing is
 * another recorder's delete landing first, and it is answered rather than thrown.
 */
export async function saveBreakfast(
  db: Db,
  { id, input, now, recordedBy }: { id?: number; input: BreakfastInput; now: Date; recordedBy: string },
): Promise<BreakfastResult> {
  const league = await db
    .select({ id: teams.id, name: teams.managerName, leftAt: teams.leftAt })
    .from(teams);
  const today = todayInLeague(now);
  const verdict = validateBreakfast(input, {
    today,
    teams: league,
    mode: id === undefined ? "create" : "edit",
  });
  const name = league.find((team) => team.id === input.teamId)?.name ?? input.teamId;
  if (!verdict.ok) return { ok: false, message: refusal(verdict.reason, name) };

  const row = { ...verdict.value, recordedBy, recordedAt: now };
  if (id === undefined) {
    await db.insert(breakfasts).values(row);
  } else {
    const updated = await db
      .update(breakfasts)
      .set(row)
      .where(eq(breakfasts.id, id))
      .returning({ id: breakfasts.id });
    if (updated.length === 0) return VANISHED;
  }
  const day = formatBreakfastDay(verdict.value.broughtOn);
  return {
    ok: true,
    message: isPlanned(verdict.value, today)
      ? `Planned: ${name} brings breakfast on ${day}.`
      : `Recorded: ${name} brought breakfast on ${day}.`,
  };
}

export async function removeBreakfast(db: Db, id: number): Promise<BreakfastResult> {
  const deleted = await db
    .delete(breakfasts)
    .where(eq(breakfasts.id, id))
    .returning({ id: breakfasts.id });
  return deleted.length === 0 ? VANISHED : { ok: true, message: "Deleted." };
}
