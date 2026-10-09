# Calendar of Shame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A page at `/necroporra/breakfasts` that keeps the history of who brought the penalty breakfast, when and what. It shows a month grid and the full list, and admins and collaborators record entries.

**Architecture:** All date logic is pure in `src/lib/domain/breakfast-log.ts`: today in Madrid, the month parameter, the grid and validation. One table, `breakfasts` (migration 0018), with its reads and its validated writes in `src/lib/necroporra/breakfasts.ts`, tested against PGlite. The server actions are thin: a permission check plus a call. The page is a server component. It uses three small server components (grid, list) and two client components (form, delete button).

**Tech Stack:** Next.js 16 (App Router; `searchParams` is a Promise), React 19, Drizzle ORM 0.45 on Neon (PGlite in tests), vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-09-tebasfury-calendar-of-shame-design.md`. Read it before any task.

## Global Constraints

- Every user-visible string is English. Copy names people and never says "this manager".
- `brought_on` is a Postgres `date` read in `mode: "string"` (`YYYY-MM-DD`). Never a `Date` object.
- "Today" is today in **Europe/Madrid**, via `leagueDate` from `src/lib/domain/clock.ts`. No other timezone code.
- `MAX_WHAT = 200` characters, after trimming. An empty "what" is stored as `null`.
- Permission `breakfast: ["record"]` lives in `collaboratorGrants`. The `user` role lacks it.
- Writes are plain awaits: no transactions, no `db.batch()`.
- Fixtures use anonymised manager names (Ada, Bruno, Chus…). This is a public repo.
- Green tests are not a typecheck: every task ends with `npx tsc --noEmit`.
- Stage explicit paths. Never `git add -A`.
- After writing a test, break the production code on purpose once and watch it fail.

## Review Focus

1. **Madrid day boundary**: at 23:30 UTC on 31 Oct, today is 1 Nov in Madrid, so recording "today" must not count as the future. Pinned in Task 1.
2. **A hand-edited `?month=`** (`2026-13`, `abc`, `2026-1`) falls back to the current month rather than throwing. Pinned in Task 1.
3. **Two entries on one day** both render in the grid cell. Pinned in Task 1 (grid) and Task 4 (page).
4. **Editing or deleting an entry another recorder already deleted** answers in words and does not throw. Pinned in Task 2.
5. **A manager who has left** cannot be chosen for a new entry, but an old entry of theirs can still be edited. Pinned in Task 1 (validation) and Task 2 (write path).

---

### Task 1: Pure date logic and validation

**Files:**
- Create: `src/lib/domain/breakfast-log.ts`
- Test: `src/lib/domain/breakfast-log.test.ts`

**Interfaces:**
- Consumes: `leagueDate(at: Date): { year; month; day }` from `src/lib/domain/clock.ts`.
- Produces:
  - `type Month = { year: number; month: number }` (month is 1-based)
  - `todayInLeague(now: Date): string` returns `YYYY-MM-DD`
  - `parseMonth(param: string | undefined, today: string): Month`
  - `monthParam(m: Month): string` returns `YYYY-MM`
  - `shiftMonth(m: Month, by: 1 | -1): Month`
  - `monthLabel(m: Month): string`, for example `"October 2026"`
  - `type GridCell<E> = { day: number; iso: string; entries: E[] } | null`
  - `monthGrid<E extends { broughtOn: string }>(m: Month, entries: E[]): GridCell<E>[][]`, weeks Monday first
  - `formatBreakfastDay(iso: string): string`, for example `"Wed 7 Oct"`
  - `MAX_WHAT = 200`
  - `type BreakfastInput = { teamId: string; broughtOn: string; what: string }`
  - `type BreakfastRejection = "bad-date" | "future" | "unknown-team" | "left-team" | "too-long"`
  - `validateBreakfast(input, ctx: { today: string; teams: { id: string; leftAt: Date | null }[]; mode: "create" | "edit" })`, which returns `{ ok: true; value: { teamId: string; broughtOn: string; what: string | null } } | { ok: false; reason: BreakfastRejection }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  formatBreakfastDay,
  monthGrid,
  monthLabel,
  monthParam,
  parseMonth,
  shiftMonth,
  todayInLeague,
  validateBreakfast,
} from "./breakfast-log";

describe("todayInLeague", () => {
  it("is already tomorrow in Madrid at 23:30 UTC", () => {
    expect(todayInLeague(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
  });
  it("is the same day in the middle of it", () => {
    expect(todayInLeague(new Date("2026-10-09T10:00:00Z"))).toBe("2026-10-09");
  });
});

describe("parseMonth", () => {
  const today = "2026-10-09";
  it("reads a well-formed month", () => {
    expect(parseMonth("2026-08", today)).toEqual({ year: 2026, month: 8 });
  });
  it.each([undefined, "", "abc", "2026-13", "2026-00", "2026-1", "2026-10-01"])(
    "falls back to the current month for %s",
    (param) => {
      expect(parseMonth(param, today)).toEqual({ year: 2026, month: 10 });
    },
  );
});

describe("month arithmetic and wording", () => {
  it("steps across a year in both directions", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2027, month: 1 }, -1)).toEqual({ year: 2026, month: 12 });
  });
  it("writes the parameter zero-padded", () => {
    expect(monthParam({ year: 2026, month: 8 })).toBe("2026-08");
  });
  it("names the month", () => {
    expect(monthLabel({ year: 2026, month: 10 })).toBe("October 2026");
  });
  it("names a day the way the list reads it", () => {
    expect(formatBreakfastDay("2026-10-07")).toBe("Wed 7 Oct");
  });
});

describe("monthGrid", () => {
  const days = (grid: ReturnType<typeof monthGrid>) =>
    grid.map((week) => week.map((cell) => (cell === null ? 0 : cell.day)));

  it("starts on a Monday and pads the first week", () => {
    // 1 October 2026 is a Thursday.
    const grid = monthGrid({ year: 2026, month: 10 }, []);
    expect(days(grid)[0]).toEqual([0, 0, 0, 1, 2, 3, 4]);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(days(grid).flat().filter((d) => d > 0)).toHaveLength(31);
  });

  it("needs no padding when the month starts on a Monday", () => {
    // 1 June 2026 is a Monday.
    expect(days(monthGrid({ year: 2026, month: 6 }, []))[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("puts a Sunday first day in the last column", () => {
    // 1 November 2026 is a Sunday.
    expect(days(monthGrid({ year: 2026, month: 11 }, []))[0]).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it("knows February in a leap year", () => {
    const grid = monthGrid({ year: 2028, month: 2 }, []);
    expect(Math.max(...days(grid).flat())).toBe(29);
  });

  it("puts every entry of a day in that day's cell, in the order given", () => {
    const a = { id: 1, broughtOn: "2026-10-07" };
    const b = { id: 2, broughtOn: "2026-10-07" };
    const other = { id: 3, broughtOn: "2026-09-07" };
    const cells = monthGrid({ year: 2026, month: 10 }, [a, b, other]).flat();
    expect(cells.find((c) => c?.day === 7)?.entries).toEqual([a, b]);
    expect(cells.flatMap((c) => c?.entries ?? [])).toHaveLength(2);
    expect(cells.find((c) => c?.day === 7)?.iso).toBe("2026-10-07");
  });
});

describe("validateBreakfast", () => {
  const teams = [
    { id: "t1", leftAt: null },
    { id: "t9", leftAt: new Date("2026-09-01T00:00:00Z") },
  ];
  const ctx = { today: "2026-10-09", teams, mode: "create" as const };
  const ok = { teamId: "t1", broughtOn: "2026-10-09", what: "  Churros  " };

  it("accepts today and trims what", () => {
    expect(validateBreakfast(ok, ctx)).toEqual({
      ok: true,
      value: { teamId: "t1", broughtOn: "2026-10-09", what: "Churros" },
    });
  });
  it("stores an empty what as null", () => {
    const result = validateBreakfast({ ...ok, what: "   " }, ctx);
    expect(result.ok && result.value.what).toBeNull();
  });
  it.each(["", "2026-02-30", "09/10/2026", "2026-10-9"])("refuses the date %s", (broughtOn) => {
    expect(validateBreakfast({ ...ok, broughtOn }, ctx)).toEqual({ ok: false, reason: "bad-date" });
  });
  it("refuses tomorrow", () => {
    expect(validateBreakfast({ ...ok, broughtOn: "2026-10-10" }, ctx)).toEqual({
      ok: false,
      reason: "future",
    });
  });
  it("refuses a team that is not in the league", () => {
    expect(validateBreakfast({ ...ok, teamId: "nope" }, ctx)).toEqual({
      ok: false,
      reason: "unknown-team",
    });
  });
  it("refuses a departed manager for a new entry but not for an edit", () => {
    expect(validateBreakfast({ ...ok, teamId: "t9" }, ctx)).toEqual({ ok: false, reason: "left-team" });
    expect(validateBreakfast({ ...ok, teamId: "t9" }, { ...ctx, mode: "edit" }).ok).toBe(true);
  });
  it("refuses a what longer than 200 characters, and takes exactly 200", () => {
    expect(validateBreakfast({ ...ok, what: "x".repeat(201) }, ctx)).toEqual({
      ok: false,
      reason: "too-long",
    });
    expect(validateBreakfast({ ...ok, what: "x".repeat(200) }, ctx).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/domain/breakfast-log.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement**

```ts
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
export type BreakfastRejection = "bad-date" | "future" | "unknown-team" | "left-team" | "too-long";

/**
 * What a recorder may write down.
 *
 * A breakfast not yet brought is not history, so a day after today is refused. A manager
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
  if (input.broughtOn > ctx.today) return { ok: false, reason: "future" };

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
```

- [ ] **Step 4: Run the tests and watch them pass**, then break `lead` (drop the `+ 6`) and the `> ctx.today` comparison in turn, and confirm the tests fail each time. Restore both.

Run: `npx vitest run src/lib/domain/breakfast-log.test.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/breakfast-log.ts src/lib/domain/breakfast-log.test.ts
git commit -m "feat: the Calendar of Shame's arithmetic, days and months in Madrid"
```

---

### Task 2: The `breakfasts` table and its reads and writes

**Files:**
- Modify: `src/lib/db/schema.ts` (append after `necroporraVotes`)
- Create: `drizzle/0018_*.sql` (generated), plus `drizzle/meta` updates
- Create: `src/lib/necroporra/breakfasts.ts`
- Test: `src/lib/necroporra/breakfasts.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces:
  - `breakfasts` table export in `schema.ts`
  - `type Breakfast = { id: number; teamId: string; broughtOn: string; what: string | null }`
  - `type BreakfastResult = { ok: boolean; message: string }`
  - `loadBreakfasts(db): Promise<Breakfast[]>`: newest first, ties broken by `id` descending
  - `saveBreakfast(db, { id?: number; input: BreakfastInput; now: Date; recordedBy: string }): Promise<BreakfastResult>`: inserts when `id` is undefined and updates otherwise
  - `removeBreakfast(db, id: number): Promise<BreakfastResult>`

- [ ] **Step 1: Add the table to the schema**

```ts
/**
 * One breakfast somebody actually brought: the Calendar of Shame.
 *
 * A record of what happened, not of what the rule asked for. `breakfastDuties` says who
 * OWES breakfast after a round; this says who brought one, and when, and the owner ruled
 * the two stay unlinked. An entry can therefore exist with no round behind it, and a duty
 * can go unrecorded.
 *
 * Keyed on the team, as `necroporra_votes` is, because the managers with no portal account
 * bring breakfast too. `brought_on` is a `date`: a breakfast happens on a day, and an
 * instant would land on a different day depending on who read it.
 */
export const breakfasts = pgTable(
  "breakfasts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    broughtOn: date("brought_on", { mode: "string" }).notNull(),
    what: text("what"),
    /** Who wrote it down last, which the league may well ask. */
    recordedBy: text("recorded_by").references(() => user.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("breakfasts_brought_on_idx").on(table.broughtOn)],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm drizzle-kit generate --name breakfasts`. `drizzle.config.ts` needs `DATABASE_URL`; generate never connects, so prefix it with `DATABASE_URL=postgres://x@localhost/x` if `.env.local` is absent.
Expected: `drizzle/0018_breakfasts.sql` containing only `CREATE TABLE "breakfasts"`, its two foreign keys and the index. Read it. If it touches any other table, stop.

- [ ] **Step 3: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { breakfasts, teams, user } from "@/lib/db/schema";
import { loadBreakfasts, removeBreakfast, saveBreakfast } from "./breakfasts";

let h: TestDatabase;
const NOW = new Date("2026-10-09T10:00:00Z");

beforeEach(async () => {
  h = await createTestDatabase();
  await h.db.insert(user).values({ id: "u1", name: "Ada A", email: "ada@example.com" });
  await h.db.insert(teams).values([
    { id: "t1", managerId: 1, managerName: "Ada", userId: "u1" },
    { id: "t2", managerId: 2, managerName: "Bruno" },
    { id: "t9", managerId: 9, managerName: "Gone", leftAt: new Date("2026-09-01T00:00:00Z") },
  ]);
});
afterEach(async () => {
  await h.close();
});

const save = (input: { teamId: string; broughtOn: string; what?: string }, id?: number) =>
  saveBreakfast(h.db, {
    id,
    input: { what: "", ...input },
    now: NOW,
    recordedBy: "u1",
  });

describe("saveBreakfast", () => {
  it("records a breakfast and names who brought it", async () => {
    const result = await save({ teamId: "t2", broughtOn: "2026-10-07", what: "Churros" });
    expect(result).toEqual({ ok: true, message: "Recorded: Bruno brought breakfast on Wed 7 Oct." });
    expect(await loadBreakfasts(h.db)).toEqual([
      { id: expect.any(Number), teamId: "t2", broughtOn: "2026-10-07", what: "Churros" },
    ]);
  });

  it("refuses in words, and writes nothing", async () => {
    expect(await save({ teamId: "t2", broughtOn: "2026-10-10" })).toEqual({
      ok: false,
      message: "That day has not happened yet.",
    });
    expect(await save({ teamId: "t9", broughtOn: "2026-10-01" })).toEqual({
      ok: false,
      message: "Gone has left the league.",
    });
    expect(await loadBreakfasts(h.db)).toEqual([]);
  });

  it("edits an entry in place, even one for a manager who has since left", async () => {
    await h.db.insert(breakfasts).values({ teamId: "t9", broughtOn: "2026-08-20", what: "Coca" });
    const [{ id }] = await loadBreakfasts(h.db);
    const result = await save({ teamId: "t9", broughtOn: "2026-08-21", what: "Coca de llardons" }, id);
    expect(result.ok).toBe(true);
    expect(await loadBreakfasts(h.db)).toEqual([
      { id, teamId: "t9", broughtOn: "2026-08-21", what: "Coca de llardons" },
    ]);
  });

  it("answers an edit of a vanished entry instead of throwing", async () => {
    expect(await save({ teamId: "t2", broughtOn: "2026-10-07" }, 999)).toEqual({
      ok: false,
      message: "That breakfast is no longer there.",
    });
  });
});

describe("removeBreakfast", () => {
  it("deletes once, and answers the second time", async () => {
    await save({ teamId: "t2", broughtOn: "2026-10-07" });
    const [{ id }] = await loadBreakfasts(h.db);
    expect(await removeBreakfast(h.db, id)).toEqual({ ok: true, message: "Deleted." });
    expect(await removeBreakfast(h.db, id)).toEqual({
      ok: false,
      message: "That breakfast is no longer there.",
    });
  });
});

describe("loadBreakfasts", () => {
  it("lists newest first, and the later entry first on the same day", async () => {
    await save({ teamId: "t1", broughtOn: "2026-09-01" });
    await save({ teamId: "t1", broughtOn: "2026-10-07" });
    await save({ teamId: "t2", broughtOn: "2026-10-07" });
    const rows = await loadBreakfasts(h.db);
    expect(rows.map((r) => [r.broughtOn, r.teamId])).toEqual([
      ["2026-10-07", "t2"],
      ["2026-10-07", "t1"],
      ["2026-09-01", "t1"],
    ]);
  });
});
```

- [ ] **Step 4: Run them and watch them fail**

Run: `npx vitest run src/lib/necroporra/breakfasts.test.ts`
Expected: FAIL, because `./breakfasts` does not exist.

- [ ] **Step 5: Implement**

```ts
import { desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { breakfasts, teams } from "@/lib/db/schema";
import {
  MAX_WHAT,
  formatBreakfastDay,
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
    future: "That day has not happened yet.",
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
  const verdict = validateBreakfast(input, {
    today: todayInLeague(now),
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
  return {
    ok: true,
    message: `Recorded: ${name} brought breakfast on ${formatBreakfastDay(verdict.value.broughtOn)}.`,
  };
}

export async function removeBreakfast(db: Db, id: number): Promise<BreakfastResult> {
  const deleted = await db
    .delete(breakfasts)
    .where(eq(breakfasts.id, id))
    .returning({ id: breakfasts.id });
  return deleted.length === 0 ? VANISHED : { ok: true, message: "Deleted." };
}
```

- [ ] **Step 6: Run the tests and watch them pass.** Then flip `mode` to always `"create"` and confirm the departed-manager edit test fails. Restore it.

Run: `npx vitest run src/lib/necroporra/breakfasts.test.ts src/lib/db && npx tsc --noEmit`

- [ ] **Step 7: Add a deployment note.** In `docs/deployment.md`, list migration 0018 the way 0017 is listed: apply it before pushing. Without it, only `/necroporra/breakfasts` fails.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0018_breakfasts.sql drizzle/meta src/lib/necroporra/breakfasts.ts src/lib/necroporra/breakfasts.test.ts docs/deployment.md
git commit -m "feat: a table for the breakfasts actually brought"
```

---

### Task 3: The permission and the server actions

**Files:**
- Modify: `src/lib/auth/permissions.ts`
- Modify: `src/lib/auth/permissions.test.ts`
- Create: `src/app/(portal)/necroporra/breakfasts/actions.ts`

**Interfaces:**
- Consumes: `saveBreakfast`, `removeBreakfast` and `BreakfastResult` from Task 2.
- Produces: `recordBreakfast(fd)`, `updateBreakfast(fd)` and `deleteBreakfast(fd)`, each `(formData: FormData) => Promise<BreakfastResult>`. Form fields: `id`, `teamId`, `broughtOn`, `what`.

- [ ] **Step 1: Write the failing permission tests.** Under `describe("user")`:

```ts
    it("cannot record a breakfast", () => {
      expect(roles.user.authorize({ breakfast: ["record"] }).success).toBe(false);
    });
```

Under `describe("admin")`:

```ts
    it("can record a breakfast", () => {
      expect(roles.admin.authorize({ breakfast: ["record"] }).success).toBe(true);
    });
```

The collaborator case is covered by the existing `it.each(grantCases)` once the grant exists.

- [ ] **Step 2: Run them.** `npx vitest run src/lib/auth/permissions.test.ts`. The tests should fail, or fail to typecheck, because `breakfast` is unknown.

- [ ] **Step 3: Add the grant.** In `statement`, after `leagueData`:

```ts
  /**
   * Writing down who brought breakfast: create, correct or delete one entry of the
   * Calendar of Shame. One action for all three, because nobody wants them apart.
   */
  breakfast: ["record"],
```

In `collaboratorGrants`, after `leagueData`: `breakfast: ["record"],`. The admin role inherits it by its spread.

- [ ] **Step 4: Write the actions**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { removeBreakfast, saveBreakfast, type BreakfastResult } from "@/lib/necroporra/breakfasts";

const PATH = "/necroporra/breakfasts";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const inputOf = (formData: FormData) => ({
  teamId: field(formData, "teamId"),
  broughtOn: field(formData, "broughtOn"),
  what: field(formData, "what"),
});

const idOf = (formData: FormData) => {
  const id = Number(field(formData, "id"));
  return Number.isInteger(id) && id > 0 ? id : null;
};

const NO_ID: BreakfastResult = { ok: false, message: "No breakfast was named." };

/**
 * The three ways to write in the Calendar of Shame. Each one checks the permission itself:
 * hiding the form from a manager is a courtesy, not a control.
 */
export async function recordBreakfast(formData: FormData): Promise<BreakfastResult> {
  const session = await requirePermission({ breakfast: ["record"] });
  const result = await saveBreakfast(db, {
    input: inputOf(formData),
    now: new Date(),
    recordedBy: session.user.id,
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function updateBreakfast(formData: FormData): Promise<BreakfastResult> {
  const session = await requirePermission({ breakfast: ["record"] });
  const id = idOf(formData);
  if (id === null) return NO_ID;
  const result = await saveBreakfast(db, {
    id,
    input: inputOf(formData),
    now: new Date(),
    recordedBy: session.user.id,
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function deleteBreakfast(formData: FormData): Promise<BreakfastResult> {
  await requirePermission({ breakfast: ["record"] });
  const id = idOf(formData);
  if (id === null) return NO_ID;
  const result = await removeBreakfast(db, id);
  if (result.ok) revalidatePath(PATH);
  return result;
}
```

- [ ] **Step 5: Run the checks.** `npx vitest run src/lib/auth && npx tsc --noEmit`. Expect a pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/permissions.ts src/lib/auth/permissions.test.ts "src/app/(portal)/necroporra/breakfasts/actions.ts"
git commit -m "feat: admins and collaborators may write in the Calendar of Shame"
```

---

### Task 4: The page

**Before writing any UI:** invoke `frontend-design:frontend-design`. Read `node_modules/next/dist/docs/01-app` on pages and `searchParams`. Copy the visual vocabulary of `/necroporra/page.tsx`: `HEADING`, the `--board-*` tokens, `board-button` and the `details` disclosure in `necroporra-ballots.tsx`.

**Files:**
- Create: `src/components/breakfast-calendar.tsx` (server)
- Create: `src/components/breakfast-list.tsx` (server)
- Create: `src/components/breakfast-form.tsx` (client)
- Create: `src/components/breakfast-delete.tsx` (client)
- Create: `src/app/(portal)/necroporra/breakfasts/page.tsx`
- Modify: `src/app/(portal)/necroporra/page.tsx` (link under the header)
- Modify: `src/lib/db/seed-league.ts` (two breakfasts on one day, one earlier)
- Test: `src/app/portal-pages.test.tsx` (new `describe("/necroporra/breakfasts")`)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `BreakfastCalendar({ month: Month; grid: GridCell<Breakfast>[][]; today: string; teamName: Map<string,string>; prevHref: string; nextHref: string })`
  - `BreakfastList({ rows: Breakfast[]; teamName: Map<string,string>; editFor: ((row: Breakfast) => ReactNode) | null })`
  - `BreakfastForm({ teams: { id: string; managerName: string }[]; action; today: string; initial?: Breakfast; submitLabel: string })`. On a successful create it resets "what" and keeps the date and the manager.
  - `BreakfastDelete({ id: number; label: string; action })`. It calls `window.confirm(label)` before posting.

- [ ] **Step 1: Seed and failing page tests.** In `seedLeague`, after the votes:

```ts
  // Two breakfasts on one day and one the month before, so the grid draws a shared cell
  // and the list has an order to keep. Dated in August 2026, the seeded season.
  await db.insert(breakfasts).values([
    { teamId: "t3", broughtOn: "2026-08-20", what: "Churros", recordedBy: SEED_USER.id },
    { teamId: "t2", broughtOn: "2026-08-20", what: null, recordedBy: SEED_USER.id },
    { teamId: "t3", broughtOn: "2026-07-30", what: "Ensaïmada", recordedBy: SEED_USER.id },
  ]);
```

In `portal-pages.test.tsx` (`asCollaborator = { user: { id: SEED_USER.id, role: "collaborator" } }`):

```ts
describe("/necroporra/breakfasts", () => {
  const month = (m: string) => ({ searchParams: Promise.resolve({ month: m }) });

  it("marks both bringers on a shared day, and lists every breakfast newest first", async () => {
    const { default: Page } = await import("./(portal)/necroporra/breakfasts/page");
    const html = await render(() => Page(month("2026-08")));
    expect(html).toContain("August 2026");
    const grid = html.slice(html.indexOf("August 2026"), html.indexOf("Every breakfast"));
    expect(grid).toContain("Chus");
    expect(grid).toContain("Bruno");
    const list = html.slice(html.indexOf("Every breakfast"));
    expect(list.indexOf("Thu 20 Aug")).toBeLessThan(list.indexOf("Thu 30 Jul"));
    expect(list).toContain("Ensaïmada");
  });

  it("falls back to the current month on a malformed one", async () => {
    const { default: Page } = await import("./(portal)/necroporra/breakfasts/page");
    const html = await render(() => Page(month("2026-13")));
    expect(html).not.toContain("2026-13");
  });

  it("shows a manager no way to write", async () => {
    harness.session = asManager;
    const { default: Page } = await import("./(portal)/necroporra/breakfasts/page");
    const html = await render(() => Page(month("2026-08")));
    expect(html).not.toContain("Record");
    expect(html).not.toContain("Delete");
  });

  it("gives a collaborator the form and the row controls", async () => {
    harness.session = asCollaborator;
    try {
      const { default: Page } = await import("./(portal)/necroporra/breakfasts/page");
      const html = await render(() => Page(month("2026-08")));
      expect(html).toContain("Record");
      expect(html).toContain("Delete");
    } finally {
      harness.session = asManager;
    }
  });
});
```

Also add to the `/necroporra` describe: `expect(html).toContain('href="/necroporra/breakfasts"')`.

Run: `npx vitest run src/app/portal-pages.test.tsx`. Expect a FAIL, because the page module does not exist. Existing assertions that count Necroporra rows must still pass; the seed adds no votes.

- [ ] **Step 2: The page**

```tsx
import Link from "next/link";
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { loadBreakfasts } from "@/lib/necroporra/breakfasts";
import { decideAccess, requireSession } from "@/lib/auth/guards";
import {
  monthGrid,
  monthParam,
  parseMonth,
  shiftMonth,
  todayInLeague,
} from "@/lib/domain/breakfast-log";
import { urlWithParam } from "@/components/picker-url";
import { PageHeader } from "@/components/page-header";
import { BreakfastCalendar } from "@/components/breakfast-calendar";
import { BreakfastList } from "@/components/breakfast-list";
import { BreakfastForm } from "@/components/breakfast-form";
import { BreakfastDelete } from "@/components/breakfast-delete";
import { deleteBreakfast, recordBreakfast, updateBreakfast } from "./actions";

const BASE = "/necroporra/breakfasts";

export default async function BreakfastsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireSession();
  const today = todayInLeague(new Date());
  const [rows, { teams, activeTeams }] = await Promise.all([loadBreakfasts(db), loadSnapshots(db)]);

  const params = await searchParams;
  const asked = Array.isArray(params.month) ? params.month[0] : params.month;
  const month = parseMonth(asked, today);

  // Every other parameter survives a step, as on every picker in the portal.
  const query = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
  );
  const hrefFor = (by: 1 | -1) => urlWithParam(BASE, query, "month", monthParam(shiftMonth(month, by)));

  const teamName = new Map(teams.map((t) => [t.id, t.managerName]));
  const mayRecord = decideAccess(session, { breakfast: ["record"] }).kind === "allow";
  // New entries name the league as it is; an old entry keeps whoever it names.
  const choosable = activeTeams.map((t) => ({ id: t.id, managerName: t.managerName }));

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Calendar of Shame"
        note="Every penalty breakfast the league has actually eaten: who brought it, when, and what."
        meta={rows.length === 1 ? "1 breakfast" : `${rows.length} breakfasts`}
      />
      <p className="mt-2 text-[12px]">
        <Link href="/necroporra" className="underline underline-offset-4">‹ Necroporra</Link>
      </p>

      {mayRecord ? (
        <BreakfastForm teams={choosable} action={recordBreakfast} today={today} submitLabel="Record" />
      ) : null}

      <BreakfastCalendar
        month={month}
        grid={monthGrid(month, rows)}
        today={today}
        teamName={teamName}
        prevHref={hrefFor(-1)}
        nextHref={hrefFor(1)}
      />

      <BreakfastList
        rows={rows}
        teamName={teamName}
        editFor={
          mayRecord
            ? (row) => {
                const name = teamName.get(row.teamId) ?? row.teamId;
                // The current team stays choosable on an edit even if they have left.
                const options = choosable.some((t) => t.id === row.teamId)
                  ? choosable
                  : [...choosable, { id: row.teamId, managerName: name }];
                return (
                  <>
                    <BreakfastForm
                      teams={options}
                      action={updateBreakfast}
                      today={today}
                      initial={row}
                      submitLabel={`Save ${name}'s breakfast`}
                    />
                    <BreakfastDelete
                      id={row.id}
                      label={`Delete ${name}'s breakfast? This cannot be undone.`}
                      action={deleteBreakfast}
                    />
                  </>
                );
              }
            : null
        }
      />
    </section>
  );
}
```

Check that `loadSnapshots` returns `activeTeams` with `managerName`. It does on `/necroporra`, which filters `activeTeams` by id and passes them as `BallotTeam`.

- [ ] **Step 3: The components.** Follow the design direction from `frontend-design`, inside these constraints:
  - **Calendar:** a header row with `‹ {prev label}`, `monthLabel(month)` and `{next label} ›` as `Link`s. Seven `Mon…Sun` column labels. A CSS grid `grid-cols-7`. A cell with entries uses the `--board-alert` 16% tint and border, the day number and each name (`truncate`, `text-[10px]`). Today's cell gets an outline in `--board-ink-dim`. Null cells are empty. It must not scroll horizontally at 360 px: cells use `min-w-0`.
  - **List:** an `HEADING` "Every breakfast". When empty: "Nobody has brought breakfast yet." Each row is a grid `[76px_1fr_auto]` holding the date (`formatBreakfastDay`, mono, dim), the name and the "what" (dim, `truncate`). When `editFor` is non-null, wrap each row in the `<details>` and `<summary>` pattern from `necroporra-ballots.tsx`, with `aria-label={\`Edit ${name}'s breakfast\`}` and `{editFor(row)}` inside.
  - **Form:** a client component modelled on `NecroporraBallot`, with `useState` for the result and `useTransition` for pending. Fields: `<input type="date" name="broughtOn" max={today} defaultValue={initial?.broughtOn ?? today}>`, `<select name="teamId">` (placeholder "Who brought it?", required, defaultValue `initial?.teamId ?? ""`), and `<input name="what" maxLength={MAX_WHAT} placeholder="What (optional)" defaultValue={initial?.what ?? ""}>`. A hidden `id` when `initial` is given. Submit with `className="board-button board-button-primary"` and the label "Saving…" while pending. The result sentence is shown in gain or alert colour. Build the `FormData` from `event.currentTarget`. After an ok create, clear the `what` input only.
  - **Delete:** a client component with a `board-button` labelled "Delete". `onClick`: `if (!window.confirm(label)) return;` and then the action in a transition. It shows the result sentence.

- [ ] **Step 4: The link from the Necroporra.** In `src/app/(portal)/necroporra/page.tsx`, directly under `<PageHeader … />`:

```tsx
      <p className="mt-2 text-[12px]">
        <Link href="/necroporra/breakfasts" className="underline underline-offset-4">
          Calendar of Shame
        </Link>
        <span style={{ color: "var(--board-ink-dim)" }}> — who brought breakfast, and when.</span>
      </p>
```

- [ ] **Step 5: Run everything.** `npx vitest run src/app/portal-pages.test.tsx && npx tsc --noEmit`. Expect a pass. Then make `mayRecord` always `true`, confirm the manager test fails, and restore it.

- [ ] **Step 6: Commit**

```bash
git add src/components/breakfast-calendar.tsx src/components/breakfast-list.tsx src/components/breakfast-form.tsx src/components/breakfast-delete.tsx "src/app/(portal)/necroporra/breakfasts/page.tsx" "src/app/(portal)/necroporra/page.tsx" src/lib/db/seed-league.ts src/app/portal-pages.test.tsx
git commit -m "feat: the Calendar of Shame, a month of breakfasts and every one ever brought"
```

---

### Task 5: Whole-branch verification

- [ ] `pnpm test`: all pass, and the count rises from 1147.
- [ ] `npx tsc --noEmit`, `pnpm lint` and `pnpm build` are clean.
- [ ] Run `pnpm dev` and open `http://localhost:3000/necroporra/breakfasts` (localhost, never the LAN IP) at 360 px and at desktop width, signed in as an admin. Record, edit and delete one entry against the local database.
- [ ] README: add the Calendar of Shame wherever the Necroporra's features are listed.
- [ ] Commit the README, and report the unpushed commits and the 0018 migration step to the owner.
