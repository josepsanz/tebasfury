# Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/targets` page that ranks every player who can be bought now (auction, manager listing, or clause) through two lenses, Investment and Performance, with tags that say why. It is fed by a daily read of the league market taken after the 19:30 auction turnover.

**Architecture:** The player sweep gains one tolerated call, `getMarket`, whose result replaces a current-state table, `market_listings`. The sweep moves from a drifting 6-hour interval to a fixed Europe/Madrid grid (01:45, 07:45, 13:45, 19:45). The watchdog then asks "should it have run by now?" instead of using a constant. All scoring is pure (`domain/targets.ts`). One query assembles its inputs, and a server page renders it with a small client control strip that writes to the query string.

**Tech Stack:** Next.js 16 (App Router, `searchParams` is a Promise), React 19, Drizzle ORM 0.45 on Neon (PGlite in tests), zod 4, vitest 5, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-03-tebasfury-targets-design.md`. Read it before any task. This plan argues from it.

## Global Constraints

- Every user-visible string is English, even though the owner writes in Catalan.
- `HOUSE_RULE_PREMIUM = 1.10`: the managers' own rule, not LaLiga's. The UI calls it "house rule".
- A manager listing's `salePrice` and `numberOfOffers` are never stored or shown.
- Tag thresholds: Rising fast `growth7 ≥ 0.18`; Falling `growth7 ≤ −0.09`; Cheap clause `clause ≤ 1.10 × value`; In form `form ≥ season average + 2`; form is the mean of the last **3** recorded gameweeks.
- Sweep grid: **01:45, 07:45, 13:45, 19:45 Europe/Madrid**. The next run is the first slot **at least 5.5 h** after `now`.
- `SWEEP_COLLAPSE_WINDOW_MS (5 h) < PLAYER_SWEEP_MIN_LEAD_MS (5.5 h) < grid spacing (6 h)` must hold.
- A failed market read never fails the sweep.
- Writes are plain sequential awaits: no transactions, no `db.batch()` (Neon HTTP and PGlite).
- The market path is `/v1/competition/1/league/{leagueId}/market`: **`league`, singular**.
- Run scripts with `node --experimental-transform-types --import ./scripts/register-alias.mjs <script>`.
- Green tests are not a typecheck: every task ends with `npx tsc --noEmit` as well as its tests.
- Before writing any Next.js page or client component, read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md) and copy the patterns of the existing pages named in each task.
- Stage explicit paths. Never `git add -A`.

## Review Focus

1. **A booking that lands soon after a retry**, e.g. a sweep that failed at 19:45 and succeeded at 20:45. The chain must book 07:45 and live. Pinned in Task 1 (property test + retry case).
2. **The watchdog during a long but healthy gap** (up to ~12.5 h across a skipped slot or the spring DST night). It must not start a second chain. Pinned in Task 1 (`overdueChains` retry case).
3. **A market response that is empty or that the API reshapes** (an unknown `discr`). The previous listings must survive and the sweep must succeed. Pinned in Task 2 (unknown `discr` dropped) and Task 3 (empty response leaves the table).
4. **Expired listings after a missed read**: an auction that closed yesterday must not be offered as a route. Pinned in Task 4 (expired routes) and Task 6 (stale header).
5. **The reader's own players and the reader with no claim**: never ranked for the owner, nobody excluded for an unclaimed reader. Pinned in Task 4 (`buildTargets` reader cases) and Task 6 (page test).

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/domain/clock.ts` (modify) | Add `leagueDate` and `leagueWallTime`: the Madrid calendar date of an instant, and a Madrid wall time as an instant. |
| `src/lib/sync/next-run.ts` (modify) | Grid-based `nextPlayerSweep`; watchdog reads the grid. |
| `src/lib/fantasy-client/schemas.ts` (modify) | `marketSchema`. |
| `src/lib/fantasy-client/index.ts` (modify) | `getMarket`, `MarketListingRow`, `FantasyClient.getMarket`. |
| `scripts/capture-market-fixture.mts` (create) | Captures `__fixtures__/market.json`. |
| `src/lib/db/schema.ts` (modify) + `drizzle/0017_market_listings.sql` | `market_listings` table. |
| `src/lib/sync/market.ts` (create) | `captureMarket`: read, filter, replace. Never throws. |
| `src/lib/sync/players.ts` (modify) | Calls `captureMarket`, reports it. |
| `src/lib/domain/targets.ts` (create) | Cost, routes, scores, tags, ranking, view parsing. Pure. |
| `src/lib/db/queries.ts` (modify) | `loadTargets`. |
| `src/components/target-controls.tsx` (create) | Client selects that write `?lens&route&position&injured`. |
| `src/components/target-list.tsx` (create) | The ranked rows and the locked group. |
| `src/app/(portal)/targets/page.tsx` (create) | The page. |
| `src/components/nav-links.tsx` (modify) | "Targets" tab. |
| `src/lib/db/seed-league.ts` (modify) | Rival-owned, locked and auction players for the page test. |
| `docs/deployment.md`, `README.md` (modify) | Migration order and the new page. |

---

### Task 1: The sweep runs on a Madrid grid, and the watchdog follows it

**Files:**
- Modify: `src/lib/domain/clock.ts`
- Modify: `src/lib/sync/next-run.ts:40-110` and `:150-222`
- Test: `src/lib/domain/clock.test.ts` (create if absent; otherwise append), `src/lib/sync/next-run.test.ts`

**Interfaces:**
- Produces: `leagueDate(at: Date): { year: number; month: number; day: number }`; `leagueWallTime(year: number, month: number, day: number, hour: number, minute: number): Date` (both exported from `domain/clock.ts`); `PLAYER_SWEEP_SLOTS: readonly { hour: number; minute: number }[]`; `PLAYER_SWEEP_MIN_LEAD_MS: number`; `PLAYER_SWEEP_SPACING_MS: number`; `SWEEP_GRACE_MS: number`; `nextPlayerSweep(now: Date): Date` (same signature as today); `overdueChains` (same signature as today).
- Removes: `PLAYER_SWEEP_INTERVAL_MS`, `SWEEP_OVERDUE_MS`. Their only importers are `next-run.ts` and `next-run.test.ts`; confirm with `grep -rn "PLAYER_SWEEP_INTERVAL_MS\|SWEEP_OVERDUE_MS" src`.

- [ ] **Step 1: Write the failing clock tests**

Check whether `src/lib/domain/clock.test.ts` exists (`ls src/lib/domain/clock.test.ts`). If it does, append the `describe` blocks below and merge the imports. If not, create it:

```ts
import { describe, expect, it } from "vitest";
import { leagueDate, leagueWallTime } from "./clock";

describe("leagueDate", () => {
  it("is the calendar day in Spain, not in UTC", () => {
    // 23:30 UTC on 3 October is already 01:30 on the 4th in Madrid (CEST, +2).
    expect(leagueDate(new Date("2026-10-03T23:30:00Z"))).toEqual({ year: 2026, month: 10, day: 4 });
  });
});

describe("leagueWallTime", () => {
  it("reads a summer wall time at +2", () => {
    expect(leagueWallTime(2026, 10, 3, 19, 45).toISOString()).toBe("2026-10-03T17:45:00.000Z");
  });

  it("reads a winter wall time at +1", () => {
    expect(leagueWallTime(2026, 12, 1, 19, 45).toISOString()).toBe("2026-12-01T18:45:00.000Z");
  });

  it("is right on both sides of the autumn change (25 Oct 2026, 03:00 CEST -> 02:00 CET)", () => {
    expect(leagueWallTime(2026, 10, 25, 1, 45).toISOString()).toBe("2026-10-24T23:45:00.000Z");
    expect(leagueWallTime(2026, 10, 25, 7, 45).toISOString()).toBe("2026-10-25T06:45:00.000Z");
  });

  it("is right on both sides of the spring change (28 Mar 2027, 02:00 CET -> 03:00 CEST)", () => {
    expect(leagueWallTime(2027, 3, 28, 1, 45).toISOString()).toBe("2027-03-28T00:45:00.000Z");
    expect(leagueWallTime(2027, 3, 28, 7, 45).toISOString()).toBe("2027-03-28T05:45:00.000Z");
  });

  it("rolls an overflowing day into the next month", () => {
    expect(leagueWallTime(2026, 10, 32, 1, 45).toISOString()).toBe("2026-10-31T23:45:00.000Z");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/lib/domain/clock.test.ts`
Expected: FAIL, `leagueDate` / `leagueWallTime` are not exported.

- [ ] **Step 3: Implement them in `src/lib/domain/clock.ts`**

Add below `leagueDay` (keep `LEAGUE_ZONE` as the single zone constant):

```ts
const numericParts = (at: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: LEAGUE_ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;

/** How far the league's clock runs ahead of UTC at one instant, in milliseconds. */
function zoneOffsetMs(at: Date): number {
  const p = numericParts(at);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The calendar day an instant falls on in Spain. Months are 1-based. */
export function leagueDate(at: Date): { year: number; month: number; day: number } {
  const p = numericParts(at);
  return { year: p.year, month: p.month, day: p.day };
}

/**
 * The instant a Spanish wall-clock time names.
 *
 * Two passes, because the offset depends on the instant being looked for: the first
 * guesses with the offset at the naive UTC reading, the second corrects it in case a
 * daylight-saving change sits between the two. The sweep grid's slots (HH:45) never
 * fall inside the skipped or the repeated hour, so the answer is always unique.
 *
 * A day past the month's end rolls over, as `Date.UTC` does, so a caller can ask for
 * "tomorrow" as `day + 1`.
 */
export function leagueWallTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = naive - zoneOffsetMs(new Date(naive));
  instant = naive - zoneOffsetMs(new Date(instant));
  return new Date(instant);
}
```

- [ ] **Step 4: Run the clock tests**

Run: `pnpm vitest run src/lib/domain/clock.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the sweep-cadence tests in `next-run.test.ts`**

In the import list, remove `PLAYER_SWEEP_INTERVAL_MS` and `SWEEP_OVERDUE_MS` and add `PLAYER_SWEEP_MIN_LEAD_MS`, `PLAYER_SWEEP_SLOTS`, `PLAYER_SWEEP_SPACING_MS`, `SWEEP_GRACE_MS`. Add `import { leagueWallTime } from "@/lib/domain/clock";`.

Replace the whole `describe("the player sweep cadence", ...)` block with:

```ts
describe("the player sweep cadence", () => {
  const at = (iso: string) => nextPlayerSweep(new Date(iso)).toISOString();

  it("books the first slot of the Madrid grid at least five and a half hours out", () => {
    // 06:00 CEST: 07:45 is too close, so 13:45 CEST.
    expect(at("2026-09-07T04:00:00Z")).toBe("2026-09-07T11:45:00.000Z");
    // 13:45 CEST books 19:45 CEST, which is the read the market needs.
    expect(at("2026-10-03T11:45:00Z")).toBe("2026-10-03T17:45:00.000Z");
    // 19:45 CEST books 01:45 CEST the next day.
    expect(at("2026-10-03T17:45:00Z")).toBe("2026-10-03T23:45:00.000Z");
  });

  it("tolerates a late delivery without skipping the slot", () => {
    // QStash five minutes late: 01:45 is still 5 h 55 min away.
    expect(at("2026-10-03T17:50:00Z")).toBe("2026-10-03T23:45:00.000Z");
  });

  it("skips a slot a retry has come too close to, rather than landing inside the window", () => {
    // Failed at 19:45, succeeded on the hourly retry at 20:45 CEST. 01:45 is only five
    // hours away and would sit inside the collapse window, so it books 07:45 instead.
    expect(at("2026-10-03T18:45:00Z")).toBe("2026-10-04T05:45:00.000Z");
  });

  it("follows the clocks back in autumn", () => {
    // 01:45 CEST on 25 Oct; at 03:00 CEST the clocks go back to 02:00 CET.
    expect(at("2026-10-24T23:45:00Z")).toBe("2026-10-25T06:45:00.000Z");
  });

  it("skips one slot on the spring night rather than book a five-hour gap", () => {
    // 01:45 CET on 28 Mar 2027; 07:45 CEST is only five real hours later.
    expect(at("2027-03-28T00:45:00Z")).toBe("2027-03-28T11:45:00.000Z");
  });

  it("comes back sooner after a failure, but not fast enough to hammer", () => {
    expect(nextPlayerSweepAfterFailure(new Date("2026-09-07T04:00:00Z")).toISOString()).toBe(
      "2026-09-07T05:00:00.000Z",
    );
  });

  it("never books its own successor inside the collapse window, across both clock changes", () => {
    // The property the whole design rests on. A run's success row is written up to five
    // minutes after the `now` the booking was computed from, so that is the worst case.
    const ranges: [string, string][] = [
      ["2026-10-20T00:00:00Z", "2026-10-29T00:00:00Z"],
      ["2027-03-24T00:00:00Z", "2027-04-02T00:00:00Z"],
    ];
    const slots = new Set(PLAYER_SWEEP_SLOTS.map((s) => s.hour * 60 + s.minute));
    for (const [from, to] of ranges) {
      for (let t = Date.parse(from); t < Date.parse(to); t += 13 * 60 * 1000) {
        const now = new Date(t);
        const next = nextPlayerSweep(now);
        const lead = next.getTime() - t;
        expect(lead).toBeGreaterThanOrEqual(PLAYER_SWEEP_MIN_LEAD_MS);
        expect(lead).toBeLessThanOrEqual(PLAYER_SWEEP_MIN_LEAD_MS + PLAYER_SWEEP_SPACING_MS + 60 * 60 * 1000);
        const finishedAt = new Date(t + 5 * 60 * 1000);
        expect(isRedundantSweep(finishedAt, next)).toBe(false);
        const wall = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Madrid",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(next);
        const [h, m] = wall.split(":").map(Number);
        expect(slots.has(h * 60 + m)).toBe(true);
      }
    }
  });

  it("keeps the window, the minimum lead and the grid spacing in that order", () => {
    // Moving one without the others is how the chain dies with no error anywhere.
    expect(SWEEP_COLLAPSE_WINDOW_MS).toBeLessThan(PLAYER_SWEEP_MIN_LEAD_MS);
    expect(PLAYER_SWEEP_MIN_LEAD_MS).toBeLessThan(PLAYER_SWEEP_SPACING_MS);
    expect(leagueWallTime(2026, 10, 3, 19, 45).getTime() - leagueWallTime(2026, 10, 3, 13, 45).getTime()).toBe(
      PLAYER_SWEEP_SPACING_MS,
    );
  });
});
```

In the `overdueChains` describe block, replace the test `"calls the sweep dead an hour past its six"` with:

```ts
  it("calls the sweep dead an hour past the slot it booked", () => {
    const last = new Date("2026-10-03T17:45:00Z"); // 19:45 CEST, booked 01:45 CEST
    const check = (iso: string) =>
      overdueChains({ ...healthy, sweepLastRunAt: last, now: new Date(iso) }).players;
    expect(check("2026-10-04T00:44:00Z")).toBe(false);
    expect(check("2026-10-04T00:45:00Z")).toBe(true);
  });

  it("does not call a healthy long gap dead", () => {
    // A retry at 20:45 CEST books 07:45, eleven hours on. A constant 7-hour threshold
    // would have revived it at 03:45 and started a second chain beside a healthy one.
    const last = new Date("2026-10-03T18:45:00Z");
    expect(
      overdueChains({ ...healthy, sweepLastRunAt: last, now: new Date("2026-10-04T03:00:00Z") }).players,
    ).toBe(false);
  });
```

Read the `healthy` fixture and the other `overdueChains` tests first. If `healthy.now` is not the field name the function takes, adapt the spread to match. Keep every other assertion in that block. In `"keeps every threshold clear of the cadence it is watching"`, delete the line `expect(SWEEP_OVERDUE_MS).toBeGreaterThan(PLAYER_SWEEP_INTERVAL_MS);` and add `expect(SWEEP_GRACE_MS).toBeGreaterThan(0);`.

- [ ] **Step 6: Run them and watch them fail**

Run: `pnpm vitest run src/lib/sync/next-run.test.ts`
Expected: FAIL on the new constants' imports and the grid expectations.

- [ ] **Step 7: Implement the grid in `next-run.ts`**

Replace `PLAYER_SWEEP_INTERVAL_MS` and the body and doc comment of `nextPlayerSweep` with:

```ts
import { leagueDate, leagueWallTime } from "@/lib/domain/clock";

/**
 * When the sweep runs: four fixed slots a day, in Spain's time.
 *
 * It was a flat six hours until 2026-10-03, and a flat interval drifts: its hour depends on
 * when the chain first fired, so it never reliably read the market just after the daily
 * auction turns over. The owner's requirement is a read no earlier than 19:30 Madrid time;
 * 19:45 keeps a quarter of an hour of margin, and the other three slots keep the same four
 * sweeps a day the flat interval made.
 */
export const PLAYER_SWEEP_SLOTS = [
  { hour: 1, minute: 45 },
  { hour: 7, minute: 45 },
  { hour: 13, minute: 45 },
  { hour: 19, minute: 45 },
] as const;

/** The distance between two slots on an ordinary day. */
export const PLAYER_SWEEP_SPACING_MS = 6 * 60 * 60 * 1000;

/**
 * The closest a booking may land to the run that makes it.
 *
 * **This is what keeps the grid from killing the chain.** `isRedundantSweep` stands down any
 * firing within `SWEEP_COLLAPSE_WINDOW_MS` of the last success. A grid slot can be minutes
 * away (a retry that succeeds just before one), and booking it would end the only chain
 * there is. So a slot nearer than this is skipped for the next. It must stay above the
 * window and below the spacing; a test pins both.
 */
export const PLAYER_SWEEP_MIN_LEAD_MS = 5.5 * 60 * 60 * 1000;

/** The first grid slot at least `PLAYER_SWEEP_MIN_LEAD_MS` after `now`. */
export function nextPlayerSweep(now: Date): Date {
  const earliest = now.getTime() + PLAYER_SWEEP_MIN_LEAD_MS;
  const { year, month, day } = leagueDate(new Date(earliest));
  for (let offset = 0; offset <= 1; offset += 1) {
    for (const slot of PLAYER_SWEEP_SLOTS) {
      const at = leagueWallTime(year, month, day + offset, slot.hour, slot.minute);
      if (at.getTime() >= earliest) return at;
    }
  }
  // Unreachable: the last slot of the next day is always more than 5.5 h after `now`.
  throw new Error("No player sweep slot found");
}
```

Update the doc comment of `SWEEP_COLLAPSE_WINDOW_MS` so that it states the relationship to `PLAYER_SWEEP_MIN_LEAD_MS` instead of to the old interval: "must stay under `PLAYER_SWEEP_MIN_LEAD_MS`, the closest a booking ever lands to the run that made it". The constant's value stays at 5 h.

Replace `SWEEP_OVERDUE_MS` and its comment with:

```ts
/**
 * How late past its booked slot the sweep may be before it is presumed dead.
 *
 * Not a constant gap since the last run: on the grid a healthy gap runs from 5.5 h to about
 * 12.5 h (a skipped slot, the spring night), so any single threshold either calls a healthy
 * chain dead or waits half a day to notice a dead one. The question is asked of the slot
 * the last run would have booked, plus an hour of delivery drift.
 */
export const SWEEP_GRACE_MS = 60 * 60 * 1000;
```

In `overdueChains`, change `players: overdue(sweepLastRunAt, SWEEP_OVERDUE_MS)` to:

```ts
    players:
      sweepLastRunAt === null
        ? true
        : sweepLastRunAt.getTime() > now.getTime()
          ? false
          : now.getTime() >= nextPlayerSweep(sweepLastRunAt).getTime() + SWEEP_GRACE_MS,
```

- [ ] **Step 8: Run the tests and the typecheck**

Run: `pnpm vitest run src/lib/sync/next-run.test.ts src/lib/domain/clock.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors. If `tsc` reports another importer of a removed constant, update it to the new names.

- [ ] **Step 9: Break it on purpose**

Temporarily set `PLAYER_SWEEP_MIN_LEAD_MS` to `4 * 60 * 60 * 1000` and rerun `next-run.test.ts`. The property test and the ordering test must fail. Restore the value.

- [ ] **Step 10: Commit**

```bash
git add src/lib/domain/clock.ts src/lib/domain/clock.test.ts src/lib/sync/next-run.ts src/lib/sync/next-run.test.ts
git commit -m "feat: the player sweep runs on a fixed Madrid grid, and the watchdog follows it"
```

---

### Task 2: The client reads the market

**Files:**
- Create: `scripts/capture-market-fixture.mts`, `src/lib/fantasy-client/__fixtures__/market.json` (generated)
- Modify: `src/lib/fantasy-client/schemas.ts`, `src/lib/fantasy-client/index.ts`, `scripts/capture-activity-fixture.mts` + the other `scripts/capture-*.mts` doc comments
- Modify: `src/lib/sync/index.test.ts` (`unusedPlayerCalls`)
- Test: `src/lib/fantasy-client/index.test.ts`

**Interfaces:**
- Produces: `type MarketListingRow = { playerId: string; kind: "league" | "team"; sellerTeamId: string | null; expiresAt: Date; bids: number | null }`; `getMarket(accessToken: string, leagueId: string): Promise<MarketListingRow[]>`; `FantasyClient.getMarket(): Promise<MarketListingRow[]>`.

- [ ] **Step 1: Write the capture script**

`scripts/capture-market-fixture.mts`:

```ts
/**
 * Captures the league market this slice is built on, straight from the live API.
 *
 * Run it with the alias hook and type transforms (`errors.ts` uses parameter properties,
 * which Node's default strip-only mode rejects):
 *
 *   node --experimental-transform-types --import ./scripts/register-alias.mjs scripts/capture-market-fixture.mts
 *
 * It needs a `.env.local` whose DATABASE_URL points at a database holding a bootstrapped
 * LaLiga credential, and the matching CREDENTIALS_KEY. It goes through `getAccessToken`,
 * which persists the rotated refresh token.
 *
 * TRIMMED to the first entry of each `discr`: the shape varies by kind, not by volume.
 * Note the path: `league`, singular, unlike every other league route.
 */
import { writeFileSync } from "node:fs";

process.loadEnvFile(".env.local");

const { db } = await import("@/lib/db");
const { getAccessToken } = await import("@/lib/fantasy-client");

const BASE = "https://fantasy-api.llt-services.com/api";
const LEAGUE = process.env.LALIGA_LEAGUE_ID?.replace(/^"|"$/g, "");
if (!LEAGUE) throw new Error("LALIGA_LEAGUE_ID must be set in .env.local");

const token = await getAccessToken(db);
const res = await fetch(`${BASE}/v1/competition/1/league/${LEAGUE}/market`, {
  headers: { authorization: `Bearer ${token}`, accept: "application/json" },
});
const text = await res.text();
if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);

const entries = JSON.parse(text) as Record<string, unknown>[];
const seen = new Set<unknown>();
const trimmed = entries.filter((entry) => {
  if (seen.has(entry.discr)) return false;
  seen.add(entry.discr);
  return true;
});
writeFileSync("src/lib/fantasy-client/__fixtures__/market.json", `${JSON.stringify(trimmed, null, 2)}\n`);
console.log(`wrote ${trimmed.length} entries of ${entries.length}, one per discr:`, [...seen]);
process.exit(0);
```

In every other `scripts/capture-*.mts`, change the documented run command to include `--experimental-transform-types`.

- [ ] **Step 2: Capture the fixture**

Run: `node --experimental-transform-types --import ./scripts/register-alias.mjs scripts/capture-market-fixture.mts`
Expected: `wrote 2 entries of N, one per discr: [ 'marketPlayerLeague', 'marketPlayerTeam' ]` (in either order). Open the file and confirm that one entry has `numberOfBids` and the other has `sellerTeam.id`. If the credential is refused, stop and report: do not bootstrap a credential yourself.

- [ ] **Step 3: Write the failing client tests**

Append to `src/lib/fantasy-client/index.test.ts`, with `getMarket` added to the import from `./index` and `import marketFixture from "./__fixtures__/market.json";`:

```ts
describe("getMarket", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answering = (body: unknown) => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("asks the singular league path", async () => {
    const fetchMock = answering(marketFixture);
    await getMarket("token", "8012894");
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/competition/1/league/8012894/market");
  });

  it("maps one entry of each kind from the captured response", async () => {
    answering(marketFixture);
    const rows = await getMarket("token", "8012894");
    const league = rows.find((r) => r.kind === "league");
    const team = rows.find((r) => r.kind === "team");
    expect(league).toMatchObject({ sellerTeamId: null });
    expect(typeof league?.bids).toBe("number");
    expect(league?.expiresAt).toBeInstanceOf(Date);
    expect(Number.isNaN(league?.expiresAt.getTime())).toBe(false);
    expect(team).toMatchObject({ bids: null });
    expect(typeof team?.sellerTeamId).toBe("string");
    expect(typeof team?.playerId).toBe("string");
  });

  it("drops a kind it does not know rather than failing the read", async () => {
    answering([
      { discr: "marketPlayerLeague", playerMaster: { id: "1" }, expirationDate: "2026-10-04T19:00:00+02:00", numberOfBids: 0 },
      { discr: "somethingNew", playerMaster: { id: "2" }, expirationDate: "2026-10-04T19:00:00+02:00" },
    ]);
    const rows = await getMarket("token", "x");
    expect(rows).toEqual([
      { playerId: "1", kind: "league", sellerTeamId: null, expiresAt: new Date("2026-10-04T17:00:00Z"), bids: 0 },
    ]);
  });

  it("drops a team listing that names no seller", async () => {
    answering([
      { discr: "marketPlayerTeam", playerMaster: { id: "3" }, expirationDate: "2026-10-04T19:00:00+02:00" },
    ]);
    expect(await getMarket("token", "x")).toEqual([]);
  });
});
```

If `afterEach` or `vi` is not already imported at the top of the file, add it.

- [ ] **Step 4: Run them and watch them fail**

Run: `pnpm vitest run src/lib/fantasy-client/index.test.ts -t getMarket`
Expected: FAIL, `getMarket` is not exported.

- [ ] **Step 5: Add the schema**

In `src/lib/fantasy-client/schemas.ts`, after `activitySchema`:

```ts
/**
 * One entry on the league market, either kind.
 *
 * Deliberately NOT a discriminated union: a third `discr` the API invents later would fail
 * the whole parse, and the market read is tolerated, so the cost would be a silently stale
 * market rather than an error. `getMarket` maps the two known kinds and drops the rest.
 *
 * `salePrice` and `numberOfOffers` are left out on purpose. A manager's asking price is the
 * game's default and the single offer is the league's automatic one (owner, 2026-10-03), so
 * neither says anything. `expirationDate` stays a string; its offset is parsed in the mapping.
 */
export const marketEntrySchema = z.object({
  discr: z.string(),
  playerMaster: z.object({ id: z.coerce.string() }),
  expirationDate: z.string(),
  numberOfBids: z.coerce.number().optional(),
  sellerTeam: z.object({ id: z.coerce.string() }).nullable().optional(),
});

export const marketSchema = z.array(marketEntrySchema);
```

- [ ] **Step 6: Add `getMarket` and wire it into the client**

In `src/lib/fantasy-client/index.ts`, import `marketSchema` from `./schemas`, then add before `FantasyClient`:

```ts
/**
 * One player on the league market right now.
 *
 * `league` is a free agent in the daily auction; `team` is a player a manager has listed.
 * `bids` is the auction's own count and exists only for `league`; a listing's offer count
 * is the league's automatic offer and is not carried.
 */
export type MarketListingRow = {
  playerId: string;
  kind: "league" | "team";
  sellerTeamId: string | null;
  expiresAt: Date;
  bids: number | null;
};

/** Today's market. Note `league`, singular, measured 2026-10-03. */
export async function getMarket(accessToken: string, leagueId: string): Promise<MarketListingRow[]> {
  const entries = await apiGet(
    accessToken,
    `/v1/competition/${COMPETITION}/league/${leagueId}/market`,
    marketSchema,
  );
  const rows: MarketListingRow[] = [];
  for (const entry of entries) {
    const expiresAt = new Date(entry.expirationDate);
    if (entry.discr === "marketPlayerLeague") {
      rows.push({ playerId: entry.playerMaster.id, kind: "league", sellerTeamId: null, expiresAt, bids: entry.numberOfBids ?? null });
    } else if (entry.discr === "marketPlayerTeam" && entry.sellerTeam?.id) {
      rows.push({ playerId: entry.playerMaster.id, kind: "team", sellerTeamId: entry.sellerTeam.id, expiresAt, bids: null });
    }
  }
  return rows;
}
```

Add `getMarket(): Promise<MarketListingRow[]>;` to `FantasyClient`, and `getMarket: () => getMarket(accessToken, leagueId),` to the object `createClient` returns.

- [ ] **Step 7: Keep the other fakes compiling**

In `src/lib/sync/index.test.ts`, add `getMarket: async () => [],` to `unusedPlayerCalls`, next to `getActivity`.

- [ ] **Step 8: Run the tests and the typecheck**

Run: `pnpm vitest run src/lib/fantasy-client src/lib/sync/index.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 9: Commit**

```bash
git add scripts/capture-market-fixture.mts scripts/capture-*.mts src/lib/fantasy-client/__fixtures__/market.json src/lib/fantasy-client/schemas.ts src/lib/fantasy-client/index.ts src/lib/fantasy-client/index.test.ts src/lib/sync/index.test.ts
git commit -m "feat: the client reads the league market"
```

---

### Task 3: The sweep stores the market, and a failed read costs nothing

**Files:**
- Modify: `src/lib/db/schema.ts` (after `squadMembers`)
- Create: `drizzle/0017_market_listings.sql` (+ the `drizzle/meta` files drizzle-kit writes)
- Create: `src/lib/sync/market.ts`, `src/lib/sync/market.test.ts`
- Modify: `src/lib/sync/players.ts`, `src/lib/sync/players.test.ts`, `src/app/api/sync/players/route.ts`

**Interfaces:**
- Consumes: `MarketListingRow`, `FantasyClient.getMarket` (Task 2).
- Produces: table `marketListings` (columns `playerId`, `kind`, `sellerTeamId`, `expiresAt`, `bids`, `readAt`); `captureMarket(db, client: Pick<FantasyClient, "getMarket">, { now }: { now: Date }): Promise<{ captured: number; dropped: number; failed: boolean }>`; `PlayerSweepResult.marketCaptured: number` and `.marketFailed: boolean`.

- [ ] **Step 1: Add the table to the schema**

In `src/lib/db/schema.ts`, after `squadMembers`:

```ts
/**
 * Who is on the league market right now: the daily auction's free agents and the players
 * managers have listed.
 *
 * Current state, REPLACED on every successful read, like `squad_members`. Not a log: market
 * history is out of scope. One row per player, because a player is on the market once.
 *
 * `read_at` is the same on every row, and is what the page reports as "Market read at". A
 * manager listing's asking price and offer count are deliberately absent; see `getMarket`.
 */
export const marketListings = pgTable(
  "market_listings",
  {
    playerId: text("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The listing manager's team, as the market names it. No FK: informational only. */
    sellerTeamId: text("seller_team_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** The auction's bid count. Null for a manager's listing. */
    bids: integer("bids"),
    readAt: timestamp("read_at", { withTimezone: true }).notNull(),
  },
  (table) => [check("market_listings_kind_check", sql`${table.kind} in ('league', 'team')`)],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm drizzle-kit generate --name market_listings`
Expected: `drizzle/0017_market_listings.sql` containing one `CREATE TABLE "market_listings"` with the check constraint and the foreign key, plus updated `drizzle/meta/_journal.json` and `drizzle/meta/0017_snapshot.json`. Read the SQL. It must not touch any other table. **Do not run `drizzle-kit migrate`.** Production is migrated by the owner (Task 7 documents it). Tests apply the folder through PGlite.

- [ ] **Step 3: Write the failing `captureMarket` tests**

`src/lib/sync/market.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { marketListings, players } from "@/lib/db/schema";
import type { MarketListingRow } from "@/lib/fantasy-client";
import { captureMarket } from "./market";

const now = new Date("2026-10-03T17:45:00Z");
const closes = new Date("2026-10-04T17:00:00Z");

const listing = (playerId: string, over: Partial<MarketListingRow> = {}): MarketListingRow => ({
  playerId,
  kind: "league",
  sellerTeamId: null,
  expiresAt: closes,
  bids: 0,
  ...over,
});

const client = (rows: MarketListingRow[] | Error) => ({
  getMarket: async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  },
});

describe("captureMarket", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(players).values(
      ["a", "b", "c"].map((id) => ({ id, nickname: id, position: "Midfielder", realTeamId: "rt1", status: "ok" })),
    );
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.db.delete(marketListings);
  });

  it("replaces the whole market with what the read returned", async () => {
    await captureMarket(h.db, client([listing("a"), listing("b")]), { now });
    const result = await captureMarket(
      h.db,
      client([listing("c", { kind: "team", sellerTeamId: "t9", bids: null })]),
      { now },
    );
    expect(result).toEqual({ captured: 1, dropped: 0, failed: false });
    const rows = await h.db.select().from(marketListings);
    expect(rows).toEqual([
      { playerId: "c", kind: "team", sellerTeamId: "t9", expiresAt: closes, bids: null, readAt: now },
    ]);
  });

  it("drops a player the catalogue has never seen instead of failing on the foreign key", async () => {
    const result = await captureMarket(h.db, client([listing("a"), listing("zzz")]), { now });
    expect(result).toEqual({ captured: 1, dropped: 1, failed: false });
  });

  it("keeps the previous market when the read fails", async () => {
    await captureMarket(h.db, client([listing("a")]), { now });
    const result = await captureMarket(h.db, client(new Error("503")), { now });
    expect(result).toEqual({ captured: 0, dropped: 0, failed: true });
    expect(await h.db.select().from(marketListings)).toHaveLength(1);
  });

  it("keeps the previous market when the read comes back empty", async () => {
    // The daily auction always holds players, so an empty market reads as a hiccup.
    await captureMarket(h.db, client([listing("a")]), { now });
    const result = await captureMarket(h.db, client([]), { now });
    expect(result).toEqual({ captured: 0, dropped: 0, failed: true });
    expect(await h.db.select().from(marketListings)).toHaveLength(1);
  });

  it("keeps one row per player if the API names one twice", async () => {
    const result = await captureMarket(h.db, client([listing("a"), listing("a", { bids: 3 })]), { now });
    expect(result.captured).toBe(1);
  });
});
```

- [ ] **Step 4: Run them and watch them fail**

Run: `pnpm vitest run src/lib/sync/market.test.ts`
Expected: FAIL, `./market` does not exist.

- [ ] **Step 5: Implement `captureMarket`**

`src/lib/sync/market.ts`:

```ts
import { inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { marketListings, players } from "@/lib/db/schema";
import type { FantasyClient, MarketListingRow } from "@/lib/fantasy-client";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type MarketClient = Pick<FantasyClient, "getMarket">;

export type MarketCapture = { captured: number; dropped: number; failed: boolean };

/**
 * Reads the league market and replaces `market_listings` with it.
 *
 * Never throws, the same ruling `captureLineups` gets and for the same reason: a missed read
 * costs one page a few hours of freshness, and the page says how old its market is. The
 * market log is the opposite ruling (see `runPlayerSweep`) because its window rolls on.
 *
 * An EMPTY read is treated as a failure and the previous market is kept. The daily auction
 * always holds players, so nothing on the market is far likelier a hiccup than a fact, and
 * believing it would blank the page until the next sweep.
 *
 * Delete-then-insert with no transaction (Neon HTTP has none): a failure between the two
 * leaves an empty market until the next sweep, which the page reports as never read.
 */
export async function captureMarket(db: Db, client: MarketClient, { now }: { now: Date }): Promise<MarketCapture> {
  let listings: MarketListingRow[];
  try {
    listings = await client.getMarket();
  } catch {
    return { captured: 0, dropped: 0, failed: true };
  }
  if (listings.length === 0) return { captured: 0, dropped: 0, failed: true };

  try {
    const byPlayer = new Map<string, MarketListingRow>();
    for (const row of listings) if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, row);

    const known = new Set(
      (
        await db
          .select({ id: players.id })
          .from(players)
          .where(inArray(players.id, [...byPlayer.keys()]))
      ).map((row) => row.id),
    );
    const rows = [...byPlayer.values()].filter((row) => known.has(row.playerId));

    await db.delete(marketListings);
    if (rows.length > 0) {
      await db.insert(marketListings).values(rows.map((row) => ({ ...row, readAt: now })));
    }
    return { captured: rows.length, dropped: listings.length - rows.length, failed: false };
  } catch {
    return { captured: 0, dropped: 0, failed: true };
  }
}
```

Note that `dropped` counts duplicates as well as unknown players. That is deliberate: both are rows the read held that were not stored.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/lib/sync/market.test.ts`
Expected: PASS.

- [ ] **Step 7: Wire it into the sweep, test first**

In `src/lib/sync/players.test.ts`:
- Add `marketListings` to the schema import and `await h.db.delete(marketListings);` at the top of `beforeEach` (before `players` is deleted).
- Add `getMarket` to `fakeClient`, with a new optional parameter `market: MarketListingRow[] = [{ playerId: "p0", kind: "league", sellerTeamId: null, expiresAt: new Date("2026-09-08T17:00:00Z"), bids: 0 }]`, returning `async () => market`. Import `MarketListingRow`.
- Add `getMarket: async () => []` to the hand-built `broken` client near line 513, and to any other literal `PlayerClient` that `tsc` flags.
- Add the tests:

```ts
  it("stores the market alongside the catalogue", async () => {
    const client = fakeClient(catalogue(MINIMUM_CATALOGUE));
    const result = await runPlayerSweep({ db: h.db, client, now, runId: "s1", trigger: "players-schedule" });
    expect(result).toMatchObject({ marketCaptured: 1, marketFailed: false });
    expect(await h.db.select().from(marketListings)).toHaveLength(1);
  });

  it("succeeds when the market read fails, and says so", async () => {
    const client: PlayerClient = {
      ...fakeClient(catalogue(MINIMUM_CATALOGUE)),
      getMarket: async () => {
        throw new Error("market is down");
      },
    };
    const result = await runPlayerSweep({ db: h.db, client, now, runId: "s1", trigger: "players-schedule" });
    expect(result).toMatchObject({ marketCaptured: 0, marketFailed: true });
    const [run] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "s1"));
    expect(run.status).toBe("succeeded");
  });
```

Run: `pnpm vitest run src/lib/sync/players.test.ts`
Expected: FAIL. `marketCaptured` is missing, and `PlayerClient` has no `getMarket`.

- [ ] **Step 8: Implement the wiring**

In `src/lib/sync/players.ts`:
- `import { captureMarket } from "./market";`
- Extend `PlayerClient` to `Pick<FantasyClient, "getPlayers" | "getSquad" | "getActivity" | "getLineup" | "getMarket">`.
- Add to `PlayerSweepResult`:

```ts
  /** Market listings stored this sweep — see `captureMarket`. Zero when the read failed. */
  marketCaptured: number;
  /** The market read failed or came back empty, and the previous market was kept. */
  marketFailed: boolean;
```

- After `const lineups = await captureLineups(...)`:

```ts
    // Tolerated like the lineups: a missed market read costs the targets page some
    // freshness, which it reports. After the catalogue, so its players exist for the FK.
    const market = await captureMarket(db, client, { now });
```

- Return `marketCaptured: market.captured, marketFailed: market.failed,` in the result object.

In `src/app/api/sync/players/route.ts`, add `marketCaptured: outcome.result.marketCaptured, marketFailed: outcome.result.marketFailed,` to the JSON response, next to `lineupsCaptured`. Check `src/app/api/sync/wake/route.ts` and `src/app/admin/sync/actions.ts` for code that spreads or lists `PlayerSweepResult` fields, and add the two there in the same way if they list them.

- [ ] **Step 9: Run the tests and the typecheck**

Run: `pnpm vitest run src/lib/sync && npx tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 10: Break it on purpose**

In `captureMarket`, temporarily remove the `listings.length === 0` guard and rerun `market.test.ts`. The "comes back empty" test must fail. Restore the guard.

- [ ] **Step 11: Commit**

```bash
git add src/lib/db/schema.ts drizzle/0017_market_listings.sql drizzle/meta/_journal.json drizzle/meta/0017_snapshot.json src/lib/sync/market.ts src/lib/sync/market.test.ts src/lib/sync/players.ts src/lib/sync/players.test.ts src/app/api/sync/players/route.ts
git commit -m "feat: the player sweep keeps the league market, and survives a failed read"
```

Add any other file Step 8 touched to that `git add`.

---

### Task 4: Scoring, tags and ranking

**Files:**
- Create: `src/lib/domain/targets.ts`, `src/lib/domain/targets.test.ts`

**Interfaces:**
- Consumes: `clauseStatus`, `ClauseStatus` from `@/lib/domain/market`; `statusLabel` from `@/lib/domain/players`.
- Produces (all exported from `@/lib/domain/targets`):
  - constants `HOUSE_RULE_PREMIUM = 1.1`, `RISING_FAST = 0.18`, `FALLING = -0.09`, `CHEAP_CLAUSE_MULTIPLE = 1.1`, `IN_FORM_MARGIN = 2`, `FORM_ROUNDS = 3`, `STALE_MARKET_MS = 86_400_000`
  - `type Route = "auction" | "listed" | "clause"`, `type Lens = "investment" | "performance"`, `type RouteFilter = Route | "all"`
  - `type TagKey`, `type Tag = { key: TagKey; label: string; tone: "positive" | "warning" | "info" }`
  - `type TargetInput` and `type Target` (below)
  - `daysBefore(takenOn: string, days: number): string`
  - `toTarget(input: TargetInput, now: Date): Target`
  - `buildTargets(inputs: TargetInput[], opts: { now: Date; readerTeamId: string | null }): { ranked: Target[]; locked: Target[] }`
  - `type TargetView = { lens: Lens; route: RouteFilter; position: string | null; showInjured: boolean }`
  - `parseTargetView(params: Record<string, string | string[] | undefined>): TargetView`
  - `rankTargets(targets: Target[], view: TargetView): Target[]`
  - `isMarketStale(readAt: Date | null, now: Date): boolean`

- [ ] **Step 1: Write the failing tests**

`src/lib/domain/targets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildTargets,
  daysBefore,
  isMarketStale,
  parseTargetView,
  rankTargets,
  toTarget,
  type TargetInput,
} from "./targets";

const now = new Date("2026-10-03T18:00:00Z");
const later = new Date("2026-10-04T17:00:00Z");
const past = new Date("2026-10-03T17:00:00Z");

const input = (over: Partial<TargetInput> = {}): TargetInput => ({
  playerId: "p1",
  nickname: "Player",
  position: "Midfielder",
  status: "ok",
  value: 10_000_000,
  value7DaysAgo: 10_000_000,
  value14DaysAgo: 10_000_000,
  owner: null,
  listing: null,
  points: [],
  ...over,
});

const owner = (over: Partial<NonNullable<TargetInput["owner"]>> = {}): NonNullable<TargetInput["owner"]> => ({
  teamId: "t2",
  managerName: "Bruno",
  buyoutClause: 12_000_000,
  clauseLockedUntil: null,
  shielded: false,
  ...over,
});

const tags = (i: TargetInput) => toTarget(i, now).tags.map((t) => t.key);

describe("daysBefore", () => {
  it("counts calendar days across a month boundary", () => {
    expect(daysBefore("2026-10-03", 7)).toBe("2026-09-26");
    expect(daysBefore("2026-03-01", 14)).toBe("2026-02-15");
  });
});

describe("routes and cost", () => {
  it("prices an auction at market value", () => {
    const t = toTarget(input({ listing: { kind: "league", expiresAt: later, bids: 0 } }), now);
    expect(t).toMatchObject({ route: "auction", cost: 10_000_000, costMultiple: 1 });
  });

  it("prices a manager's listing at value plus the house rule's ten per cent", () => {
    const t = toTarget(input({ owner: owner({ clauseLockedUntil: later }), listing: { kind: "team", expiresAt: later, bids: null } }), now);
    expect(t.route).toBe("listed");
    expect(t.cost).toBeCloseTo(11_000_000, 0);
  });

  it("prices an unlocked owned player at the clause", () => {
    expect(toTarget(input({ owner: owner() }), now)).toMatchObject({ route: "clause", cost: 12_000_000 });
  });

  it("takes the cheaper route when a listed player is also clausable", () => {
    const t = toTarget(input({ owner: owner({ buyoutClause: 10_500_000 }), listing: { kind: "team", expiresAt: later, bids: null } }), now);
    expect(t).toMatchObject({ route: "clause", cost: 10_500_000 });
  });

  it("opens no clause route while locked or shielded", () => {
    expect(toTarget(input({ owner: owner({ clauseLockedUntil: later }) }), now).route).toBeNull();
    expect(toTarget(input({ owner: owner({ shielded: true }) }), now).route).toBeNull();
  });

  it("opens no route on a listing that has already expired", () => {
    expect(toTarget(input({ listing: { kind: "league", expiresAt: past, bids: 0 } }), now).route).toBeNull();
    expect(toTarget(input({ owner: owner({ clauseLockedUntil: later }), listing: { kind: "team", expiresAt: past, bids: null } }), now).route).toBeNull();
  });

  it("opens no route without a clause figure or a value", () => {
    expect(toTarget(input({ owner: owner({ buyoutClause: null }) }), now).route).toBeNull();
    expect(toTarget(input({ value: null, listing: { kind: "league", expiresAt: later, bids: 0 } }), now).route).toBeNull();
  });
});

describe("scores", () => {
  it("projects a week's growth onto the real cost", () => {
    // +20% a week, bought at 1.10x: 12M / 11M - 1 = +9.09%.
    const t = toTarget(
      input({ value7DaysAgo: 8_333_334, owner: owner({ clauseLockedUntil: later }), listing: { kind: "team", expiresAt: later, bids: null } }),
      now,
    );
    expect(t.growth7).toBeCloseTo(0.2, 3);
    expect(t.investment).toBeCloseTo(0.0909, 3);
  });

  it("has no investment score without seven days of history", () => {
    const t = toTarget(input({ value7DaysAgo: null, listing: { kind: "league", expiresAt: later, bids: 0 } }), now);
    expect(t.growth7).toBeNull();
    expect(t.investment).toBeNull();
  });

  it("scores performance as recent form per million of cost", () => {
    const t = toTarget(input({ points: [9, 6, 3, 0, 0], listing: { kind: "league", expiresAt: later, bids: 0 } }), now);
    expect(t.form).toBe(6);
    expect(t.seasonAverage).toBeCloseTo(3.6, 5);
    expect(t.performance).toBeCloseTo(0.6, 5);
  });

  it("has no form below three recorded rounds", () => {
    const t = toTarget(input({ points: [9, 6], listing: { kind: "league", expiresAt: later, bids: 0 } }), now);
    expect(t.form).toBeNull();
    expect(t.performance).toBeNull();
  });

  it("has no score at all without an open route", () => {
    const t = toTarget(input({ points: [5, 5, 5], owner: owner({ clauseLockedUntil: later }) }), now);
    expect(t.investment).toBeNull();
    expect(t.performance).toBeNull();
  });
});

describe("tags", () => {
  const auction = { kind: "league" as const, expiresAt: later, bids: 2 };

  it("calls eighteen per cent a week rising fast, and a hair under it not", () => {
    expect(tags(input({ value: 11_800_000, listing: auction }))).toContain("rising-fast");
    expect(tags(input({ value: 11_799_000, listing: auction }))).not.toContain("rising-fast");
  });

  it("calls a nine per cent drop falling, and a hair less not", () => {
    expect(tags(input({ value: 9_100_000, listing: auction }))).toContain("falling");
    expect(tags(input({ value: 9_101_000, listing: auction }))).not.toContain("falling");
  });

  it("calls a climb steady only when both a week and a fortnight are up", () => {
    expect(tags(input({ value: 10_100_000, listing: auction }))).toContain("steady-climb");
    expect(tags(input({ value: 10_100_000, value14DaysAgo: 10_200_000, listing: auction }))).not.toContain("steady-climb");
    expect(tags(input({ value: 10_100_000, value14DaysAgo: null, listing: auction }))).not.toContain("steady-climb");
  });

  it("calls a clause at up to 1.10x value cheap", () => {
    expect(tags(input({ owner: owner({ buyoutClause: 11_000_000 }) }))).toContain("cheap-clause");
    expect(tags(input({ owner: owner({ buyoutClause: 11_001_000 }) }))).not.toContain("cheap-clause");
  });

  it("marks a lock lifting within a day, but not behind a shield", () => {
    const soon = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    expect(tags(input({ owner: owner({ clauseLockedUntil: soon }) }))).toContain("takeable-soon");
    expect(tags(input({ owner: owner({ clauseLockedUntil: soon, shielded: true }) }))).not.toContain("takeable-soon");
  });

  it("calls form two points over the season average in form", () => {
    // form 6, season (6+6+6+0+2)/5 = 4: exactly +2.
    expect(tags(input({ points: [6, 6, 6, 0, 2], listing: auction }))).toContain("in-form");
    expect(tags(input({ points: [6, 6, 6, 0, 3], listing: auction }))).not.toContain("in-form");
  });

  it("marks an auction nobody has bid on", () => {
    expect(tags(input({ listing: { ...auction, bids: 0 } }))).toContain("no-bids");
    expect(tags(input({ listing: auction }))).not.toContain("no-bids");
  });

  it("warns of injury, doubt and suspension", () => {
    expect(tags(input({ status: "injured", listing: auction }))).toContain("injured");
    expect(tags(input({ status: "doubtful", listing: auction }))).toContain("doubtful");
    expect(tags(input({ status: "suspended", listing: auction }))).toContain("suspended");
  });
});

describe("buildTargets", () => {
  const auction = { kind: "league" as const, expiresAt: later, bids: 0 };

  it("never ranks the reader's own players", () => {
    const board = buildTargets([input({ playerId: "mine", owner: owner({ teamId: "t1" }) }), input({ playerId: "theirs", owner: owner() })], { now, readerTeamId: "t1" });
    expect(board.ranked.map((t) => t.playerId)).toEqual(["theirs"]);
    expect(board.locked).toEqual([]);
  });

  it("excludes nobody for a reader with no team", () => {
    const board = buildTargets([input({ playerId: "a", owner: owner({ teamId: "t1" }) })], { now, readerTeamId: null });
    expect(board.ranked).toHaveLength(1);
  });

  it("puts an owned player with no open route in the locked group, soonest first", () => {
    const sooner = new Date(now.getTime() + 2 * 86_400_000);
    const board = buildTargets(
      [
        input({ playerId: "late", owner: owner({ clauseLockedUntil: later }) }),
        input({ playerId: "far", owner: owner({ clauseLockedUntil: new Date(now.getTime() + 9 * 86_400_000) }) }),
        input({ playerId: "near", owner: owner({ clauseLockedUntil: sooner }) }),
      ],
      { now, readerTeamId: null },
    );
    expect(board.ranked).toEqual([]);
    expect(board.locked.map((t) => t.playerId)).toEqual(["late", "near", "far"]);
  });

  it("drops a free agent whose auction has closed: there is nothing to buy", () => {
    const board = buildTargets([input({ listing: { ...auction, expiresAt: past } })], { now, readerTeamId: null });
    expect(board).toEqual({ ranked: [], locked: [] });
  });
});

describe("rankTargets", () => {
  const auction = { kind: "league" as const, expiresAt: later, bids: 0 };
  const view = parseTargetView({});
  const build = (inputs: TargetInput[]) => buildTargets(inputs, { now, readerTeamId: null }).ranked;

  it("orders by the active lens, unscored rows last", () => {
    const rows = build([
      input({ playerId: "flat", nickname: "Flat", listing: auction }),
      input({ playerId: "none", nickname: "None", value7DaysAgo: null, listing: auction }),
      input({ playerId: "up", nickname: "Up", value: 11_000_000, listing: auction }),
    ]);
    expect(rankTargets(rows, view).map((t) => t.playerId)).toEqual(["up", "flat", "none"]);
  });

  it("filters by route, position and injury", () => {
    const rows = build([
      input({ playerId: "a", listing: auction }),
      input({ playerId: "c", owner: owner(), position: "Forward" }),
      input({ playerId: "i", status: "injured", listing: auction }),
      input({ playerId: "d", status: "doubtful", listing: auction }),
    ]);
    expect(rankTargets(rows, { ...view, route: "clause" }).map((t) => t.playerId)).toEqual(["c"]);
    expect(rankTargets(rows, { ...view, position: "Forward" }).map((t) => t.playerId)).toEqual(["c"]);
    const ids = rankTargets(rows, view).map((t) => t.playerId);
    expect(ids).not.toContain("i");
    expect(ids).toContain("d");
    expect(rankTargets(rows, { ...view, showInjured: true }).map((t) => t.playerId)).toContain("i");
  });
});

describe("parseTargetView", () => {
  it("defaults to investment, every route, every position, injuries hidden", () => {
    expect(parseTargetView({})).toEqual({ lens: "investment", route: "all", position: null, showInjured: false });
  });

  it("reads each parameter and ignores nonsense", () => {
    expect(parseTargetView({ lens: "performance", route: "clause", position: "Forward", injured: "shown" })).toEqual({
      lens: "performance",
      route: "clause",
      position: "Forward",
      showInjured: true,
    });
    expect(parseTargetView({ lens: "x", route: ["a", "b"] })).toMatchObject({ lens: "investment", route: "all" });
  });
});

describe("isMarketStale", () => {
  it("is stale when never read or read more than a day ago", () => {
    expect(isMarketStale(null, now)).toBe(true);
    expect(isMarketStale(new Date(now.getTime() - 86_400_001), now)).toBe(true);
    expect(isMarketStale(new Date(now.getTime() - 60_000), now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/lib/domain/targets.test.ts`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Implement `src/lib/domain/targets.ts`**

```ts
import { clauseStatus, type ClauseStatus } from "./market";
import { statusLabel } from "./players";

/**
 * Who is worth buying right now. See the 2026-10-03 targets spec, which this follows.
 *
 * Every threshold below was set from the live distribution on 2026-10-03 (seven-day growth
 * among owned players: p25 -8.7%, median -1.8%, p75 +8.5%, p90 +18%; clause / value: p10
 * 1.00, p25 1.10, median 1.37). Change them here and nowhere else.
 */

/**
 * The managers' own rule for buying from one another: an offer must beat value + 10%,
 * because +10% is the most the league's automatic offer can pay. The friends' rule, not
 * LaLiga's, which is why the page says "house rule" beside it.
 */
export const HOUSE_RULE_PREMIUM = 1.1;
export const RISING_FAST = 0.18;
export const FALLING = -0.09;
export const CHEAP_CLAUSE_MULTIPLE = 1.1;
export const IN_FORM_MARGIN = 2;
/** The same three-round cut the per-manager metrics use. */
export const FORM_ROUNDS = 3;
export const STALE_MARKET_MS = 24 * 60 * 60 * 1000;

/** Ratios built from integers land a hair off their decimal; thresholds are inclusive. */
const EPSILON = 1e-9;
const atLeast = (x: number, threshold: number) => x >= threshold - EPSILON;
const atMost = (x: number, threshold: number) => x <= threshold + EPSILON;

export type Route = "auction" | "listed" | "clause";
export type Lens = "investment" | "performance";
export type RouteFilter = Route | "all";

export type TagKey =
  | "rising-fast"
  | "steady-climb"
  | "falling"
  | "cheap-clause"
  | "takeable-soon"
  | "in-form"
  | "no-bids"
  | "injured"
  | "doubtful"
  | "suspended";

export type Tag = { key: TagKey; label: string; tone: "positive" | "warning" | "info" };

export type TargetInput = {
  playerId: string;
  nickname: string;
  position: string;
  status: string;
  /** The newest snapshot. */
  value: number | null;
  /** The snapshot exactly seven / fourteen calendar days before the newest one, if taken. */
  value7DaysAgo: number | null;
  value14DaysAgo: number | null;
  owner: {
    teamId: string;
    managerName: string;
    buyoutClause: number | null;
    clauseLockedUntil: Date | null;
    shielded: boolean;
  } | null;
  listing: { kind: "league" | "team"; expiresAt: Date; bids: number | null } | null;
  /** Points per recorded gameweek, NEWEST FIRST. */
  points: number[];
};

export type Target = {
  playerId: string;
  nickname: string;
  position: string;
  status: string;
  ownerName: string | null;
  value: number | null;
  route: Route | null;
  cost: number | null;
  costMultiple: number | null;
  growth7: number | null;
  growth14: number | null;
  form: number | null;
  seasonAverage: number | null;
  investment: number | null;
  performance: number | null;
  /** Null for a player nobody owns. */
  clause: ClauseStatus | null;
  lockedUntil: Date | null;
  tags: Tag[];
};

/** The `YYYY-MM-DD` calendar day `days` before another, as snapshots are keyed. */
export function daysBefore(takenOn: string, days: number): string {
  const [y, m, d] = takenOn.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

const growth = (value: number | null, then: number | null) =>
  value === null || then === null || then <= 0 ? null : value / then - 1;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const TAG_LABELS: Record<TagKey, string> = {
  "rising-fast": "Rising fast",
  "steady-climb": "Steady climb",
  falling: "Falling",
  "cheap-clause": "Cheap clause",
  "takeable-soon": "Takeable in 24h",
  "in-form": "In form",
  "no-bids": "No bids yet",
  injured: "Injured",
  doubtful: "Doubtful",
  suspended: "Suspended",
};

const tag = (key: TagKey, tone: Tag["tone"]): Tag => ({ key, label: TAG_LABELS[key], tone });

/**
 * Every route open to a buyer now, cheapest first. A listing past its expiry is no route,
 * whatever the last read said: that is what keeps a missed read from offering yesterday's
 * auction.
 */
function cheapestRoute(input: TargetInput, clause: ClauseStatus | null, now: Date): { route: Route; cost: number } | null {
  const open: { route: Route; cost: number }[] = [];
  const live = input.listing !== null && input.listing.expiresAt > now;
  if (live && input.value !== null) {
    if (input.listing?.kind === "league") open.push({ route: "auction", cost: input.value });
    else open.push({ route: "listed", cost: input.value * HOUSE_RULE_PREMIUM });
  }
  if (input.owner?.buyoutClause != null && clause?.state === "takeable") {
    open.push({ route: "clause", cost: input.owner.buyoutClause });
  }
  // Stable sort: on a tie the order above wins — auction, then listing, then clause.
  return open.sort((a, b) => a.cost - b.cost)[0] ?? null;
}

export function toTarget(input: TargetInput, now: Date): Target {
  const clause = input.owner
    ? clauseStatus({ lockedUntil: input.owner.clauseLockedUntil, shielded: input.owner.shielded }, now)
    : null;
  const open = cheapestRoute(input, clause, now);
  const cost = open?.cost ?? null;
  const growth7 = growth(input.value, input.value7DaysAgo);
  const growth14 = growth(input.value, input.value14DaysAgo);
  const form = input.points.length >= FORM_ROUNDS ? mean(input.points.slice(0, FORM_ROUNDS)) : null;
  const seasonAverage = input.points.length > 0 ? mean(input.points) : null;

  const investment =
    cost !== null && cost > 0 && input.value !== null && growth7 !== null
      ? (input.value * (1 + growth7)) / cost - 1
      : null;
  const performance = cost !== null && cost > 0 && form !== null ? form / (cost / 1_000_000) : null;

  const tags: Tag[] = [];
  if (growth7 !== null && atLeast(growth7, RISING_FAST)) tags.push(tag("rising-fast", "positive"));
  if (growth7 !== null && growth14 !== null && growth7 > 0 && growth14 > 0) tags.push(tag("steady-climb", "positive"));
  if (growth7 !== null && atMost(growth7, FALLING)) tags.push(tag("falling", "warning"));
  if (open?.route === "clause" && input.value !== null && atMost(open.cost, CHEAP_CLAUSE_MULTIPLE * input.value)) {
    tags.push(tag("cheap-clause", "positive"));
  }
  if (clause?.state === "soon" && !clause.shielded) tags.push(tag("takeable-soon", "info"));
  if (form !== null && seasonAverage !== null && atLeast(form, seasonAverage + IN_FORM_MARGIN)) {
    tags.push(tag("in-form", "positive"));
  }
  if (open?.route === "auction" && input.listing?.bids === 0) tags.push(tag("no-bids", "info"));
  if (input.status === "injured" || input.status === "doubtful" || input.status === "suspended") {
    tags.push({ key: input.status, label: statusLabel(input.status) ?? input.status, tone: "warning" });
  }

  return {
    playerId: input.playerId,
    nickname: input.nickname,
    position: input.position,
    status: input.status,
    ownerName: input.owner?.managerName ?? null,
    value: input.value,
    route: open?.route ?? null,
    cost,
    costMultiple: cost !== null && input.value ? cost / input.value : null,
    growth7,
    growth14,
    form,
    seasonAverage,
    investment,
    performance,
    clause,
    lockedUntil: input.owner?.clauseLockedUntil ?? null,
    tags,
  };
}

/**
 * Splits the market into what can be ranked and what is locked away.
 *
 * The reader's own players never appear: you cannot buy what you own. A free agent with no
 * open route (an auction that has closed) is not a target at all. An owned player with no
 * open route is counted in the locked group, soonest unlock first; a shield with no dated
 * lock sorts first, since a shield lasts at most a day.
 */
export function buildTargets(
  inputs: TargetInput[],
  { now, readerTeamId }: { now: Date; readerTeamId: string | null },
): { ranked: Target[]; locked: Target[] } {
  const ranked: Target[] = [];
  const locked: Target[] = [];
  for (const input of inputs) {
    if (readerTeamId !== null && input.owner?.teamId === readerTeamId) continue;
    const target = toTarget(input, now);
    if (target.route !== null) ranked.push(target);
    else if (input.owner !== null) locked.push(target);
  }
  const unlockAt = (t: Target) =>
    t.lockedUntil !== null && t.lockedUntil > now ? t.lockedUntil.getTime() : now.getTime();
  locked.sort((a, b) => unlockAt(a) - unlockAt(b) || a.nickname.localeCompare(b.nickname));
  return { ranked, locked };
}

export type TargetView = { lens: Lens; route: RouteFilter; position: string | null; showInjured: boolean };

const LENSES: Lens[] = ["investment", "performance"];
const ROUTES: RouteFilter[] = ["all", "auction", "listed", "clause"];

/** The view the address asks for; anything unrecognised falls back to the default. */
export function parseTargetView(params: Record<string, string | string[] | undefined>): TargetView {
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  return {
    lens: LENSES.find((l) => l === one(params.lens)) ?? "investment",
    route: ROUTES.find((r) => r === one(params.route)) ?? "all",
    position: one(params.position),
    showInjured: one(params.injured) === "shown",
  };
}

/**
 * Filters and orders by the active lens. A row with no score for that lens sinks below every
 * scored one rather than sorting as zero, the same refusal `sortCatalogue` makes. Injured and
 * suspended players are hidden unless asked for; doubtful ones stay, tagged.
 */
export function rankTargets(targets: Target[], view: TargetView): Target[] {
  const score = (t: Target) => (view.lens === "investment" ? t.investment : t.performance);
  return targets
    .filter((t) => view.route === "all" || t.route === view.route)
    .filter((t) => view.position === null || t.position === view.position)
    .filter((t) => view.showInjured || (t.status !== "injured" && t.status !== "suspended"))
    .sort((a, b) => {
      const left = score(a);
      const right = score(b);
      if (left === null && right === null) return a.nickname.localeCompare(b.nickname);
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left || a.nickname.localeCompare(b.nickname);
    });
}

/** Never read, or read more than a day ago. */
export function isMarketStale(readAt: Date | null, now: Date): boolean {
  return readAt === null || now.getTime() - readAt.getTime() > STALE_MARKET_MS;
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm vitest run src/lib/domain/targets.test.ts && npx tsc --noEmit`
Expected: PASS. If the "locked group, soonest first" expectation fails, check the dates. `later` is about 1 day out, `near` is 2 days out and `far` is 9 days out, so the order is `late`, `near`, `far`. Fix the test only if the arithmetic in the test itself is wrong, never the sort.

- [ ] **Step 5: Break it on purpose**

Change `HOUSE_RULE_PREMIUM` to `1` and rerun. The listing-cost test and the investment test must fail. Remove `EPSILON` from `atLeast`. The "eighteen per cent" boundary test must fail. Restore both.

- [ ] **Step 6: Commit**

```bash
git add src/lib/domain/targets.ts src/lib/domain/targets.test.ts
git commit -m "feat: targets are scored for investment and performance, and tagged with why"
```

---

### Task 5: One query assembles the inputs

**Files:**
- Modify: `src/lib/db/queries.ts`
- Test: `src/lib/db/queries.test.ts`

**Interfaces:**
- Consumes: `marketListings` (Task 3); `TargetInput`, `daysBefore` (Task 4).
- Produces: `type TargetsData = { inputs: TargetInput[]; marketReadAt: Date | null; auctionClosesAt: Date | null }`; `loadTargets(db: Db): Promise<TargetsData>`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/db/queries.test.ts`, with `marketListings` added to the schema import and `loadTargets` to the queries import:

```ts
describe("loadTargets", () => {
  let h: TestDatabase;
  const readAt = new Date("2026-10-03T17:45:00Z");
  const closes = new Date("2026-10-04T17:00:00Z");

  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(teams).values([{ id: "t2", managerId: 2, managerName: "Bruno" }]);
    await h.db.insert(players).values(
      [
        { id: "own", nickname: "Owned" },
        { id: "auc", nickname: "Auctioned" },
        { id: "nobody", nickname: "Nobody" },
      ].map((p) => ({ ...p, position: "Forward", realTeamId: "rt1", status: "ok" })),
    );
    await h.db.insert(squadMembers).values({ teamId: "t2", playerId: "own", buyoutClause: 7_000_000, clauseLockedUntil: null });
    await h.db.insert(marketListings).values({ playerId: "auc", kind: "league", expiresAt: closes, bids: 0, readAt });
    await h.db.insert(playerValueSnapshots).values([
      { playerId: "own", takenOn: "2026-09-19", value: 4_000_000 },
      { playerId: "own", takenOn: "2026-09-26", value: 5_000_000 },
      { playerId: "own", takenOn: "2026-09-30", value: 5_500_000 },
      { playerId: "own", takenOn: "2026-10-03", value: 6_000_000 },
      { playerId: "auc", takenOn: "2026-10-02", value: 2_000_000 },
      { playerId: "nobody", takenOn: "2026-10-03", value: 1_000_000 },
    ]);
    await h.db.insert(playerGameweekPoints).values([
      { playerId: "own", gameweek: 1, points: 2 },
      { playerId: "own", gameweek: 2, points: 4 },
      { playerId: "own", gameweek: 3, points: 6 },
    ]);
  });
  afterAll(async () => {
    await h.close();
  });

  it("gathers owned and listed players, and nobody else", async () => {
    const { inputs } = await loadTargets(h.db);
    expect(inputs.map((i) => i.playerId).sort()).toEqual(["auc", "own"]);
  });

  it("reads growth against the exact days seven and fourteen before the newest snapshot", async () => {
    const own = (await loadTargets(h.db)).inputs.find((i) => i.playerId === "own");
    expect(own).toMatchObject({ value: 6_000_000, value7DaysAgo: 5_000_000, value14DaysAgo: 4_000_000 });
  });

  it("leaves growth unknown when the comparison day was never swept", async () => {
    const auc = (await loadTargets(h.db)).inputs.find((i) => i.playerId === "auc");
    expect(auc).toMatchObject({ value: 2_000_000, value7DaysAgo: null, value14DaysAgo: null });
  });

  it("carries the owner, the listing and the points newest first", async () => {
    const { inputs } = await loadTargets(h.db);
    const own = inputs.find((i) => i.playerId === "own");
    const auc = inputs.find((i) => i.playerId === "auc");
    expect(own?.owner).toMatchObject({ teamId: "t2", managerName: "Bruno", buyoutClause: 7_000_000, shielded: false });
    expect(own?.points).toEqual([6, 4, 2]);
    expect(auc?.listing).toEqual({ kind: "league", expiresAt: closes, bids: 0 });
    expect(auc?.owner).toBeNull();
  });

  it("reports when the market was read and when the auction closes", async () => {
    expect(await loadTargets(h.db)).toMatchObject({ marketReadAt: readAt, auctionClosesAt: closes });
  });
});

describe("loadTargets on an empty league", () => {
  it("returns nothing rather than querying with an empty list", async () => {
    const h = await createTestDatabase();
    expect(await loadTargets(h.db)).toEqual({ inputs: [], marketReadAt: null, auctionClosesAt: null });
    await h.close();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/lib/db/queries.test.ts -t loadTargets`
Expected: FAIL, `loadTargets` is not exported.

- [ ] **Step 3: Implement `loadTargets`**

In `src/lib/db/queries.ts`, add `marketListings` to the schema import, `inArray` and `and` are already imported (confirm), and add `import { daysBefore, type TargetInput } from "@/lib/domain/targets";`. Then append:

```ts
export type TargetsData = {
  inputs: TargetInput[];
  /** When the market was last read; null when it never has been. */
  marketReadAt: Date | null;
  /** The earliest close among the daily auction's listings; null with no auction listed. */
  auctionClosesAt: Date | null;
};

/**
 * Everyone who can be bought, with what scoring them needs: every owned player, and every
 * player on the market. A free agent who is not on the market cannot be bought today and
 * is not read at all.
 *
 * Growth compares each player's NEWEST snapshot with the snapshot exactly seven and
 * fourteen calendar days before it. Not the nearest earlier one: a stale baseline would
 * invent momentum, and a day the sweep missed is honestly unknown.
 *
 * Points come back newest first, for the candidates only (~170 players), so the whole
 * season's points table is never shipped.
 */
export async function loadTargets(db: Db): Promise<TargetsData> {
  const [owned, listings] = await Promise.all([
    db
      .select({
        playerId: squadMembers.playerId,
        teamId: squadMembers.teamId,
        managerName: teams.managerName,
        buyoutClause: squadMembers.buyoutClause,
        clauseLockedUntil: squadMembers.clauseLockedUntil,
        shielded: squadMembers.shielded,
      })
      .from(squadMembers)
      .innerJoin(teams, eq(teams.id, squadMembers.teamId)),
    db.select().from(marketListings),
  ]);

  const marketReadAt = listings.reduce<Date | null>(
    (latest, l) => (latest === null || l.readAt > latest ? l.readAt : latest),
    null,
  );
  const auctionClosesAt = listings
    .filter((l) => l.kind === "league")
    .reduce<Date | null>((first, l) => (first === null || l.expiresAt < first ? l.expiresAt : first), null);

  const ids = [...new Set([...owned.map((o) => o.playerId), ...listings.map((l) => l.playerId)])];
  if (ids.length === 0) return { inputs: [], marketReadAt, auctionClosesAt };

  const [playerRows, current, pointRows] = await Promise.all([
    db.select().from(playersTable).where(inArray(playersTable.id, ids)),
    db
      .selectDistinctOn([playerValueSnapshots.playerId], {
        playerId: playerValueSnapshots.playerId,
        value: playerValueSnapshots.value,
        takenOn: playerValueSnapshots.takenOn,
      })
      .from(playerValueSnapshots)
      .where(inArray(playerValueSnapshots.playerId, ids))
      .orderBy(playerValueSnapshots.playerId, desc(playerValueSnapshots.takenOn)),
    db
      .select({
        playerId: playerGameweekPoints.playerId,
        points: playerGameweekPoints.points,
      })
      .from(playerGameweekPoints)
      .where(inArray(playerGameweekPoints.playerId, ids))
      .orderBy(playerGameweekPoints.playerId, desc(playerGameweekPoints.gameweek)),
  ]);

  const pastDays = [...new Set(current.flatMap((c) => [daysBefore(c.takenOn, 7), daysBefore(c.takenOn, 14)]))];
  const past =
    pastDays.length === 0
      ? []
      : await db
          .select({
            playerId: playerValueSnapshots.playerId,
            takenOn: playerValueSnapshots.takenOn,
            value: playerValueSnapshots.value,
          })
          .from(playerValueSnapshots)
          .where(and(inArray(playerValueSnapshots.playerId, ids), inArray(playerValueSnapshots.takenOn, pastDays)));

  const pastValue = new Map(past.map((p) => [`${p.playerId}|${p.takenOn}`, p.value]));
  const currentBy = new Map(current.map((c) => [c.playerId, c]));
  const ownerBy = new Map(owned.map((o) => [o.playerId, o]));
  const listingBy = new Map(listings.map((l) => [l.playerId, l]));
  const pointsBy = new Map<string, number[]>();
  for (const row of pointRows) {
    const list = pointsBy.get(row.playerId) ?? [];
    list.push(row.points);
    pointsBy.set(row.playerId, list);
  }

  const inputs: TargetInput[] = playerRows.map((p) => {
    const now = currentBy.get(p.id);
    const o = ownerBy.get(p.id);
    const l = listingBy.get(p.id);
    return {
      playerId: p.id,
      nickname: p.nickname,
      position: p.position,
      status: p.status,
      value: now?.value ?? null,
      value7DaysAgo: now ? (pastValue.get(`${p.id}|${daysBefore(now.takenOn, 7)}`) ?? null) : null,
      value14DaysAgo: now ? (pastValue.get(`${p.id}|${daysBefore(now.takenOn, 14)}`) ?? null) : null,
      owner: o
        ? {
            teamId: o.teamId,
            managerName: o.managerName,
            buyoutClause: o.buyoutClause,
            clauseLockedUntil: o.clauseLockedUntil,
            shielded: o.shielded,
          }
        : null,
      listing: l ? { kind: l.kind === "team" ? "team" : "league", expiresAt: l.expiresAt, bids: l.bids } : null,
      points: pointsBy.get(p.id) ?? [],
    };
  });

  return { inputs, marketReadAt, auctionClosesAt };
}
```

If `teams.managerName` is nullable in the schema, `tsc` will say so. In that case map it with `?? ""`, the same way `loadPlayerCatalogue`'s consumers treat it.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `pnpm vitest run src/lib/db/queries.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Break it on purpose**

Change `daysBefore(now.takenOn, 7)` in the mapping to `daysBefore(now.takenOn, 6)` and rerun. The "exact days" test must fail. Restore it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/queries.ts src/lib/db/queries.test.ts
git commit -m "feat: one query gathers everybody who can be bought"
```

---

### Task 6: The `/targets` page

**Files:**
- Create: `src/components/target-controls.tsx`, `src/components/target-controls.test.tsx`
- Create: `src/components/target-list.tsx`, `src/components/target-list.test.tsx`
- Create: `src/app/(portal)/targets/page.tsx`
- Modify: `src/components/nav-links.tsx`, `src/components/nav-links.test.tsx`
- Modify: `src/lib/db/seed-league.ts`, `src/app/portal-pages.test.tsx`

**Interfaces:**
- Consumes: `loadTargets` (Task 5); `buildTargets`, `rankTargets`, `parseTargetView`, `isMarketStale`, `Target`, `TargetView`, `HOUSE_RULE_PREMIUM` (Task 4); `urlWithParam` (`@/components/picker-url`); `ClauseName` (`@/components/clause-marks`); `formatMoney` (`@/lib/domain/players`); `formatSyncedAt`, `formatLeagueMoment` (`@/lib/domain/clock`); `loadMyTeam` (`@/lib/claims`); `requireSession` (`@/lib/auth/guards`); `PageHeader`.
- Produces: `TargetControls({ view, positions }: { view: TargetView; positions: string[] })`; `TargetList({ rows, lens }: { rows: Target[]; lens: Lens })`; `LockedTargets({ rows }: { rows: Target[] })`.

Before writing the page, read `node_modules/next/dist/docs/` on dynamic route `searchParams`, and copy the patterns of `src/app/(portal)/necroporra/page.tsx` (Promise `searchParams`, `loadMyTeam`) and `src/components/round-picker.tsx` (client select, `router.push(urlWithParam(...), { scroll: false })`). Load the `frontend-design` skill before the markup (owner's standing instruction). It must still look like the rest of the board: the `--board-*` tokens, mono figures, 13px names, 10.5px meta lines, and the same `Control` select look as `player-catalogue.tsx`.

- [ ] **Step 1: Write the failing component tests**

`src/components/target-list.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LockedTargets, TargetList } from "./target-list";
import { toTarget, type TargetInput } from "@/lib/domain/targets";

const now = new Date("2026-10-03T18:00:00Z");
const later = new Date("2026-10-04T17:00:00Z");
const base: TargetInput = {
  playerId: "p1",
  nickname: "Urko",
  position: "Defender",
  status: "ok",
  value: 3_300_000,
  value7DaysAgo: 2_750_000,
  value14DaysAgo: 2_500_000,
  owner: null,
  listing: { kind: "league", expiresAt: later, bids: 0 },
  points: [],
};

describe("TargetList", () => {
  it("draws the route, the cost with its multiple, the growth and the lens score", () => {
    const html = renderToStaticMarkup(<TargetList rows={[toTarget(base, now)]} lens="investment" />);
    expect(html).toContain("Urko");
    expect(html).toContain("Auction");
    expect(html).toContain("3.3M");
    expect(html).toContain("1.00×");
    expect(html).toContain("+20%");
    expect(html).toContain("Rising fast");
    expect(html).toContain("No bids yet");
    expect(html).toContain('href="/players/p1"');
  });

  it("labels a listing's premium as the house rule", () => {
    const listed = toTarget(
      { ...base, owner: { teamId: "t2", managerName: "Bruno", buyoutClause: 99_000_000, clauseLockedUntil: later, shielded: false }, listing: { kind: "team", expiresAt: later, bids: null } },
      now,
    );
    const html = renderToStaticMarkup(<TargetList rows={[listed]} lens="investment" />);
    expect(html).toContain("1.10× house rule");
    expect(html).toContain("Bruno");
  });

  it("shows a dash, not a zero, for a score that cannot be worked out", () => {
    const html = renderToStaticMarkup(<TargetList rows={[toTarget({ ...base, value7DaysAgo: null }, now)]} lens="investment" />);
    expect(html).toContain("—");
  });

  it("says so when nothing matches", () => {
    expect(renderToStaticMarkup(<TargetList rows={[]} lens="performance" />)).toContain("Nobody matches");
  });
});

describe("LockedTargets", () => {
  it("counts the locked players behind a closed summary, with when each frees up", () => {
    const locked = toTarget(
      { ...base, listing: null, owner: { teamId: "t2", managerName: "Bruno", buyoutClause: 9_000_000, clauseLockedUntil: new Date("2026-10-09T10:00:00Z"), shielded: false } },
      now,
    );
    const html = renderToStaticMarkup(<LockedTargets rows={[locked]} />);
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Locked — no route open (1)");
    expect(html).toContain("locked until");
  });

  it("marks a shielded player as shielded", () => {
    const shielded = toTarget(
      { ...base, listing: null, owner: { teamId: "t2", managerName: "Bruno", buyoutClause: 9_000_000, clauseLockedUntil: null, shielded: true } },
      now,
    );
    expect(renderToStaticMarkup(<LockedTargets rows={[shielded]} />)).toContain("Shielded");
  });

  it("draws nothing when nobody is locked", () => {
    expect(renderToStaticMarkup(<LockedTargets rows={[]} />)).toBe("");
  });
});
```

`src/components/target-controls.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TargetControls } from "./target-controls";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("TargetControls", () => {
  it("offers both lenses, every route, the positions and the injury switch, with the view selected", () => {
    const html = renderToStaticMarkup(
      <TargetControls
        view={{ lens: "performance", route: "clause", position: null, showInjured: false }}
        positions={["Goalkeeper", "Forward"]}
      />,
    );
    for (const label of ["Investment", "Performance", "Auction", "Listed", "Clause", "Goalkeeper", "Forward", "Hidden", "Shown"]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/<option[^>]*selected[^>]*>Performance</);
    expect(html).toMatch(/<option[^>]*selected[^>]*>Clause</);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/components/target-list.test.tsx src/components/target-controls.test.tsx`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Implement `target-list.tsx`**

A server-safe component with no hooks:

```tsx
import Link from "next/link";
import { ClauseName } from "@/components/clause-marks";
import { formatMoney } from "@/lib/domain/players";
import type { Lens, Route, Tag, Target } from "@/lib/domain/targets";

const ROUTE_LABEL: Record<Route, string> = { auction: "Auction", listed: "Listed", clause: "Clause" };

const TONE: Record<Tag["tone"], string> = {
  positive: "var(--board-gain)",
  warning: "var(--board-alert)",
  info: "var(--board-free)",
};

const percent = (x: number | null) => (x === null ? "—" : `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`);
const score = (t: Target, lens: Lens) =>
  lens === "investment" ? percent(t.investment) : t.performance === null ? "—" : t.performance.toFixed(2);

/**
 * The ranked targets for one lens.
 *
 * Each row carries its reason beside its rank: the route and what it really costs (with its
 * multiple of market value, and "house rule" on a listing so nobody reads the +10% as
 * LaLiga's), the week's growth, the tags, and the active lens's score. A score that cannot
 * be worked out is a dash, never a zero.
 */
export function TargetList({ rows, lens }: { rows: Target[]; lens: Lens }) {
  if (rows.length === 0) {
    return (
      <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
        Nobody matches that. Clear a filter to widen it.
      </p>
    );
  }
  return (
    <>
      <div
        className="mt-3 grid grid-cols-[1fr_64px_56px] gap-3 border-y px-2 py-[5px] text-[10px] uppercase tracking-[0.06em]"
        style={{ borderColor: "var(--board-line)", background: "var(--board-panel)", color: "var(--board-ink-dim)" }}
      >
        <span>Player · route · cost</span>
        <span className="text-right">7 days</span>
        <span className="text-right">{lens === "investment" ? "Return" : "Pts / M"}</span>
      </div>
      <ol>
        {rows.map((t, i) => (
          <li key={t.playerId} className="border-b" style={{ borderColor: "var(--board-line)" }}>
            <Link href={`/players/${t.playerId}`} className="grid grid-cols-[1fr_64px_56px] items-start gap-3 px-2 py-[6px]">
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="text-[10.5px] tabular-nums" style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}>
                    {i + 1}
                  </span>
                  <ClauseName clause={t.clause ?? undefined}>{t.nickname}</ClauseName>
                </span>
                <span className="block truncate text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                  {t.position} · {t.ownerName ?? "Free"} · {t.route ? ROUTE_LABEL[t.route] : ""}{" "}
                  {t.cost === null ? "" : formatMoney(t.cost)}
                  {t.costMultiple === null ? "" : ` · ${t.costMultiple.toFixed(2)}×${t.route === "listed" ? " house rule" : ""}`}
                </span>
                {t.tags.length === 0 ? null : (
                  <span className="mt-[3px] flex flex-wrap gap-1">
                    {t.tags.map((tag) => (
                      <span key={tag.key} className="border px-[5px] text-[10px]" style={{ color: TONE[tag.tone], borderColor: "var(--board-line)" }}>
                        {tag.label}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="text-right text-[12px] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {percent(t.growth7)}
              </span>
              <span className="text-right text-[13px] font-semibold tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {score(t, lens)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Owned players nobody can take today, folded away and counted.
 *
 * A native `<details>`, closed by default: they are context, not candidates, and they are
 * about half the league. A shield gets its word and its mark but no countdown, because the
 * API gives none.
 */
export function LockedTargets({ rows }: { rows: Target[] }) {
  if (rows.length === 0) return null;
  return (
    <details className="mt-6">
      <summary className="cursor-pointer text-[11.5px]" style={{ color: "var(--board-ink-dim)" }}>
        Locked — no route open ({rows.length})
      </summary>
      <ol className="mt-2">
        {rows.map((t) => (
          <li key={t.playerId} className="border-b px-2 py-[5px]" style={{ borderColor: "var(--board-line)" }}>
            <Link href={`/players/${t.playerId}`} className="block">
              <ClauseName clause={t.clause ?? undefined}>{t.nickname}</ClauseName>
              <span className="block text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                {t.position} · {t.ownerName} · {t.clause?.state === "shielded" ? "Shielded" : t.clause?.label}
                {t.clause?.shielded && t.clause.state !== "shielded" ? " · Shielded" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </details>
  );
}
```

- [ ] **Step 4: Implement `target-controls.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { urlWithParam } from "./picker-url";
import type { TargetView } from "@/lib/domain/targets";

/**
 * The four choices, written into the address so a view is linkable and the back button
 * works. Each select owns one parameter and leaves the others alone (`urlWithParam`). A
 * default is written as no parameter at all, so an untouched page stays `/targets`.
 */
export function TargetControls({ view, positions }: { view: TargetView; positions: string[] }) {
  const router = useRouter();
  const current = useSearchParams();
  const go = (param: string, value: string | null) =>
    router.push(urlWithParam("/targets", current, param, value), { scroll: false });

  return (
    <div className="mt-3 flex gap-2">
      <Select label="Lens" value={view.lens} onChange={(v) => go("lens", v === "investment" ? null : v)}>
        <option value="investment">Investment</option>
        <option value="performance">Performance</option>
      </Select>
      <Select label="Route" value={view.route} onChange={(v) => go("route", v === "all" ? null : v)}>
        <option value="all">All</option>
        <option value="auction">Auction</option>
        <option value="listed">Listed</option>
        <option value="clause">Clause</option>
      </Select>
      <Select label="Position" value={view.position ?? ""} onChange={(v) => go("position", v === "" ? null : v)}>
        <option value="">All</option>
        {positions.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <Select label="Injured" value={view.showInjured ? "shown" : ""} onChange={(v) => go("injured", v === "" ? null : v)}>
        <option value="">Hidden</option>
        <option value="shown">Shown</option>
      </Select>
    </div>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <span className="text-[9.5px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border px-2 py-[5px] text-[12px]"
        style={{ background: "var(--board-panel)", borderColor: "var(--board-line)", color: "var(--board-ink)" }}
      >
        {children}
      </select>
    </label>
  );
}
```

- [ ] **Step 5: Run the component tests**

Run: `pnpm vitest run src/components/target-list.test.tsx src/components/target-controls.test.tsx`
Expected: PASS. The `+20%` in the first test comes from 3.3M / 2.75M − 1 = 0.2. If the `href` assertion fails because of how `Link` renders in this setup, compare it with `player-catalogue.test.tsx`'s link assertions and match that form.

- [ ] **Step 6: Seed the page test, test first**

In `src/lib/db/seed-league.ts`, after the `squadMembers` insert, add players the reader does not own. Import `marketListings`.

```ts
  // Targets: one rival player whose clause is open and whose value rose 25% in a week, one
  // locked away on another team, and one free agent in today's auction. Ada (t1) owns the
  // whole squad above, so none of HER players may ever appear on /targets.
  await db.insert(players).values([
    { id: "rv1", nickname: "Rival Striker", position: "Forward", realTeamId: "rt1", status: "ok", imageUrl: null },
    { id: "lk1", nickname: "Locked Keeper", position: "Goalkeeper", realTeamId: "rt1", status: "ok", imageUrl: null },
    { id: "fa1", nickname: "Free Agent", position: "Midfielder", realTeamId: "rt1", status: "ok", imageUrl: null },
  ]);
  await db.insert(playerValueSnapshots).values([
    { playerId: "rv1", takenOn: "2026-08-13", value: 4_000_000 },
    { playerId: "rv1", takenOn: "2026-08-20", value: 5_000_000 },
    { playerId: "lk1", takenOn: "2026-08-20", value: 3_000_000 },
    { playerId: "fa1", takenOn: "2026-08-20", value: 2_000_000 },
  ]);
  await db.insert(squadMembers).values([
    { teamId: "t2", playerId: "rv1", buyoutClause: 6_000_000, clauseLockedUntil: null },
    { teamId: "t3", playerId: "lk1", buyoutClause: 9_000_000, clauseLockedUntil: new Date("2099-01-01T00:00:00Z") },
  ]);
  await db.insert(marketListings).values({
    playerId: "fa1",
    kind: "league",
    expiresAt: new Date("2099-01-01T17:00:00Z"),
    bids: 0,
    readAt: new Date("2026-08-20T17:45:00Z"),
  });
```

In `src/app/portal-pages.test.tsx`, add next to the `/players` block:

```ts
describe("/targets", () => {
  it("ranks other managers' players and today's auction, never the reader's own", async () => {
    const { default: Page } = await import("./(portal)/targets/page");
    const html = await render(() => Page({ searchParams: none }));
    expect(html).toContain("Rival Striker");
    expect(html).toContain("Rising fast");
    expect(html).toContain("Free Agent");
    expect(html).toContain("No bids yet");
    expect(html).toContain("Locked — no route open (1)");
    expect(html).toContain("Locked Keeper");
    // Ada owns the whole seeded squad.
    expect(html).not.toContain("Courtois");
    // The seeded read is from August: the page must say the market is old.
    expect(html).toContain("over a day old");
  });
});
```

Run: `pnpm vitest run src/app/portal-pages.test.tsx`
Expected: FAIL on `/targets` only (the page does not exist). Every other page must still pass with the extra seed rows. If one fails, read why before touching it.

- [ ] **Step 7: Implement the page**

`src/app/(portal)/targets/page.tsx`:

```tsx
import { db } from "@/lib/db";
import { loadTargets } from "@/lib/db/queries";
import { loadMyTeam } from "@/lib/claims";
import { requireSession } from "@/lib/auth/guards";
import { buildTargets, isMarketStale, parseTargetView, rankTargets } from "@/lib/domain/targets";
import { formatLeagueMoment, formatSyncedAt } from "@/lib/domain/clock";
import { PageHeader } from "@/components/page-header";
import { TargetControls } from "@/components/target-controls";
import { LockedTargets, TargetList } from "@/components/target-list";

const POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Coach"];

export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireSession();
  const [{ inputs, marketReadAt, auctionClosesAt }, myTeam] = await Promise.all([
    loadTargets(db),
    loadMyTeam(db, { userId: session.user.id }),
  ]);
  const now = new Date();
  const view = parseTargetView(await searchParams);
  const board = buildTargets(inputs, { now, readerTeamId: myTeam?.teamId ?? null });
  const rows = rankTargets(board.ranked, view);
  const stale = isMarketStale(marketReadAt, now);

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title="Targets"
        note="Everyone you could buy today, ranked by what they would return or score for what they would really cost."
        meta={`${rows.length} targets`}
      />

      <p className="mt-2 text-[11px]" style={{ color: stale ? "var(--board-alert)" : "var(--board-ink-dim)" }}>
        {marketReadAt === null
          ? "The market has not been read yet, so only clause routes are ranked."
          : stale
            ? `Market read ${formatLeagueMoment(marketReadAt)}, over a day old. Expired auctions are left out.`
            : `Market read ${formatSyncedAt(marketReadAt, now)}${
                auctionClosesAt !== null && auctionClosesAt > now ? ` · auction closes ${formatLeagueMoment(auctionClosesAt)}` : ""
              }`}
      </p>

      <TargetControls view={view} positions={POSITIONS} />
      <TargetList rows={rows} lens={view.lens} />
      <LockedTargets rows={board.locked} />

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        Return: what a week like the last one would make on the real cost. Pts / M: points over the last three
        rounds per million of real cost. A listing costs 1.10× value by the managers&apos; house rule.
      </p>
    </section>
  );
}
```

`TargetControls` reads `useSearchParams`. Check how `necroporra/page.tsx` mounts `TeamPicker`/`RoundPicker` (whether a `<Suspense>` boundary is needed in this Next version) and do the same. `next build` in Step 10 is the check.

- [ ] **Step 8: Add the nav tab**

In `src/components/nav-links.tsx`, add `{ href: "/targets", label: "Targets" },` between Players and Market, with a short comment saying it sits beside the two pages it draws from. In `nav-links.test.tsx`, add `"Targets"` to the label loop at line 22 and an order assertion: `expect(html.indexOf("Players")).toBeLessThan(html.indexOf("Targets")); expect(html.indexOf("Targets")).toBeLessThan(html.indexOf("Market"));`.

- [ ] **Step 9: Run everything touched, and the typecheck**

Run: `pnpm vitest run src/components src/app && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Build and look at it**

Run: `pnpm lint && pnpm build`
Expected: both clean. Then run `pnpm dev`, open **http://localhost:3000/targets** (localhost, not the LAN IP), and check:
- each control changes the address without losing the other parameters;
- the locked group opens;
- the page holds at 360px wide with no horizontal scroll.

Use the `run` skill if it helps. Report anything that looks off rather than polishing past it.

- [ ] **Step 11: Commit**

```bash
git add src/components/target-controls.tsx src/components/target-controls.test.tsx src/components/target-list.tsx src/components/target-list.test.tsx "src/app/(portal)/targets/page.tsx" src/components/nav-links.tsx src/components/nav-links.test.tsx src/lib/db/seed-league.ts src/app/portal-pages.test.tsx
git commit -m "feat: /targets ranks who is worth buying, through two lenses"
```

---

### Task 7: Deployment notes, README, and the whole-suite check

**Files:**
- Modify: `docs/deployment.md`, `README.md`

- [ ] **Step 1: Document the migration order in `docs/deployment.md`**

Add a section after the last migration section, in the same voice:

```markdown
## Market listings (migration 0017)

`0017_market_listings.sql` creates `market_listings`. **Apply it before deploying the
code that reads it**, or every player sweep's market read fails (tolerated: the sweep still
succeeds, and `marketFailed: true` appears in its JSON) and `/targets` errors on its query.

    DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate

Then verify, because `drizzle-kit migrate` hides its errors: `market_listings` must exist in
`information_schema.tables`, and `drizzle.__drizzle_migrations` must have one more row than
before.

The same deploy moves the player sweep onto a fixed grid (01:45, 07:45, 13:45, 19:45
Madrid). The chain that is running books its next slot on its first run after the deploy;
nothing needs restarting.
```

- [ ] **Step 2: Update the README**

Add `/targets` to the README's list of pages, with one line: "who can be bought today (auction, listing, clause), ranked for investment or performance, with tags saying why". If the README describes the player sweep's cadence as "every six hours", change it to the grid. Check "What is not built" for anything this closes.

- [ ] **Step 3: Run the whole suite, the typecheck, lint and build**

Run: `pnpm test && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: all green. Report the test count.

- [ ] **Step 4: Commit**

```bash
git add docs/deployment.md README.md
git commit -m "docs: the market listings migration, the sweep grid and /targets"
```

- [ ] **Step 5: Hand back for the push**

Do not push. Report the commits ahead of `origin/main` (`git rev-list --count @{u}..HEAD`). The owner pushes, applies migration 0017 to production first, and runs the verification above.
