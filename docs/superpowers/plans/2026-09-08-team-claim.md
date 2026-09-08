# Claiming a Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each of the 13 managers can say which team is theirs, so the portal knows who is who — the thing the Necroporra turned out to need first.

**Architecture:** The claim is a value in `teams.user_id`, the column the skeleton left dead, made exclusive by one unique index. Claiming is a single conditional `UPDATE` whose affected-row count is the answer, because Neon's HTTP driver has no transactions. Nobody sees who claimed what: a taken row says `Claimed` and names no one.

**Tech Stack:** Next.js 16.3.4 (App Router), React 19, Drizzle ORM on Neon HTTP in production and PGlite in tests, better-auth for sessions and roles, Vitest, Playwright, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-08-tebasfury-team-claim-design.md` — read it first; every ruling referenced below is argued there.

## Global Constraints

- **No transactions, no `db.batch()`.** Neon's HTTP driver has no transactions and PGlite has no `batch`. The claim is ONE statement; reading first and then writing reintroduces the race the statement exists to avoid (Ruling 3).
- **Row counts come from `.returning()`**, never from a driver's `rowCount`: `returning` behaves the same on Neon HTTP and PGlite, and the tests run on the latter.
- **All UI copy is in English**, like every string in this portal.
- **No name of a claimer is ever rendered**, to anybody, including admins (Ruling 4).
- **No nav entry.** The home page is the only door to `/claim` (Ruling 6).
- **`releaseTeam` never takes a team id** (Ruling 5). The admin variant is a separate function.
- **Vitest does not typecheck.** Run `npx tsc --noEmit` before every commit.
- **Load the `frontend-design` skill before the first line of UI** (Tasks 3, 5 and 6).

---

### Task 1: The unique index and migration 0009

One user holds at most one team, enforced by the database rather than by the code that writes to it.

**Files:**
- Modify: `src/lib/db/schema.ts:20-26` (the `teams` table)
- Create: `drizzle/0009_<name>.sql` (drizzle-kit picks the name)
- Modify: `drizzle/meta/_journal.json` (drizzle-kit writes it)
- Modify: `docs/deployment.md:101-105` (the migration paragraph in step 4)
- Test: `src/lib/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the constraint every later task relies on. No new TypeScript symbols.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/db/schema.test.ts`. Add `user` to the existing import from `./schema` — the file already imports `teams` and `eq`.

```tsx
describe("the claim on a team", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(user).values([
      { id: "u1", name: "Alice", email: "alice@example.com" },
      { id: "u2", name: "Bruno", email: "bruno@example.com" },
    ]);
    await h.db.insert(teams).values([
      { id: "c1", managerId: 101, managerName: "Manager C1" },
      { id: "c2", managerId: 102, managerName: "Manager C2" },
      { id: "c3", managerId: 103, managerName: "Manager C3" },
    ]);
  });
  afterAll(async () => {
    await h.close();
  });

  it("lets a user hold one team", async () => {
    await h.db.update(teams).set({ userId: "u1" }).where(eq(teams.id, "c1"));
    const [row] = await h.db.select().from(teams).where(eq(teams.id, "c1"));
    expect(row.userId).toBe("u1");
  });

  it("refuses a second team for the same user", async () => {
    await expect(
      h.db.update(teams).set({ userId: "u1" }).where(eq(teams.id, "c2")),
    ).rejects.toThrow();
  });

  it("leaves unclaimed teams alone, however many there are", async () => {
    // Two NULLs are distinct to a unique index, which is the whole reason this
    // index can be a plain one. Twelve unclaimed teams must not collide.
    const unclaimed = await h.db.select().from(teams).where(isNull(teams.userId));
    expect(unclaimed.map((t) => t.id).sort()).toEqual(["c2", "c3"]);
  });

  it("frees the team when the account goes away, rather than deleting it", async () => {
    await h.db.update(teams).set({ userId: "u2" }).where(eq(teams.id, "c3"));
    await h.db.delete(user).where(eq(user.id, "u2"));
    const [row] = await h.db.select().from(teams).where(eq(teams.id, "c3"));
    expect(row).toBeDefined();
    expect(row.userId).toBeNull();
  });
});
```

Add `isNull` to the `drizzle-orm` import at the top of the file.

- [ ] **Step 2: Run the test and watch the right one fail**

Run: `npx vitest run src/lib/db/schema.test.ts`
Expected: "refuses a second team for the same user" FAILS — the update succeeds because no index forbids it. The other three pass already. If a different test fails, stop and read why before touching the schema.

- [ ] **Step 3: Add the index to the schema**

In `src/lib/db/schema.ts`, give `teams` a second argument. `uniqueIndex` is already imported.

```ts
export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    managerId: integer("manager_id").notNull(),
    managerName: text("manager_name").notNull(),
    /**
     * The portal account that claims this team, or null while nobody has.
     *
     * Unique, so one person cannot hold two teams — and plainly unique, not
     * partially: Postgres treats NULLs as distinct in a unique index, so the
     * twelve unclaimed rows do not collide with each other.
     */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("teams_user_id_unique").on(table.userId)],
);
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm drizzle-kit generate`
Expected: a new `drizzle/0009_<something>.sql` containing
`CREATE UNIQUE INDEX "teams_user_id_unique" ON "teams" USING btree ("user_id");`
and an updated `drizzle/meta/_journal.json`. Read the SQL file before continuing: if it contains anything besides that index, the schema edit went wider than intended — revert and redo it.

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run src/lib/db/schema.test.ts`
Expected: all four pass. `createTestDatabase` migrates from `./drizzle`, so the new file is what makes the second test pass.

- [ ] **Step 6: Run the whole suite and the typecheck**

Run: `pnpm test && npx tsc --noEmit`
Expected: everything green. Any other test that touched `teams.userId` would surface here; none does today.

- [ ] **Step 7: Record the migration in the deployment doc**

In `docs/deployment.md`, step 4, replace the paragraph that ends "...the table has been capturing the league's operations ever since." with:

```markdown
`0003` through `0008` **were** applied when their slices shipped. `0003` through `0006`
landed with the players slice; `0007` (the `real_teams` table) came with the club
affiliation slice; `0008` (the `market_operations` table) went out with the fair-play
slice. All of them have since been verified in production — `0008` on 2026-09-08, and
the table has been capturing the league's operations ever since.

`0009` (a unique index on `teams.user_id`) is outstanding and must be applied before the
team-claim slice deploys. It is safe against the populated database: the column is
entirely NULL today, so the index cannot find a duplicate to trip on.
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/schema.test.ts drizzle docs/deployment.md
git commit -m "feat: make a team's claim exclusive at the database"
```

---

### Task 2: The claims module

Every write and read the feature needs, in one place, with the guarantees proven against a real Postgres.

**Files:**
- Create: `src/lib/claims/index.ts`
- Test: `src/lib/claims/index.test.ts`

**Interfaces:**
- Consumes: the unique index from Task 1.
- Produces, for Tasks 3–6:

```ts
export type ClaimOutcome = "claimed" | "taken" | "already-claimed-another";
export type ReleaseOutcome = "released" | "nothing-to-release";
export type ClaimRow = { teamId: string; managerName: string; claimedBy: string | null };
export type MyTeam = { teamId: string; managerName: string };

claimTeam(db: Db, args: { userId: string; teamId: string }): Promise<ClaimOutcome>
releaseTeam(db: Db, args: { userId: string }): Promise<ReleaseOutcome>
releaseTeamAsAdmin(db: Db, args: { teamId: string }): Promise<ReleaseOutcome>
loadClaimBoard(db: Db): Promise<ClaimRow[]>
loadMyTeam(db: Db, args: { userId: string }): Promise<MyTeam | null>
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/claims/index.test.ts`:

```tsx
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { teams, user } from "@/lib/db/schema";
import {
  claimTeam,
  loadClaimBoard,
  loadMyTeam,
  releaseTeam,
  releaseTeamAsAdmin,
} from "./index";

let h: TestDatabase;

beforeEach(async () => {
  h = await createTestDatabase();
  await h.db.insert(user).values([
    { id: "alice", name: "Alice", email: "alice@example.com" },
    { id: "bruno", name: "Bruno", email: "bruno@example.com" },
  ]);
  await h.db.insert(teams).values([
    { id: "t1", managerId: 1, managerName: "La rataneta" },
    { id: "t2", managerId: 2, managerName: "LamineTheTuareg" },
    { id: "t3", managerId: 3, managerName: "La Agustineta 96" },
  ]);
});

afterEach(async () => {
  await h.close();
});

const ownerOf = async (teamId: string) => {
  const [row] = await h.db.select().from(teams).where(eq(teams.id, teamId));
  return row.userId;
};

describe("claimTeam", () => {
  it("gives a free team to whoever asks first", async () => {
    expect(await claimTeam(h.db, { userId: "alice", teamId: "t1" })).toBe("claimed");
    expect(await ownerOf("t1")).toBe("alice");
  });

  it("refuses a team somebody else holds, and leaves that holder in place", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await claimTeam(h.db, { userId: "bruno", teamId: "t1" })).toBe("taken");
    expect(await ownerOf("t1")).toBe("alice");
  });

  it("refuses a second team, and moves neither row", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await claimTeam(h.db, { userId: "alice", teamId: "t2" })).toBe(
      "already-claimed-another",
    );
    expect(await ownerOf("t1")).toBe("alice");
    expect(await ownerOf("t2")).toBeNull();
  });

  it("reports a re-claim of your own team as the second team it is", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await claimTeam(h.db, { userId: "alice", teamId: "t1" })).toBe(
      "already-claimed-another",
    );
    expect(await ownerOf("t1")).toBe("alice");
  });

  it("decides the race in the statement: the second claim writes nothing", async () => {
    // PGlite is in-process and single-connection, so this is NOT two simultaneous
    // claims. What it proves is the property the guarantee rests on — the second
    // statement matches no row — which is what makes the real race safe.
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    const outcome = await claimTeam(h.db, { userId: "bruno", teamId: "t1" });
    expect(outcome).toBe("taken");
    expect(await ownerOf("t1")).toBe("alice");
  });
});

describe("releaseTeam", () => {
  it("frees whatever the caller holds, and lets the next person take it", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await releaseTeam(h.db, { userId: "alice" })).toBe("released");
    expect(await ownerOf("t1")).toBeNull();
    expect(await claimTeam(h.db, { userId: "bruno", teamId: "t1" })).toBe("claimed");
  });

  it("says so when there is nothing to release, and writes nothing", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await releaseTeam(h.db, { userId: "bruno" })).toBe("nothing-to-release");
    expect(await ownerOf("t1")).toBe("alice");
  });
});

describe("releaseTeamAsAdmin", () => {
  it("frees a claim the caller does not hold", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await releaseTeamAsAdmin(h.db, { teamId: "t1" })).toBe("released");
    expect(await ownerOf("t1")).toBeNull();
  });

  it("says so when the team was already free", async () => {
    expect(await releaseTeamAsAdmin(h.db, { teamId: "t2" })).toBe("nothing-to-release");
  });
});

describe("the reads the views need", () => {
  it("lists every team with its claim, ordered by manager name", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await loadClaimBoard(h.db)).toEqual([
      { teamId: "t3", managerName: "La Agustineta 96", claimedBy: null },
      { teamId: "t1", managerName: "La rataneta", claimedBy: "alice" },
      { teamId: "t2", managerName: "LamineTheTuareg", claimedBy: null },
    ]);
  });

  it("names the caller's own team, and nothing when they have none", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await loadMyTeam(h.db, { userId: "alice" })).toEqual({
      teamId: "t1",
      managerName: "La rataneta",
    });
    expect(await loadMyTeam(h.db, { userId: "bruno" })).toBeNull();
  });
});

describe("a claim and the sync that runs afterwards", () => {
  it("survives the team upsert the standings sync performs", async () => {
    // Ruling 7. runSync's upsert sets managerName and nothing else; the day somebody
    // widens that `set` clause, every claim in the league would be wiped on the next
    // sync and no other test would notice.
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });

    const { upsertTeams } = await import("@/lib/sync");
    await upsertTeams(h.db, [
      {
        teamId: "t1",
        managerId: 1,
        managerName: "La rataneta renamed",
        weekPoints: 40,
        roundPosition: 1,
        livePoints: null,
        teamValue: 1,
        teamPoints: 1,
      },
    ]);

    const [row] = await h.db.select().from(teams).where(eq(teams.id, "t1"));
    expect(row.managerName).toBe("La rataneta renamed");
    expect(row.userId).toBe("alice");
  });
});
```

- [ ] **Step 2: Export the sync's team upsert so the regression test can call it**

`src/lib/sync/index.ts:122` declares `function upsertTeams(db: Db, rows: StandingRow[])`, module-private. Add `export` to that one line and change nothing else about it.

- [ ] **Step 3: Run the tests and watch them fail**

Run: `npx vitest run src/lib/claims/index.test.ts`
Expected: FAIL — `Cannot find module './index'`. Every test in the file errors for that one reason. If any test fails for a different reason, read it before continuing.

- [ ] **Step 4: Write the module**

Create `src/lib/claims/index.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run src/lib/claims/index.test.ts`
Expected: all 12 pass. If "lists every team with its claim, ordered by manager name" fails on ordering, check the expectation against Postgres's collation of `La Agustineta 96` / `La rataneta` / `LamineTheTuareg` and fix the *expectation*, not the `order by` — the point is a stable order, not a particular one.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/claims src/lib/sync/index.ts
git commit -m "feat: claim and release a team, decided by one statement"
```

---

### Task 3: The list and the rule that shapes each row

The page's whole logic, as a pure function and a component, testable without a database or a browser.

**Files:**
- Create: `src/lib/domain/claim-row.ts`
- Create: `src/lib/domain/claim-row.test.ts`
- Create: `src/components/claim-list.tsx`
- Create: `src/components/claim-list.test.tsx`

**Interfaces:**
- Consumes: `ClaimRow` from `@/lib/claims` (Task 2).
- Produces:

```ts
type RowState = "free" | "mine" | "taken";
rowState(row: ClaimRow, viewer: { userId: string }): RowState
holdsATeam(rows: ClaimRow[], viewer: { userId: string }): boolean

type ClaimAction = (formData: FormData) => Promise<{ ok: boolean; message: string }>;

<ClaimList rows={ClaimRow[]} viewerId={string} canReleaseAny={boolean}
           claimAction={ClaimAction} releaseAction={ClaimAction} />
```

**`ClaimList` is a client component.** A server component with a plain `action={claim}`
throws the action's return value away, and the spec requires the outcome to appear as a
sentence — "Somebody claimed this team first" has to reach the reader. `sync-controls.tsx`
already solves this in this codebase: `"use client"`, `useState` for the result,
`useTransition` for pending. Follow it rather than inventing a second pattern.

`ClaimAction` is declared structurally in the component's own file, not imported from the
server action in Task 4: the component must not depend on a module that does not exist
yet, and the shapes match without a shared import.

- [ ] **Step 1: Write the failing test for the rule**

Create `src/lib/domain/claim-row.test.ts`:

```tsx
import { describe, expect, it } from "vitest";
import { holdsATeam, rowState } from "./claim-row";

const row = (claimedBy: string | null) => ({
  teamId: "t1",
  managerName: "La rataneta",
  claimedBy,
});

describe("rowState", () => {
  it("calls an unclaimed team free", () => {
    expect(rowState(row(null), { userId: "alice" })).toBe("free");
  });

  it("calls the viewer's own team mine", () => {
    expect(rowState(row("alice"), { userId: "alice" })).toBe("mine");
  });

  it("calls somebody else's team taken, without caring who", () => {
    expect(rowState(row("bruno"), { userId: "alice" })).toBe("taken");
  });
});

describe("holdsATeam", () => {
  it("is true when one of the rows is the viewer's", () => {
    expect(holdsATeam([row(null), row("alice")], { userId: "alice" })).toBe(true);
  });

  it("is false when somebody else holds every claimed row", () => {
    expect(holdsATeam([row(null), row("bruno")], { userId: "alice" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/domain/claim-row.test.ts`
Expected: FAIL — `Cannot find module './claim-row'`.

- [ ] **Step 3: Write the rule**

Create `src/lib/domain/claim-row.ts`:

```ts
import type { ClaimRow } from "@/lib/claims";

export type RowState = "free" | "mine" | "taken";

/**
 * What a row is, from where the reader sits.
 *
 * `taken` deliberately carries no identity. Who holds a team is never rendered
 * (Ruling 4), so the only thing this distinction has to support is which control the
 * row gets — and "somebody" is enough for that.
 */
export function rowState(row: ClaimRow, viewer: { userId: string }): RowState {
  if (row.claimedBy === null) return "free";
  return row.claimedBy === viewer.userId ? "mine" : "taken";
}

/** Whether the viewer already holds one, which is what silences every free row. */
export function holdsATeam(rows: ClaimRow[], viewer: { userId: string }): boolean {
  return rows.some((row) => row.claimedBy === viewer.userId);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/domain/claim-row.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Write the failing test for the component**

Create `src/components/claim-list.test.tsx`. This repo renders components with `renderToStaticMarkup` and asserts on the HTML; there is no testing-library here. Static markup is the initial render, so these tests cover which control each row gets — not what happens after a click. That is the same line `sync-controls.tsx` draws: the decisions live in tested pure functions, the interactive shell is walked by hand.

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimList } from "./claim-list";

const noop = async () => ({ ok: true, message: "" });

const rows = [
  { teamId: "t1", managerName: "La rataneta", claimedBy: null },
  { teamId: "t2", managerName: "LamineTheTuareg", claimedBy: "bruno" },
  { teamId: "t3", managerName: "La Agustineta 96", claimedBy: "alice" },
];

const render = (over: Partial<Parameters<typeof ClaimList>[0]> = {}) =>
  renderToStaticMarkup(
    <ClaimList
      rows={rows}
      viewerId="alice"
      canReleaseAny={false}
      claimAction={noop}
      releaseAction={noop}
      {...over}
    />,
  );

describe("ClaimList", () => {
  it("names every manager, whatever the state of their row", () => {
    const html = render();
    for (const name of ["La rataneta", "LamineTheTuareg", "La Agustineta 96"]) {
      expect(html).toContain(name);
    }
  });

  it("never names who holds a team", () => {
    const html = render();
    expect(html).not.toContain("bruno");
    expect(html).not.toContain("alice");
  });

  it("says a team someone else holds is claimed, and offers no control for it", () => {
    const html = render({ rows: [rows[1]] });
    expect(html).toContain("Claimed");
    expect(html).not.toContain("<button");
  });

  it("offers the claim button only while the viewer holds nothing", () => {
    const free = render({ rows: [rows[0]] });
    expect(free).toContain("This is me");

    const busy = render({ rows: [rows[0], rows[2]] });
    expect(busy).not.toContain("This is me");
    expect(busy).toContain("one team per person");
  });

  it("offers release on the viewer's own row", () => {
    expect(render()).toContain("Release");
  });

  it("offers release on somebody else's row only to whoever may correct data", () => {
    const plain = render({ rows: [rows[1]] });
    expect(plain).not.toContain("Release");

    const privileged = render({ rows: [rows[1]], canReleaseAny: true });
    expect(privileged).toContain("Release");
    // Still no name, even here.
    expect(privileged).not.toContain("bruno");
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/components/claim-list.test.tsx`
Expected: FAIL — `Cannot find module './claim-list'`.

- [ ] **Step 7: Load the design skill, then write the component**

Invoke the `frontend-design` skill before writing this file — this is the slice's main new view, and the repo's convention is that its visual language is chosen deliberately rather than inherited from a default.

Create `src/components/claim-list.tsx`. Match the existing visual vocabulary: `var(--board-ink-dim)` for secondary text, `var(--board-line)` for rules, and the type sizes `standings-table.tsx` establishes.

```tsx
"use client";

import { useState, useTransition } from "react";
import type { ClaimRow } from "@/lib/claims";
import { holdsATeam, rowState } from "@/lib/domain/claim-row";

type ClaimResult = { ok: boolean; message: string };
type ClaimAction = (formData: FormData) => Promise<ClaimResult>;

export function ClaimList({
  rows,
  viewerId,
  canReleaseAny,
  claimAction,
  releaseAction,
}: {
  rows: ClaimRow[];
  viewerId: string;
  canReleaseAny: boolean;
  claimAction: ClaimAction;
  releaseAction: ClaimAction;
}) {
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [pending, startTransition] = useTransition();
  const taken = holdsATeam(rows, { userId: viewerId });

  // Losing a race is an ordinary outcome, not an exception: the action returns a
  // sentence and the page it revalidates returns the world as it now is.
  const run = (action: ClaimAction, formData: FormData) =>
    startTransition(async () => setResult(await action(formData)));

  return (
    <>
      {result ? (
        <p
          className="mt-3 text-[11.5px]"
          style={{ color: result.ok ? "var(--board-ink-dim)" : "var(--board-alert)" }}
          role="status"
        >
          {result.message}
        </p>
      ) : null}

      {taken ? (
        <p className="mt-2 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
          It is one team per person. Release yours to pick a different one.
        </p>
      ) : null}

      <ul className="mt-4">
        {rows.map((row) => {
          const state = rowState(row, { userId: viewerId });
          return (
            <li
              key={row.teamId}
              className="flex items-center justify-between gap-3 border-b py-[11px]"
              style={{ borderColor: "var(--board-line)" }}
            >
              <span className="min-w-0 truncate text-[14.5px]">{row.managerName}</span>

              {state === "free" && !taken ? (
                <form action={(formData) => run(claimAction, formData)}>
                  <input type="hidden" name="teamId" value={row.teamId} />
                  <button
                    type="submit"
                    disabled={pending}
                    className="text-[11px] underline underline-offset-4"
                  >
                    This is me
                  </button>
                </form>
              ) : null}

              {state === "mine" ? (
                <form
                  action={(formData) => run(releaseAction, formData)}
                  className="flex items-center gap-3"
                >
                  <span className="text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
                    Yours
                  </span>
                  <button
                    type="submit"
                    disabled={pending}
                    className="text-[11px] underline underline-offset-4"
                  >
                    Release
                  </button>
                </form>
              ) : null}

              {state === "taken" ? (
                <span className="flex items-center gap-3">
                  <span className="text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
                    Claimed
                  </span>
                  {canReleaseAny ? (
                    <form action={(formData) => run(releaseAction, formData)}>
                      <input type="hidden" name="teamId" value={row.teamId} />
                      <button
                        type="submit"
                        disabled={pending}
                        className="text-[11px] underline underline-offset-4"
                      >
                        Release
                      </button>
                    </form>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
```

Note the two shapes of the release form: the viewer's own row submits **no** `teamId`, so the action releases by user id (Ruling 5); an admin's row on somebody else's team submits one. The action tells them apart by whether the field arrived.

`var(--board-alert)` (`#ef8a76`, `globals.css:18`) is the token the market log already uses for its breach marker. Verified present; use it as written.

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run src/components/claim-list.test.tsx`
Expected: 6 pass.

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/domain/claim-row.ts src/lib/domain/claim-row.test.ts src/components/claim-list.tsx src/components/claim-list.test.tsx
git commit -m "feat: the claim list, and the rule that shapes each row"
```

---

### Task 4: The page and its actions

**Files:**
- Create: `src/app/(portal)/claim/page.tsx`
- Create: `src/app/(portal)/claim/actions.ts`
- Modify: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `loadClaimBoard`, `claimTeam`, `releaseTeam`, `releaseTeamAsAdmin` (Task 2); `ClaimList` (Task 3); `requireSession`, `getSession`, `decideAccess` from `@/lib/auth/guards`.
- Produces: the `/claim` route. Nothing imports it.

- [ ] **Step 1: Write the failing e2e test**

Append to `e2e/auth.spec.ts`, following the redirect tests already there:

```ts
test("the claim page redirects anyone who has not signed in", async ({ page }) => {
  await page.goto("/claim");
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test:e2e`
Expected: the new test FAILS — `/claim` 404s, so the URL never becomes `/login`. The other 13 pass.

- [ ] **Step 3: Write the actions**

Create `src/app/(portal)/claim/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { claimTeam, releaseTeam, releaseTeamAsAdmin } from "@/lib/claims";
import { decideAccess, requireSession } from "@/lib/auth/guards";

export type ClaimActionResult = { ok: boolean; message: string };

/**
 * The wording of every outcome lives here and nowhere else.
 *
 * `taken` and `already-claimed-another` are not failures: they are what losing a race
 * between friends looks like. They come back as ordinary text and the page re-reads
 * the world, which is the only thing that can be authoritative about it.
 */
export async function claim(formData: FormData): Promise<ClaimActionResult> {
  const session = await requireSession();
  const teamId = String(formData.get("teamId") ?? "");
  if (teamId === "") return { ok: false, message: "No team was named." };

  const outcome = await claimTeam(db, { userId: session.user.id, teamId });
  revalidatePath("/claim");
  revalidatePath("/");

  if (outcome === "claimed") return { ok: true, message: "That team is yours now." };
  if (outcome === "taken") {
    return { ok: false, message: "Somebody claimed this team first." };
  }
  return { ok: false, message: "You already have a team. Release it first." };
}

/**
 * Releases the caller's own team, or — for whoever may correct league data — the team
 * named in the form. The two are different functions underneath: only the second takes
 * a team id, and only the second checks a permission.
 */
export async function release(formData: FormData): Promise<ClaimActionResult> {
  const session = await requireSession();
  const teamId = String(formData.get("teamId") ?? "");

  const outcome =
    teamId === ""
      ? await releaseTeam(db, { userId: session.user.id })
      : decideAccess(session, { leagueData: ["correct"] }).kind === "allow"
        ? await releaseTeamAsAdmin(db, { teamId })
        : null;

  revalidatePath("/claim");
  revalidatePath("/");

  if (outcome === null) return { ok: false, message: "That is not yours to release." };
  if (outcome === "released") return { ok: true, message: "Released." };
  return { ok: false, message: "There was nothing to release." };
}
```

The permission is `leagueData: ["correct"]`, which `collaborator` and `admin` both hold. The spec says "an admin"; this is the codebase's nearest existing grant and freeing a mis-claim is exactly correcting league data, so it reuses the statement rather than adding a `team` resource. No collaborator exists today, so the practical set of people is identical.

- [ ] **Step 4: Write the page**

Create `src/app/(portal)/claim/page.tsx`:

```tsx
import { db } from "@/lib/db";
import { loadClaimBoard } from "@/lib/claims";
import { decideAccess, requireSession } from "@/lib/auth/guards";
import { ClaimList } from "@/components/claim-list";
import { claim, release } from "./actions";

export default async function ClaimPage() {
  const session = await requireSession();
  const rows = await loadClaimBoard(db);
  const canReleaseAny = decideAccess(session, { leagueData: ["correct"] }).kind === "allow";

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">Which team is yours?</h1>
      <p className="mt-1 text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
        Pick your manager. Only you see the mark — nobody is told who claimed what.
      </p>

      <ClaimList
        rows={rows}
        viewerId={session.user.id}
        canReleaseAny={canReleaseAny}
        claimAction={claim}
        releaseAction={release}
      />
    </section>
  );
}
```

- [ ] **Step 5: Run the e2e test and watch it pass**

Run: `pnpm test:e2e`
Expected: 14 pass, including the new redirect.

- [ ] **Step 6: Drive it by hand, because no automated test can**

The e2e suite never signs in, so the claiming path itself has no automated coverage. Run `pnpm dev`, sign in, and confirm on `/claim`:

1. every manager name is listed;
2. claiming one marks it `Yours` and the other rows lose their buttons;
3. `Release` frees it and the buttons come back;
4. no page anywhere shows another person's name.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add "src/app/(portal)/claim" e2e/auth.spec.ts
git commit -m "feat: the page where a manager claims their team"
```

---

### Task 5: The one line on the home page

**Files:**
- Create: `src/components/claim-line.tsx`
- Create: `src/components/claim-line.test.tsx`
- Modify: `src/app/page.tsx:13-40`

**Interfaces:**
- Consumes: `loadMyTeam` (Task 2).
- Produces: `<ClaimLine myTeamName={string | null} />`.

- [ ] **Step 1: Write the failing test**

Create `src/components/claim-line.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimLine } from "./claim-line";

describe("ClaimLine", () => {
  it("nudges whoever has no team, and links to the page", () => {
    const html = renderToStaticMarkup(<ClaimLine myTeamName={null} />);
    expect(html).toContain("No team claimed yet");
    expect(html).toContain('href="/claim"');
    expect(html).toContain("Claim yours");
  });

  it("names the team of whoever has one, and still links to the page", () => {
    const html = renderToStaticMarkup(<ClaimLine myTeamName="La Agustineta 96" />);
    expect(html).toContain("La Agustineta 96");
    expect(html).toContain('href="/claim"');
    expect(html).toContain("change");
    expect(html).not.toContain("No team claimed yet");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/claim-line.test.tsx`
Expected: FAIL — `Cannot find module './claim-line'`.

- [ ] **Step 3: Write the component**

Create `src/components/claim-line.tsx`:

```tsx
import Link from "next/link";

/**
 * One slot on the home page, two states. It is the only door to `/claim`: the nav has
 * six destinations across two tiers already, and this is done once in a lifetime
 * (Ruling 6).
 */
export function ClaimLine({ myTeamName }: { myTeamName: string | null }) {
  return (
    <p className="mt-3 text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
      {myTeamName === null ? (
        <>
          No team claimed yet.{" "}
          <Link href="/claim" className="underline underline-offset-4">
            Claim yours
          </Link>
        </>
      ) : (
        <>
          Your team: {myTeamName} ·{" "}
          <Link href="/claim" className="underline underline-offset-4">
            change
          </Link>
        </>
      )}
    </p>
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/components/claim-line.test.tsx`
Expected: 2 pass.

- [ ] **Step 5: Put it on the home page**

In `src/app/page.tsx`, inside the signed-in branch only — the signed-out early return keeps exactly the page it has today. Add the import, the read, and the line under the tagline:

```tsx
import { loadMyTeam } from "@/lib/claims";
import { ClaimLine } from "@/components/claim-line";
```

```tsx
  const myTeam = await loadMyTeam(db, { userId: session.user.id });
```

```tsx
      <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>
        Management portal for our private LaLiga Fantasy league.
      </p>

      <ClaimLine myTeamName={myTeam?.managerName ?? null} />
```

- [ ] **Step 6: Run the suite, typecheck, build**

Run: `pnpm test && npx tsc --noEmit && pnpm build`
Expected: all green. The build matters here: `page.tsx` is the one page that renders for signed-out visitors too, and a bad conditional shows up as a build-time render error.

- [ ] **Step 7: Commit**

```bash
git add src/components/claim-line.tsx src/components/claim-line.test.tsx src/app/page.tsx
git commit -m "feat: point managers at the claim page from home"
```

---

### Task 6: Marking your own row in the standings

**Files:**
- Modify: `src/components/standings-table.tsx:35-48` (props) and the row's name cell
- Modify: `src/components/standings-table.test.tsx`
- Modify: `src/app/(portal)/standings/page.tsx:7-9`

**Interfaces:**
- Consumes: `loadMyTeam` (Task 2).
- Produces: `<StandingsTable … myTeamId?: string | null />`. **Optional on purpose:** the existing test file renders this component five times without the prop, and Vitest does not typecheck, so a required prop would pass every test and then fail `tsc --noEmit`. The page passes it explicitly.

- [ ] **Step 1: Write the failing test**

Append to `src/components/standings-table.test.tsx`, reusing whatever row fixture the file already builds:

The file already builds `teams` (ids `a` and `b`) and `season`, and renders with `formByTeam={{}}`. Reuse both; add no fixture.

```tsx
describe("the viewer's own row", () => {
  const rows = buildTable(season, teams);

  it("marks it, and marks only it", () => {
    const html = renderToStaticMarkup(
      <StandingsTable rows={rows} formByTeam={{}} isLive={false} myTeamId="b" />,
    );
    expect(html.match(/aria-label="Your team"/g)).toHaveLength(1);
    // And it is B's row that carries it, not merely some row.
    expect(html.slice(html.indexOf("Manager B"))).toContain('aria-label="Your team"');
  });

  it("marks nothing when the viewer has claimed no team", () => {
    const html = renderToStaticMarkup(
      <StandingsTable rows={rows} formByTeam={{}} isLive={false} myTeamId={null} />,
    );
    expect(html).not.toContain('aria-label="Your team"');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/standings-table.test.tsx`
Expected: FAIL — TypeScript is not checked by Vitest, so it fails on the assertion (nothing renders the label), not on the unknown prop.

- [ ] **Step 3: Load the design skill, then add the marker**

Invoke `frontend-design` before this edit: check 40 in the spec asks whether the marker is visible without shouting, and that is a decision to make deliberately.

In `src/components/standings-table.tsx`, add `myTeamId?: string | null` to the props type and the destructuring, then mark the name cell:

```tsx
          <span className="min-w-0">
            <span className="block truncate text-[14.5px]">
              {row.managerName}
              {row.teamId === myTeamId ? (
                <span
                  aria-label="Your team"
                  className="ml-2 text-[10px] uppercase tracking-[0.1em]"
                  style={{ color: "var(--board-ink-dim)" }}
                >
                  you
                </span>
              ) : null}
            </span>
```

- [ ] **Step 4: Pass it from the page**

In `src/app/(portal)/standings/page.tsx`:

```tsx
import { loadMyTeam } from "@/lib/claims";
```

```tsx
  const session = await requireSession();
  const { snapshots, teams, lastSync, currentGameweek, isLive } = await loadSnapshots(db);
  const myTeam = await loadMyTeam(db, { userId: session.user.id });
```

and pass `myTeamId={myTeam?.teamId ?? null}` to `<StandingsTable />`. Note `requireSession()`'s return value is currently discarded on line 8; it is a session, and this is what it is for.

- [ ] **Step 5: Run everything**

Run: `pnpm test && npx tsc --noEmit && pnpm build`
Expected: all green, including the two new tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/standings-table.tsx src/components/standings-table.test.tsx "src/app/(portal)/standings/page.tsx"
git commit -m "feat: mark your own row in the standings"
```

---

### Task 7: The checks, and handing it over

**Files:**
- Modify: `docs/superpowers/specs/2026-09-08-tebasfury-team-claim-design.md` (the visual-checks section)

- [ ] **Step 1: Run the full battery one last time**

Run: `pnpm test && npx tsc --noEmit && pnpm build && pnpm test:e2e`
Expected: all four clean. Record the actual counts in the commit message rather than "all tests pass".

- [ ] **Step 2: Walk the visual checks 35–40**

They are listed at the end of the spec. Perform them against `pnpm dev` at 320px and 375px, signed in, with and without a claimed team, and once as an admin. Write the outcome into the spec — either "performed <date>, all clean" like Step 3's list, or the specific thing that is wrong.

- [ ] **Step 3: Commit whatever the checks changed**

```bash
git add docs/superpowers/specs/2026-09-08-tebasfury-team-claim-design.md
git commit -m "docs: record the visual checks for the claim slice"
```

- [ ] **Step 4: Hand the deploy over**

The owner runs `git push origin main` — it is the deploy trigger, and only they can run it. Before they do, `0009` must be applied:

```bash
DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate
```

Then tell them, in one message: the migration is applied (or needs applying), the push is theirs to make, and the group now has something worth signing in for.
