# Opportunity View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The home page answers "who should I sign right now" with two five-row boards — best value for money, and free players who are scoring — and the catalogue gains points per million as a sort you can arrive at by link.

**Architecture:** No new database read and no new SQL. The home page runs the same `loadPlayerCatalogue` + `buildCatalogue` pair `/players` already runs, and both boards are pure compositions of functions the domain already has plus one new sort key. The boards are server components, so nothing crosses to the client.

**Tech Stack:** Next.js 16.3.4 (App Router, `cacheComponents` off), React 19, Drizzle ORM on Neon HTTP in production and PGlite in tests, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-07-tebasfury-opportunity-view-design.md` — read it first; every ruling referenced below is argued there.

## Global Constraints

- **No new query in `src/lib/db/queries.ts`.** Ruling 7. If this plan makes you add one, something has gone wrong — the absence is the point.
- **One floor, one name.** `MIN_GAMEWEEKS_FOR_RANKING` governs both the average sort and points per million. Never introduce a second threshold for the same question.
- **The sort key sinks; the board filters.** Ruling 4. `sortCatalogue(rows, "perMillion")` hides nobody; `bestValueForMoney` removes unqualified rows because a five-row board cannot express sinking.
- **"Free" is only sayable once a squad has been read.** Ruling 6. When `ownershipKnown` is false the free board renders a line, never a list.
- **Nobody is excluded for being unavailable.** Ruling 5, the owner's explicit call. An injured player ranks on merit and carries `statusLabel` in `--board-alert`.
- **`searchParams` is a `Promise` in Next 16.3.4** and must be awaited. Verified in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.
- **The URL is an entry point, not a mirror.** Read initial state from it; never write state back.
- **UI copy is English**, as is every artefact in this repo.
- **`CatalogueRow` requires `clubName`.** Every row literal you write in a test needs it, or the file will not compile.
- Run tests with `pnpm test` (Vitest, `vitest run`). Lint with `pnpm lint`. **Vitest does not typecheck** — run `npx tsc --noEmit` before every commit that widens a shared type.
- Commit after every task. Do not push — the owner pushes, and only the owner can.

---

### Task 1: The domain gains points per million as a sort

**Files:**
- Modify: `src/lib/domain/players.ts` — the constant at `:135`, the `SortKey` union at `:123`, the comparators at `:155-163`
- Test: `src/lib/domain/players.test.ts`

**Interfaces:**
- Consumes: `pointsPerMillion(seasonPoints, currentValue)`, already in the file.
- Produces: `MIN_GAMEWEEKS_FOR_RANKING` (renamed from `MIN_GAMEWEEKS_FOR_AVERAGE_SORT`), and `SortKey` widened to include `"perMillion"`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/domain/players.test.ts`, after the `sortCatalogue` describe:

```ts
describe("the value-for-money sort", () => {
  const row = (over: Partial<CatalogueRow> = {}): CatalogueRow => ({
    id: "p1",
    nickname: "Ada",
    position: "Midfielder",
    status: "ok",
    currentValue: 1_000_000,
    seasonPoints: 10,
    averagePoints: 5,
    gameweeksRecorded: 4,
    ownerTeamId: null,
    ownerName: null,
    clubName: null,
    ...over,
  });

  it("ranks by points per million, and demotes a single-gameweek player", () => {
    // The same trap "Best average" already had to fix: 12 points in one appearance at
    // €1.0M is 12.0 pts/M€, which would outrank 30 points across three weeks at €3.0M.
    const lucky = row({ id: "lucky", nickname: "Kiri", currentValue: 1_000_000, seasonPoints: 12, gameweeksRecorded: 1 });
    const steady = row({ id: "steady", nickname: "Léo", currentValue: 3_000_000, seasonPoints: 30, gameweeksRecorded: 3 });
    expect(sortCatalogue([lucky, steady], "perMillion").map((r) => r.id)).toEqual(["steady", "lucky"]);
  });

  it("sinks a player with no value snapshot rather than treating them as free", () => {
    const priced = row({ id: "priced", currentValue: 2_000_000, seasonPoints: 20 });
    const unpriced = row({ id: "unpriced", currentValue: null, seasonPoints: 20 });
    expect(sortCatalogue([unpriced, priced], "perMillion").map((r) => r.id)).toEqual(["priced", "unpriced"]);
  });

  it("breaks a tie by name, like every other sort", () => {
    const zoe = row({ id: "zoe", nickname: "Zoe", currentValue: 2_000_000, seasonPoints: 20 });
    const ada = row({ id: "ada", nickname: "Ada", currentValue: 2_000_000, seasonPoints: 20 });
    expect(sortCatalogue([zoe, ada], "perMillion").map((r) => r.id)).toEqual(["ada", "zoe"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/domain/players.test.ts`
Expected: FAIL — `"perMillion"` is not assignable to `SortKey`, and the comparator does not exist.

- [ ] **Step 3: Rename the floor**

In `src/lib/domain/players.ts`, rename the constant and widen its doc comment. Replace:

```ts
/**
 * A single recorded gameweek is not an average — it is one score wearing an average's
 * clothes, and it was outranking six-gameweek seasons under "Best average" by October.
 * Below this many recorded gameweeks a player sinks in that one sort exactly like an
 * unknown value does, rather than being hidden or relabelled: they are still visible
 * (and still show their real average) under every other sort and in their own row.
 * Three is the smallest sample that resists a single outlier while staying reachable
 * in the season's first month, which is when this sort gets used the most.
 */
export const MIN_GAMEWEEKS_FOR_AVERAGE_SORT = 3;
```

with:

```ts
/**
 * A single recorded gameweek is not an average — it is one score wearing an average's
 * clothes, and it was outranking six-gameweek seasons under "Best average" by October.
 * Below this many recorded gameweeks a player sinks in that one sort exactly like an
 * unknown value does, rather than being hidden or relabelled: they are still visible
 * (and still show their real average) under every other sort and in their own row.
 * Three is the smallest sample that resists a single outlier while staying reachable
 * in the season's first month, which is when this sort gets used the most.
 *
 * It governs two rankings now, which is why it is no longer named after one of them:
 * points per million has exactly the same weakness for exactly the same reason — a
 * cheap player with one lucky appearance — and answering it with a second, different
 * number would be two claims about one question, on data nobody has.
 */
export const MIN_GAMEWEEKS_FOR_RANKING = 3;
```

Then fix its two other references:

- `:160` in the `average` comparator — `row.gameweeksRecorded >= MIN_GAMEWEEKS_FOR_RANKING`.
- The comment inside `src/lib/domain/players.test.ts`'s "does not let a single-gameweek average dominate" test, which names the old constant.

Grep before you trust this list: `grep -rn MIN_GAMEWEEKS src/`.

- [ ] **Step 4: Add the sort key**

Widen the union:

```ts
export type SortKey = "value" | "points" | "average" | "perMillion" | "name";
```

and add the comparator to the `comparators` record, after `average`:

```ts
    perMillion: descending((row) =>
      row.gameweeksRecorded >= MIN_GAMEWEEKS_FOR_RANKING
        ? pointsPerMillion(row.seasonPoints, row.currentValue)
        : null,
    ),
```

`pointsPerMillion` is declared *below* `sortCatalogue` in this file. That is fine — function declarations hoist — so do not reorder the file to satisfy a habit.

The `descending` helper is what gives this key two behaviours for free, both already argued and tested elsewhere: a null sinks instead of counting as zero, and ties break by name.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/lib/domain/players.test.ts`
Expected: PASS — the three new tests plus every pre-existing one.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/domain/players.ts src/lib/domain/players.test.ts
git commit -m "feat: rank the catalogue by points per million"
```

Expected from `tsc`: only `src/app/layout.tsx: Cannot find name 'LayoutProps'`, which is a Next-generated global that resolves once `.next/types` exists. Anything else is yours.

---

### Task 2: The two boards

**Files:**
- Modify: `src/lib/domain/players.ts` — append after `sortCatalogue`
- Test: `src/lib/domain/players.test.ts`

**Interfaces:**
- Consumes: `sortCatalogue` with `"perMillion"` and `"points"`, `filterCatalogue`, `pointsPerMillion`, `MIN_GAMEWEEKS_FOR_RANKING` (Task 1).
- Produces: `BOARD_ROWS = 5`; `bestValueForMoney(rows: CatalogueRow[], limit?: number): CatalogueRow[]`; `freeAndScoring(rows: CatalogueRow[], limit?: number): CatalogueRow[]`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/domain/players.test.ts`. It needs its own row factory because these tests care about different fields than the sort tests do:

```ts
describe("the opportunity boards", () => {
  const row = (over: Partial<CatalogueRow> = {}): CatalogueRow => ({
    id: "p1",
    nickname: "Ada",
    position: "Midfielder",
    status: "ok",
    currentValue: 2_000_000,
    seasonPoints: 20,
    averagePoints: 5,
    gameweeksRecorded: 4,
    ownerTeamId: null,
    ownerName: null,
    clubName: null,
    ...over,
  });

  it("removes a low-sample player from the board rather than sinking them", () => {
    // Ruling 4. On the catalogue a demoted row still appears at the bottom; on a
    // five-row board that is indistinguishable from hiding, and padding the board
    // with rows that cannot be ranked is worse than a board that is honestly short.
    const lucky = row({ id: "lucky", nickname: "Kiri", currentValue: 1_000_000, seasonPoints: 12, gameweeksRecorded: 1 });
    const steady = row({ id: "steady", nickname: "Léo", seasonPoints: 20, gameweeksRecorded: 4 });
    expect(bestValueForMoney([lucky, steady]).map((r) => r.id)).toEqual(["steady"]);
  });

  it("removes a player with no value snapshot", () => {
    const unpriced = row({ id: "unpriced", currentValue: null });
    expect(bestValueForMoney([unpriced])).toEqual([]);
  });

  it("is empty rather than padded when nobody qualifies", () => {
    const nobody = row({ id: "nobody", gameweeksRecorded: 0, seasonPoints: 0 });
    expect(bestValueForMoney([nobody])).toEqual([]);
  });

  it("caps the board at five rows", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      row({ id: `p${i}`, nickname: `Player ${i}`, seasonPoints: 30 - i }),
    );
    expect(bestValueForMoney(many)).toHaveLength(5);
    expect(bestValueForMoney(many, 2)).toHaveLength(2);
  });

  it("lists only unowned players on the free board, best scorer first", () => {
    const owned = row({ id: "owned", nickname: "Owned", seasonPoints: 40, ownerTeamId: "t1", ownerName: "Manager A" });
    const freeLow = row({ id: "free-low", nickname: "Low", seasonPoints: 5 });
    const freeHigh = row({ id: "free-high", nickname: "High", seasonPoints: 11 });
    expect(freeAndScoring([owned, freeLow, freeHigh]).map((r) => r.id)).toEqual(["free-high", "free-low"]);
  });

  it("leaves a free player who has not scored off the free board", () => {
    // The block is called "Free and scoring". A free player on nought points is not an
    // opportunity, and padding the list with them would make the heading a lie.
    const scoreless = row({ id: "scoreless", seasonPoints: 0 });
    expect(freeAndScoring([scoreless])).toEqual([]);
  });

  it("does not need a value to rank the free board", () => {
    // Ownership and points are enough. A player swept before their first value
    // snapshot still belongs here, unlike on the value-for-money board.
    const unpriced = row({ id: "unpriced", currentValue: null, seasonPoints: 7 });
    expect(freeAndScoring([unpriced]).map((r) => r.id)).toEqual(["unpriced"]);
  });
});
```

Add `bestValueForMoney`, `freeAndScoring` to the import list at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/domain/players.test.ts`
Expected: FAIL — neither function is exported.

- [ ] **Step 3: Implement**

Append to `src/lib/domain/players.ts`, immediately after `sortCatalogue`:

```ts
/**
 * How many rows a home-page board shows.
 *
 * Five is a landing page's worth of rows rather than a measured figure, which is
 * exactly why it has a name: disagreeing with it later should cost one line, not a
 * search for the number 5 across two components.
 */
export const BOARD_ROWS = 5;

/**
 * The best points per million of market value.
 *
 * Unqualified rows are FILTERED, not sunk — the difference from `sortCatalogue`'s own
 * treatment, and the reason is the board's size. Five rows are a claim that these are
 * the best; a board padded to five with rows that cannot be ranked, showing a dash
 * where the figure goes, makes that claim falsely. See Ruling 4.
 *
 * Two things disqualify a player: fewer than `MIN_GAMEWEEKS_FOR_RANKING` recorded
 * gameweeks, and no value snapshot yet (which is what `pointsPerMillion` returns null
 * for, alongside a value of zero).
 */
export function bestValueForMoney(rows: CatalogueRow[], limit = BOARD_ROWS): CatalogueRow[] {
  const qualified = rows.filter(
    (row) =>
      row.gameweeksRecorded >= MIN_GAMEWEEKS_FOR_RANKING &&
      pointsPerMillion(row.seasonPoints, row.currentValue) !== null,
  );
  return sortCatalogue(qualified, "perMillion").slice(0, limit);
}

/**
 * Unowned players who are actually scoring, best first.
 *
 * Deliberately takes no `ownershipKnown`: this function cannot tell "nobody owns them"
 * from "no squad has been read", and it should not try. The caller renders Ruling 6's
 * line instead of calling this at all when ownership is unknown.
 *
 * A free player on nought points is excluded rather than padding the list. The block
 * is called "Free and scoring", and a scoreless row would make its own heading false.
 * No value is required — ownership and points are the whole claim here.
 */
export function freeAndScoring(rows: CatalogueRow[], limit = BOARD_ROWS): CatalogueRow[] {
  const free = filterCatalogue(rows, { query: "", position: null, ownership: "free" }).filter(
    (row) => row.seasonPoints > 0,
  );
  return sortCatalogue(free, "points").slice(0, limit);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/domain/players.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/domain/players.ts src/lib/domain/players.test.ts
git commit -m "feat: derive the two opportunity boards in the domain"
```

---

### Task 3: The catalogue can be arrived at by link

**Files:**
- Modify: `src/lib/domain/players.ts` — append `parseCatalogueEntry`
- Modify: `src/components/player-catalogue.tsx` — `SORTS` at `:42-47`, the props and state at `:92-103`
- Modify: `src/app/(portal)/players/page.tsx`
- Test: `src/lib/domain/players.test.ts`, `src/components/player-catalogue.test.tsx`

**Interfaces:**
- Consumes: `SortKey` including `"perMillion"` (Task 1), `CatalogueFilter` (existing).
- Produces: `parseCatalogueEntry(params: Record<string, string | string[] | undefined>): { sort: SortKey; ownership: "all" | "owned" | "free" }`; `PlayerCatalogue` gains optional `initialSort` and `initialOwnership` props.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/domain/players.test.ts`:

```ts
describe("parseCatalogueEntry", () => {
  it("reads a sort and an ownership filter it recognises", () => {
    expect(parseCatalogueEntry({ sort: "perMillion", ownership: "free" })).toEqual({
      sort: "perMillion",
      ownership: "free",
    });
  });

  it("falls back to the catalogue's own defaults for anything else", () => {
    // A URL is typed by hand, shared, and outlives the code that made it. Every
    // unrecognised value lands on the view the catalogue opens with anyway, so a stale
    // or mangled link degrades to the normal page rather than to an error.
    expect(parseCatalogueEntry({ sort: "bogus", ownership: "nobody" })).toEqual({
      sort: "value",
      ownership: "all",
    });
    expect(parseCatalogueEntry({})).toEqual({ sort: "value", ownership: "all" });
  });

  it("refuses a repeated parameter rather than guessing which one was meant", () => {
    expect(parseCatalogueEntry({ sort: ["perMillion", "points"] })).toEqual({
      sort: "value",
      ownership: "all",
    });
  });
});
```

And to `src/components/player-catalogue.test.tsx`, inside the `PlayerCatalogue` describe:

```tsx
  it("opens on the sort and ownership it was given, not on the defaults", () => {
    // This is what makes the home page's links land somewhere: the catalogue's opening
    // view comes from the URL, read on the server and handed down as props.
    const html = renderToStaticMarkup(
      <PlayerCatalogue rows={[row("p1")]} ownershipKnown initialSort="perMillion" initialOwnership="free" />,
    );
    expect(html).toContain('aria-pressed="true" class="rounded-full border px-3 py-1 text-[12px]" style="border-color:var(--board-ink-dim);color:var(--board-ink)">Best value for money');
    expect(html).toContain('aria-pressed="true" class="rounded-full border px-3 py-1 text-[12px]" style="border-color:var(--board-ink-dim);color:var(--board-ink)">Free');
  });
```

That assertion depends on React's attribute order, which is stable for a given React
version but is more markup than the claim needs. If it fights you, use this instead —
it pins the same thing (the pill is *active*, not merely present) without depending on
the class or style attributes:

```tsx
    const activePill = (label: string) =>
      new RegExp(`aria-pressed="true"[^>]*>${label}</button>`);
    expect(html).toMatch(activePill("Best value for money"));
    expect(html).toMatch(activePill("Free"));
```

What you must not do is weaken it to `toContain("Best value for money")`: that passes
even when the pill is inactive, which is the only thing this test exists to prove.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/domain/players.test.ts src/components/player-catalogue.test.tsx`
Expected: FAIL — `parseCatalogueEntry` is not exported, and `initialSort` is not a prop.

- [ ] **Step 3: Implement the parser**

Append to `src/lib/domain/players.ts`:

```ts
const SORT_KEYS: SortKey[] = ["value", "points", "average", "perMillion", "name"];
const OWNERSHIP_KEYS: CatalogueFilter["ownership"][] = ["all", "owned", "free"];

/**
 * The catalogue view a URL asks for.
 *
 * The address is an entry point, not a mirror: this reads the opening state and nothing
 * writes it back, so pressing pills afterwards does not rewrite the URL. Making it a
 * mirror means keeping router and component state in step inside a component that has
 * no such coupling today, which is more than the affordance is worth. See Ruling 8.
 *
 * Anything unrecognised — a typo, a stale link, a repeated parameter — falls back to the
 * view the catalogue opens with anyway. A bad link should degrade to the normal page.
 */
export function parseCatalogueEntry(params: Record<string, string | string[] | undefined>): {
  sort: SortKey;
  ownership: CatalogueFilter["ownership"];
} {
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
  return {
    sort: SORT_KEYS.find((key) => key === one(params.sort)) ?? "value",
    ownership: OWNERSHIP_KEYS.find((key) => key === one(params.ownership)) ?? "all",
  };
}
```

- [ ] **Step 4: Add the pill and the props**

In `src/components/player-catalogue.tsx`, add the metric to `SORTS` — before `By name`, so the three metric sorts sit together:

```ts
const SORTS: { key: SortKey; label: string }[] = [
  { key: "value", label: "Most valuable" },
  { key: "points", label: "Highest scoring" },
  { key: "average", label: "Best average" },
  { key: "perMillion", label: "Best value for money" },
  { key: "name", label: "By name" },
];
```

Then widen the signature and the two `useState` calls:

```tsx
export function PlayerCatalogue({
  rows,
  ownershipKnown,
  initialSort = "value",
  initialOwnership = "all",
}: {
  rows: CatalogueRow[];
  ownershipKnown: boolean;
  initialSort?: SortKey;
  initialOwnership?: CatalogueFilter["ownership"];
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<CatalogueFilter["ownership"]>(initialOwnership);
  const [sort, setSort] = useState<SortKey>(initialSort);
  const [shown, setShown] = useState(PAGE);
```

Both props are **optional with defaults**, which is what keeps every existing test of this component compiling.

- [ ] **Step 5: Wire the page**

Replace the top of `src/app/(portal)/players/page.tsx`:

```tsx
import { db } from "@/lib/db";
import { loadPlayerCatalogue } from "@/lib/db/queries";
import { buildCatalogue, parseCatalogueEntry } from "@/lib/domain/players";
import { requireSession } from "@/lib/auth/guards";
import { PlayerCatalogue } from "@/components/player-catalogue";

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireSession();
  const entry = parseCatalogueEntry(await searchParams);
  const { players, totals, values, ownership, clubs, ownershipKnown, lastSweep } =
    await loadPlayerCatalogue(db);
  const rows = buildCatalogue({ players, totals, values, ownership, clubs });
```

and pass the entry state down:

```tsx
      <PlayerCatalogue
        rows={rows}
        ownershipKnown={ownershipKnown}
        initialSort={entry.sort}
        initialOwnership={entry.ownership}
      />
```

`searchParams` is a `Promise` in this version of Next and must be awaited before its keys are read.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS, whole suite.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/domain/players.ts src/lib/domain/players.test.ts src/components/player-catalogue.tsx src/components/player-catalogue.test.tsx "src/app/(portal)/players/page.tsx"
git commit -m "feat: let a link choose the catalogue's opening view"
```

---

### Task 4: The board component and the home page

**Files:**
- Create: `src/components/opportunity-board.tsx`
- Create: `src/components/opportunity-board.test.tsx`
- Modify: `src/app/page.tsx` (replaces the whole file)

**Interfaces:**
- Consumes: `bestValueForMoney`, `freeAndScoring`, `BOARD_ROWS` (Task 2); `clubOrPosition`, `formatMoney`, `ownerDisplay`, `statusLabel` (existing); `loadPlayerCatalogue`, `buildCatalogue` (existing); `getSession` from `@/lib/auth/guards`.
- Produces: `OpportunityBoard`, a server component. Nothing later depends on it.

- [ ] **Step 1: Write the failing test**

Create `src/components/opportunity-board.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import type { CatalogueRow } from "@/lib/domain/players";
import { OpportunityBoard } from "./opportunity-board";

const row = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id,
  nickname: `Player ${id}`,
  position: "Midfielder",
  status: "ok",
  currentValue: 2_000_000,
  seasonPoints: 20,
  averagePoints: 5,
  gameweeksRecorded: 4,
  ownerTeamId: null,
  ownerName: null,
  clubName: "Celta",
  ...over,
});

type BoardProps = ComponentProps<typeof OpportunityBoard>;

const board = (rows: CatalogueRow[], over: Partial<BoardProps> = {}) =>
  renderToStaticMarkup(
    <OpportunityBoard
      title="Best value for money"
      note="Points per million of market value."
      rows={rows}
      emptyNote="No player has three recorded gameweeks yet."
      figure={() => ({ value: "7.4", unit: "pts/M€" })}
      link={{ href: "/players?sort=perMillion", label: "All players by value for money" }}
      ownershipKnown
      {...over}
    />,
  );

describe("OpportunityBoard", () => {
  it("renders a row's club, owner and figure", () => {
    const html = board([row("p1", { nickname: "Ada", clubName: "Celta", ownerTeamId: "t1", ownerName: "Manager B" })]);
    expect(html).toContain("Ada");
    expect(html).toContain("Celta");
    expect(html).toContain("Manager B");
    expect(html).toContain("7.4");
    expect(html).toContain("pts/M€");
  });

  it("shows an unavailable player's status rather than dropping them", () => {
    // Ruling 5, the owner's explicit call: nobody disappears from the board, and the
    // status is what stops that being misleading. This test is the cost being paid
    // out loud, so a later reader cannot mistake it for an oversight.
    const html = board([row("p1", { nickname: "Ada", status: "injured" })]);
    expect(html).toContain("Ada");
    expect(html).toContain("Injured");
  });

  it("renders its empty note and no list when there are no rows", () => {
    const html = board([]);
    expect(html).toContain("No player has three recorded gameweeks yet.");
    expect(html).not.toContain("<ol");
  });

  it("says ownership has not been read, instead of calling anyone free", () => {
    // Ruling 6. An absent owner row means "we have not looked" until a squad has been
    // read, and this is the easiest place in the portal to state the wrong one.
    const html = board([row("p1", { nickname: "Ada" })], {
      ownershipKnown: false,
      unknownOwnershipNote: "No squad has been read yet, so nobody can be called free.",
    });
    expect(html).toContain("No squad has been read yet, so nobody can be called free.");
    expect(html).not.toContain("Ada");
  });

  it("links where it was told to", () => {
    const html = board([row("p1")]);
    expect(html).toContain('href="/players?sort=perMillion"');
    expect(html).toContain("All players by value for money");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/opportunity-board.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the component**

Create `src/components/opportunity-board.tsx`. No `"use client"`: this component has no state, no handlers and no hooks, which is what keeps the 840-row catalogue on the server.

```tsx
import Link from "next/link";
import {
  clubOrPosition,
  ownerDisplay,
  statusLabel,
  type CatalogueRow,
} from "@/lib/domain/players";

/**
 * One home-page board: a heading, a line saying what it ranks, up to `BOARD_ROWS` rows,
 * and a link into the catalogue with the same view already applied.
 *
 * A server component on purpose. It has no search, no pills and no pagination, so the
 * rows it is handed never cross to the browser — the deliberate contrast with
 * `/players`, whose whole-catalogue-to-the-client cost is a recorded soft spot.
 *
 * The right-hand figure arrives as a function rather than a field, because the two
 * boards print different quantities there: points per million on one, season points on
 * the other. Keeping the unit outside the component is what stops one column from
 * meaning two things, which is the mistake the merged-ranking layout would have made.
 *
 * Deliberately NOT sharing a row component with the catalogue: that row is a `<Link>`
 * inside a client component with pagination, and sharing would couple a server
 * component to a client one for the sake of a `<span>`.
 */
export function OpportunityBoard({
  title,
  note,
  rows,
  emptyNote,
  figure,
  link,
  ownershipKnown,
  unknownOwnershipNote,
}: {
  title: string;
  note: string;
  rows: CatalogueRow[];
  emptyNote: string;
  figure: (row: CatalogueRow) => { value: string; unit: string };
  link: { href: string; label: string };
  ownershipKnown: boolean;
  /**
   * When present and `ownershipKnown` is false, this replaces the whole board. Only the
   * free board passes it: "nobody owns them" is a claim the database cannot support
   * until a squad has been read, while "cheapest per point" needs no ownership at all.
   */
  unknownOwnershipNote?: string;
}) {
  const blocked = unknownOwnershipNote !== undefined && !ownershipKnown;

  return (
    <section className="mt-8">
      <h2 className="text-[14px] font-medium">{title}</h2>
      <p className="mt-0.5 text-[11.5px] leading-relaxed" style={{ color: "var(--board-ink-dim)" }}>
        {blocked ? unknownOwnershipNote : note}
      </p>

      {blocked ? null : rows.length === 0 ? (
        <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: "var(--board-ink-dim)" }}>
          {emptyNote}
        </p>
      ) : (
        <ol className="mt-3">
          {rows.map((row) => {
            const { value, unit } = figure(row);
            return (
              <li key={row.id} style={{ borderColor: "var(--board-line)" }} className="border-b">
                <Link
                  href={`/players/${row.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 py-[10px]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px]">{row.nickname}</span>
                    <span
                      className="block truncate text-[11px]"
                      style={{ color: "var(--board-ink-dim)" }}
                    >
                      {clubOrPosition(row)}
                      {statusLabel(row.status) === null ? null : (
                        <span style={{ color: "var(--board-alert)" }}> · {statusLabel(row.status)}</span>
                      )}
                      {" · "}
                      <Owner row={row} ownershipKnown={ownershipKnown} />
                    </span>
                  </span>
                  <span className="text-right">
                    <span
                      className="block text-[20px] font-normal tabular-nums leading-none"
                      style={{ fontFamily: "var(--font-barlow-condensed)" }}
                    >
                      {value}
                    </span>
                    <span
                      className="block text-[11px] tabular-nums"
                      style={{ color: "var(--board-ink-dim)" }}
                    >
                      {unit}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {blocked ? null : (
        <Link
          href={link.href}
          className="mt-3 inline-block border-b pb-0.5 text-[11.5px]"
          style={{ borderColor: "var(--board-line)", color: "var(--board-ink-dim)" }}
        >
          {link.label} →
        </Link>
      )}
    </section>
  );
}

/** The same three-state owner treatment the catalogue uses; see `ownerDisplay`. */
function Owner({ row, ownershipKnown }: { row: CatalogueRow; ownershipKnown: boolean }) {
  const display = ownerDisplay(row.ownerName, ownershipKnown);
  if (display.kind === "owned") return <>{display.name}</>;
  if (display.kind === "unknown") {
    return <span style={{ color: "var(--board-ink-dim)" }}>Owners not swept yet</span>;
  }
  return <span style={{ color: "var(--board-free)" }}>Free agent</span>;
}
```

- [ ] **Step 4: Run the component test**

Run: `pnpm test src/components/opportunity-board.test.tsx`
Expected: PASS.

- [ ] **Step 5: Rewrite the home page**

Replace `src/app/page.tsx` entirely:

```tsx
import { db } from "@/lib/db";
import { loadPlayerCatalogue } from "@/lib/db/queries";
import {
  bestValueForMoney,
  buildCatalogue,
  formatMoney,
  freeAndScoring,
  pointsPerMillion,
} from "@/lib/domain/players";
import { getSession } from "@/lib/auth/guards";
import { OpportunityBoard } from "@/components/opportunity-board";

export default async function HomePage() {
  const session = await getSession();

  // `getSession`, not `requireSession`: an anonymous visitor keeps the page they have
  // today rather than being redirected to /login, which would be a behaviour change
  // nobody asked for. Same conditional pattern `AppNav` already uses.
  if (!session) {
    return (
      <section className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-semibold">TebasFury</h1>
        <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>
          Management portal for our private LaLiga Fantasy league.
        </p>
      </section>
    );
  }

  // The same read `/players` runs, and no other. Ruling 7 names the cost: 840 players
  // and their aggregates for ten rows, in exchange for one place where the ranking
  // rules live and nothing crossing to the client.
  const { players, totals, values, ownership, clubs, ownershipKnown } =
    await loadPlayerCatalogue(db);
  const rows = buildCatalogue({ players, totals, values, ownership, clubs });

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">TebasFury</h1>
      <p className="mt-2" style={{ color: "var(--board-ink-dim)" }}>
        Management portal for our private LaLiga Fantasy league.
      </p>

      <OpportunityBoard
        title="Best value for money"
        note="Points per million of market value. Players with at least three recorded gameweeks, the same floor the catalogue's “Best average” uses."
        rows={bestValueForMoney(rows)}
        emptyNote="No player has three recorded gameweeks yet. This fills in as the season goes."
        figure={(row) => ({
          // `pointsPerMillion`, never the division written out again: the rule lives in
          // one place, which is the whole reason Ruling 7 refused a SQL ranking. The
          // fallback is unreachable — a non-null result is one of the two things
          // `bestValueForMoney` filters on — and is here to satisfy the type, not to
          // paper over a case.
          value: (pointsPerMillion(row.seasonPoints, row.currentValue) ?? 0).toFixed(1),
          unit: `pts/M€ · ${row.currentValue === null ? "—" : formatMoney(row.currentValue)}`,
        })}
        link={{ href: "/players?sort=perMillion", label: `All ${rows.length} by value for money` }}
        ownershipKnown={ownershipKnown}
      />

      <OpportunityBoard
        title="Free and scoring"
        note="Nobody in the league owns them. Ranked by season points."
        rows={freeAndScoring(rows)}
        emptyNote="No unowned player has scored yet."
        figure={(row) => ({
          value: String(row.seasonPoints),
          unit: `pts · ${row.currentValue === null ? "—" : formatMoney(row.currentValue)}`,
        })}
        link={{ href: "/players?ownership=free&sort=points", label: "All free agents" }}
        ownershipKnown={ownershipKnown}
        unknownOwnershipNote="No squad has been read yet, so nobody can be called free. The next sweep settles it."
      />
    </section>
  );
}
```

The first board's `figure` calls the domain's `pointsPerMillion` rather than writing the division out again. Repeating the arithmetic in a component is the exact failure Ruling 7 rejected a SQL ranking to avoid, and it would be harder to spot here than in a query.

- [ ] **Step 6: Run the whole suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/opportunity-board.tsx src/components/opportunity-board.test.tsx src/app/page.tsx
git commit -m "feat: put the opportunity boards on the home page"
```

---

### Task 5: The visual checklist, lint, and the build

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-tebasfury-opportunity-view-design.md` — append a checklist section

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add the visual checklist**

The two views this slice touches sit behind a session and the E2E suite has no authenticated fixture, so no agent can load either in a browser: every layout claim above was reasoned about in writing and never seen. Append to the spec, continuing the global numbering from Step 3's list, which ended at 20:

```markdown
## The visual checks — not yet performed

On `/`:

21. The two boards on a 320px screen: does the right-hand figure keep its unit
    un-wrapped when a row carries a long club name, an “Out of the league” status and
    an owner all at once?
22. Are the two boards distinguishable at a glance, given they share a row shape and
    differ only in heading and unit? A reader must never think the second board is
    more of the first.
23. The signed-out page: unchanged from before this slice, with no flash of the boards
    during hydration.
24. A board rendering its empty note beside a board rendering rows — do the two read as
    one page, or does the empty one look broken?

On `/players`:

25. Thirteen pills. Step 3's check 1 asked whether twelve pushed the first player row
    below the fold; this slice adds one and does not fix the row.
26. Arriving from a home-page link: is it obvious which pill the URL selected, or does
    the page look like it opened on the wrong view?
```

- [ ] **Step 2: Run the whole suite, lint and build**

```bash
pnpm test && pnpm lint && pnpm build
```

Expected: all clean. The build is what catches a type error in a server component Vitest never renders, and it is also where `LayoutProps` stops being a `tsc` complaint.

If `pnpm build` fails collecting page data with `Invalid environment configuration`, this checkout has no `.env.local` — it is gitignored, so a worktree does not inherit it. Symlink it from the main checkout rather than inventing values.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: record the visual checks nobody has run yet"
```

---

## After the last task

The slice is code-complete but **not deployed**, and this one needs no migration — there is no schema change, which is why the deploy is shorter than Step 4's:

1. `git push origin main` — the deploy trigger, and the owner's action: the SSH key on this machine belongs to a different GitHub account.
2. No sweep is needed. The boards read data that is already there; they will be populated the moment the page loads.
3. The visual checks 21–26 added in Task 5, on a real device.

The one thing worth watching on the first real load is whether the value-for-money board is empty. That is not a bug — it means no player has three recorded gameweeks yet, which depends on what Step 3's `weekPoints` backfill reached, and it is exactly the state Task 4's `emptyNote` exists for.
