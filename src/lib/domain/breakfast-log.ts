import { leagueDate } from "./clock";

/**
 * The Calendar of Shame's arithmetic: which day it is, which month is on screen, and what
 * a recorder may write down. Pure, so every rule here is tested without a database.
 *
 * Days travel as `YYYY-MM-DD` strings, the shape a Postgres `date` comes back in. A
 * breakfast happens on a day, not at an instant, and a string cannot drift across a
 * timezone the way a `Date` at midnight does. Strings of this shape also sort and compare
 * as the days they name.
 */

export type Month = { year: number; month: number };

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

/** Today in the league's own timezone, the only "today" a recorder means. */
export function todayInLeague(now: Date): string {
  const { year, month, day } = leagueDate(now);
  return isoDay(year, month, day);
}

/** A real calendar day, or null. `2026-02-30` has the right shape and names nothing. */
function parseDay(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
    ? { year, month, day }
    : null;
}

/**
 * The month `?month=` asks for, or today's.
 *
 * A malformed value falls back rather than failing, the `?round=` ruling: a hand-edited
 * URL is not an exceptional condition worth a 404.
 */
export function parseMonth(param: string | undefined, today: string): Month {
  const fallback = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const match = /^(\d{4})-(\d{2})$/.exec(param ?? "");
  if (match === null) return fallback;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : fallback;
}

export const monthParam = ({ year, month }: Month) => `${year}-${pad(month)}`;

export function shiftMonth({ year, month }: Month, by: 1 | -1): Month {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export const monthLabel = ({ year, month }: Month) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

/** "Wed 7 Oct". Formatted in UTC because the string already IS the day; no zone applies. */
export function formatBreakfastDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(year, month - 1, day)))
    .replace(",", "");
}

export type GridCell<E> = { day: number; iso: string; entries: E[] } | null;

/**
 * The month as weeks of seven, Monday first, as a Spanish calendar hangs on a wall.
 * Cells outside the month are null. Each day carries its entries in the order given, so
 * the caller decides the order once.
 */
export function monthGrid<E extends { broughtOn: string }>(m: Month, entries: E[]): GridCell<E>[][] {
  const lead = (new Date(Date.UTC(m.year, m.month - 1, 1)).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();

  const cells: GridCell<E>[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= length; day++) {
    const iso = isoDay(m.year, m.month, day);
    cells.push({ day, iso, entries: entries.filter((entry) => entry.broughtOn === iso) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: GridCell<E>[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const MAX_WHAT = 200;

export type BreakfastInput = { teamId: string; broughtOn: string; what: string };
export type BreakfastRejection = "bad-date" | "unknown-team" | "left-team" | "too-long";

/**
 * A breakfast dated after today is PLANNED: somebody has said they will bring it.
 *
 * It turns into history on its own day, with nobody confirming it — the owner's ruling,
 * because a confirmation step forgotten once leaves a breakfast stranded between the two.
 * One that never happened is edited or deleted like any other mistake. Today already
 * counts as brought.
 */
export const isPlanned = (entry: { broughtOn: string }, today: string) => entry.broughtOn > today;

/**
 * What a recorder may write down.
 *
 * Any real day, past or future: a future one is a plan (see `isPlanned`). A manager
 * who has left the league is refused for a NEW entry but accepted on an edit, because their
 * old entries must still be correctable.
 */
export function validateBreakfast(
  input: BreakfastInput,
  ctx: { today: string; teams: { id: string; leftAt: Date | null }[]; mode: "create" | "edit" },
):
  | { ok: true; value: { teamId: string; broughtOn: string; what: string | null } }
  | { ok: false; reason: BreakfastRejection } {
  if (parseDay(input.broughtOn) === null) return { ok: false, reason: "bad-date" };

  const team = ctx.teams.find((t) => t.id === input.teamId);
  if (team === undefined) return { ok: false, reason: "unknown-team" };
  if (team.leftAt !== null && ctx.mode === "create") return { ok: false, reason: "left-team" };

  const what = input.what.trim();
  if (what.length > MAX_WHAT) return { ok: false, reason: "too-long" };

  return {
    ok: true,
    value: { teamId: input.teamId, broughtOn: input.broughtOn, what: what === "" ? null : what },
  };
}
