# Best Lineup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell a manager which of the league's seven formations their squad scores most with, who plays in it, and — when none is possible — which line they are short of and by how many.

**Architecture:** One pure domain module ranks the formations by sorting each line once and reading prefix sums; a server component renders the chosen eleven and the ranking; a new page at `/teams/[id]/lineup` reads the existing catalogue and applies two URL parameters. No solver, no new query, no schema change.

**Tech Stack:** Next.js 16.3.4 (App Router, server components), TypeScript, Tailwind v4, Vitest, `react-dom/server`'s `renderToStaticMarkup` for component tests.

**Spec:** `docs/superpowers/specs/2026-09-09-tebasfury-best-lineup-design.md`

## Global Constraints

- **`npx tsc --noEmit` is the typecheck.** `npx vitest run` passes over type errors in this repo; run both, plus `npx eslint` and `npx next build`.
- **Run the checks one at a time.** Running `vitest` and `eslint` concurrently kills PGlite workers with OOM on this machine and produces false red.
- Every artefact in English, UI strings included.
- No migration, no schema change, no new database query in this slice.
- The goalkeeper is never part of a formation's name: it is always exactly 1.
- Formations: `5-4-1`, `5-3-2`, `4-5-1`, `4-4-2`, `4-3-3`, `3-5-2`, `3-4-3`.
- Excluded from every lineup: players whose `status` is `injured`, `suspended` or `out_of_league`. `doubtful` players count and are marked.
- No `MIN_GAMEWEEKS_FOR_RANKING` floor here. A null average sinks; it never sorts as zero.
- Ties inside a line break on `nickname`, so an eleven cannot wobble between renders.

---

### Task 1: The formations and eligibility

**Files:**
- Create: `src/lib/domain/lineup.ts`
- Test: `src/lib/domain/lineup.test.ts`

**Interfaces:**
- Consumes: `CatalogueRow` from `@/lib/domain/players` — fields used here are `id`, `nickname`, `position`, `status`, `seasonPoints`, `averagePoints`, `gameweeksRecorded`.
- Produces:
  - `type Formation = { defenders: number; midfielders: number; forwards: number }`
  - `const FORMATIONS: Formation[]`
  - `function formationName(f: Formation): string`
  - `function eligible(rows: CatalogueRow[]): CatalogueRow[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/domain/lineup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CatalogueRow } from "./players";
import { FORMATIONS, eligible, formationName } from "./lineup";

export const row = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id,
  nickname: id,
  position: "Midfielder",
  status: "ok",
  currentValue: 1_000_000,
  seasonPoints: 10,
  averagePoints: 2.5,
  gameweeksRecorded: 4,
  ownerTeamId: "t1",
  ownerName: "Ada",
  clubName: null,
  ...over,
});

describe("FORMATIONS", () => {
  it("holds the league's seven, and only those", () => {
    expect(FORMATIONS.map(formationName)).toEqual([
      "5-4-1",
      "5-3-2",
      "4-5-1",
      "4-4-2",
      "4-3-3",
      "3-5-2",
      "3-4-3",
    ]);
  });

  it("is ten outfield players in every one, so their totals are comparable", () => {
    // The whole reason a formation's total can be ranked against another's: both are
    // eleven players, never a bigger team against a smaller one.
    for (const f of FORMATIONS) {
      expect(f.defenders + f.midfielders + f.forwards).toBe(10);
    }
  });
});

describe("eligible", () => {
  it("keeps a fit player", () => {
    expect(eligible([row("a")]).map((r) => r.id)).toEqual(["a"]);
  });

  it("drops the three statuses that make a player unfieldable", () => {
    // An optimiser that fields a suspended player has given a wrong answer, confidently.
    const rows = [
      row("hurt", { status: "injured" }),
      row("banned", { status: "suspended" }),
      row("gone", { status: "out_of_league" }),
      row("fit"),
    ];
    expect(eligible(rows).map((r) => r.id)).toEqual(["fit"]);
  });

  it("keeps a doubtful player, because doubt is a judgement and not a fact", () => {
    expect(eligible([row("maybe", { status: "doubtful" })]).map((r) => r.id)).toEqual([
      "maybe",
    ]);
  });

  it("does not disturb the caller's array", () => {
    const rows = [row("a"), row("b", { status: "injured" })];
    eligible(rows);
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/domain/lineup.test.ts`
Expected: FAIL — `Failed to resolve import "./lineup"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/domain/lineup.ts`:

```ts
import type { CatalogueRow } from "./players";

/**
 * The best eleven a squad can field, and which formation gets there.
 *
 * Pure, like every other file here: arithmetic over rows somebody else fetched.
 *
 * **This is not really a linear programming problem, although it can be written as one.**
 * Every player holds exactly one position and the constraints are "take exactly N from
 * each line", so the lines never compete for a player and the constraint matrix is
 * completely separable. Sorting each line once and taking its top N is therefore the
 * optimum itself, not an approximation — no solver, and no dependency.
 *
 * That stops being true only if some rule couples the lines, such as a cap on players
 * from one real club. The league has no such rule today; if one appears, this is the
 * reasoning to revisit.
 */

export type Formation = { defenders: number; midfielders: number; forwards: number };

const f = (defenders: number, midfielders: number, forwards: number): Formation => ({
  defenders,
  midfielders,
  forwards,
});

/**
 * The league's seven, as the owner states them.
 *
 * The goalkeeper is absent because it is always exactly one — a column that never varies
 * is noise in every row it appears in. Each formation is ten outfield players, which is
 * what makes two totals comparable: the choice is between elevens, never between a bigger
 * team and a smaller one.
 */
export const FORMATIONS: Formation[] = [
  f(5, 4, 1),
  f(5, 3, 2),
  f(4, 5, 1),
  f(4, 4, 2),
  f(4, 3, 3),
  f(3, 5, 2),
  f(3, 4, 3),
];

export const formationName = (formation: Formation): string =>
  `${formation.defenders}-${formation.midfielders}-${formation.forwards}`;

/** The statuses that make a player unfieldable. `doubtful` is deliberately not among them. */
const UNFIELDABLE = new Set(["injured", "suspended", "out_of_league"]);

/**
 * The players who could actually take the pitch.
 *
 * `injured`, `suspended` and `out_of_league` are out: an optimiser that fields a suspended
 * player has given a wrong answer, confidently, which is worse than giving none.
 *
 * `doubtful` stays. It is a judgement rather than a fact, so the player counts and the
 * view marks them — the reader decides. Measured cost of this rule on 2026-09-09: it drops
 * one manager from a single possible formation to none, and two others from seven to five
 * and five to three. That is the honest answer, not a regression.
 */
export function eligible(rows: CatalogueRow[]): CatalogueRow[] {
  return rows.filter((row) => !UNFIELDABLE.has(row.status));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/domain/lineup.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/domain/lineup.ts src/lib/domain/lineup.test.ts
git commit -m "feat: the league's formations, and who may be fielded"
```

---

### Task 2: Ranking the formations

**Files:**
- Modify: `src/lib/domain/lineup.ts`
- Test: `src/lib/domain/lineup.test.ts`

**Interfaces:**
- Consumes: `Formation`, `FORMATIONS`, `formationName`, `eligible` from Task 1.
- Produces:
  - `type LineupMetric = "points" | "average"`
  - `type Shortfall = { defenders: number; midfielders: number; forwards: number; goalkeepers: number }`
  - `type RankedFormation = { formation: Formation; name: string; total: number | null; eleven: CatalogueRow[]; shortfall: Shortfall | null }`
  - `function rankFormations(rows: CatalogueRow[], metric: LineupMetric): RankedFormation[]`
  - `function nearestFormation(ranked: RankedFormation[]): RankedFormation | null`

`total` and `eleven` are meaningful only when `shortfall` is null; a shortfall carries `total: null` and `eleven: []`. `shortfall` counts how many MORE players each line needs, so every value is `0` or greater and at least one is above zero.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/domain/lineup.test.ts`:

```ts
describe("rankFormations", () => {
  /** A squad big enough for every formation: 1 GK, 5 DF, 5 MF, 3 FW. */
  const full = [
    row("gk", { position: "Goalkeeper", seasonPoints: 20 }),
    ...[1, 2, 3, 4, 5].map((n) =>
      row(`d${n}`, { position: "Defender", seasonPoints: n * 10 }),
    ),
    ...[1, 2, 3, 4, 5].map((n) =>
      row(`m${n}`, { position: "Midfielder", seasonPoints: n * 10 }),
    ),
    ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward", seasonPoints: n * 100 })),
  ];

  it("takes the best N of each line, which is the optimum and not a guess", () => {
    const best = rankFormations(full, "points").find((r) => r.name === "3-4-3");
    expect(best?.eleven.map((p) => p.id).sort()).toEqual(
      ["d3", "d4", "d5", "f1", "f2", "f3", "gk", "m2", "m3", "m4", "m5"].sort(),
    );
  });

  it("totals the eleven it picked", () => {
    // gk 20 + defenders 50+40+30 + midfielders 50+40+30+20 + forwards 300+200+100
    const best = rankFormations(full, "points").find((r) => r.name === "3-4-3");
    expect(best?.total).toBe(880);
  });

  it("puts the highest-scoring formation first", () => {
    const ranked = rankFormations(full, "points");
    expect(ranked[0].name).toBe("3-4-3");
    expect(ranked[0].total).toBeGreaterThan(ranked[1].total ?? 0);
  });

  it("ranks by the chosen metric, so the two can disagree", () => {
    const rows = [
      row("gk", { position: "Goalkeeper", seasonPoints: 0, averagePoints: 0 }),
      // A defender who played every week for a modest return.
      ...[1, 2, 3, 4, 5].map((n) =>
        row(`d${n}`, {
          position: "Defender",
          seasonPoints: 40,
          averagePoints: 10,
          gameweeksRecorded: 4,
        }),
      ),
      ...[1, 2, 3, 4, 5].map((n) =>
        row(`m${n}`, { position: "Midfielder", seasonPoints: 1, averagePoints: 0.25 }),
      ),
      ...[1, 2, 3].map((n) =>
        row(`f${n}`, { position: "Forward", seasonPoints: 1, averagePoints: 0.25 }),
      ),
    ];
    const byPoints = rankFormations(rows, "points")[0];
    const byAverage = rankFormations(rows, "average")[0];
    // Five defenders is the best line either way here, so both pick a 5-x-x; what
    // changes is the arithmetic behind the total.
    expect(byPoints.total).toBe(202);
    expect(byAverage.total).toBeCloseTo(50.5, 5);
  });

  it("reports a per-line shortfall instead of a total when a line is short", () => {
    // Not a boolean: "no formation possible" on a normal squad reads as a broken portal.
    const thin = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
      row("m1", { position: "Midfielder" }),
      ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward" })),
    ];
    const threeFourThree = rankFormations(thin, "points").find((r) => r.name === "3-4-3");
    expect(threeFourThree?.total).toBeNull();
    expect(threeFourThree?.eleven).toEqual([]);
    expect(threeFourThree?.shortfall).toEqual({
      goalkeepers: 0,
      defenders: 0,
      midfielders: 3,
      forwards: 0,
    });
  });

  it("counts a missing goalkeeper as a shortfall of its own", () => {
    const noKeeper = [
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
      ...[1, 2, 3, 4].map((n) => row(`m${n}`, { position: "Midfielder" })),
      ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward" })),
    ];
    const ranked = rankFormations(noKeeper, "points").find((r) => r.name === "3-4-3");
    expect(ranked?.shortfall?.goalkeepers).toBe(1);
  });

  it("puts every impossible formation after every possible one", () => {
    const ranked = rankFormations(full, "points");
    const firstImpossible = ranked.findIndex((r) => r.shortfall !== null);
    const lastPossible = ranked.map((r) => r.shortfall === null).lastIndexOf(true);
    expect(lastPossible).toBeLessThan(firstImpossible === -1 ? 99 : firstImpossible);
  });

  it("leaves out a player who cannot be fielded", () => {
    const withBan = [...full, row("banned", { position: "Forward", seasonPoints: 9999, status: "suspended" })];
    const best = rankFormations(withBan, "points")[0];
    expect(best.eleven.map((p) => p.id)).not.toContain("banned");
  });

  it("breaks a tie on the name, so the eleven cannot wobble between renders", () => {
    const tied = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
      ...[1, 2, 3, 4].map((n) => row(`m${n}`, { position: "Midfielder" })),
      row("zed", { position: "Forward", seasonPoints: 5 }),
      row("abe", { position: "Forward", seasonPoints: 5 }),
      row("cid", { position: "Forward", seasonPoints: 5 }),
    ];
    const forwards = rankFormations(tied, "points")[0].eleven.filter(
      (p) => p.position === "Forward",
    );
    expect(forwards.map((p) => p.nickname)).toEqual(["abe", "cid", "zed"]);
  });

  it("sinks a player with no average rather than sorting them as zero", () => {
    // An unknown value is not a low one. A player who has never featured has no average
    // at all, and must never displace somebody who has.
    const rows = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
      ...[1, 2, 3, 4].map((n) => row(`m${n}`, { position: "Midfielder" })),
      row("never", {
        position: "Forward",
        averagePoints: null,
        seasonPoints: 0,
        gameweeksRecorded: 0,
      }),
      row("played", { position: "Forward", averagePoints: 0.1, seasonPoints: 1 }),
      row("also", { position: "Forward", averagePoints: 0.2, seasonPoints: 1 }),
    ];
    const forwards = rankFormations(rows, "average")[0].eleven.filter(
      (p) => p.position === "Forward",
    );
    expect(forwards.map((p) => p.id)).toEqual(["also", "played", "never"]);
  });

  it("returns all seven whatever the squad, so nothing vanishes silently", () => {
    expect(rankFormations([], "points")).toHaveLength(FORMATIONS.length);
  });

  it("does not disturb the caller's array", () => {
    const rows = [...full];
    rankFormations(rows, "points");
    expect(rows.map((r) => r.id)).toEqual(full.map((r) => r.id));
  });
});

describe("nearestFormation", () => {
  it("is the impossible one needing the fewest additions", () => {
    // What turns "no formation possible" into a transfer instruction.
    const thin = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3, 4, 5].map((n) => row(`d${n}`, { position: "Defender" })),
      row("m1", { position: "Midfielder" }),
      ...[1, 2, 3, 4].map((n) => row(`f${n}`, { position: "Forward" })),
    ];
    const nearest = nearestFormation(rankFormations(thin, "points"));
    // 5-3-2 needs two more midfielders; every other formation needs more than that.
    expect(nearest?.name).toBe("5-3-2");
    expect(nearest?.shortfall?.midfielders).toBe(2);
  });

  it("is null when some formation is actually possible", () => {
    const ranked = rankFormations(
      [
        row("gk", { position: "Goalkeeper" }),
        ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
        ...[1, 2, 3, 4].map((n) => row(`m${n}`, { position: "Midfielder" })),
        ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward" })),
      ],
      "points",
    );
    expect(nearestFormation(ranked)).toBeNull();
  });

  it("breaks a tie on the formation's own order, so it never wobbles", () => {
    const ranked = rankFormations([], "points");
    // An empty squad is equally far from several; the first in FORMATIONS order wins.
    expect(nearestFormation(ranked)?.name).toBe("5-4-1");
  });
});
```

Extend the import at the top of the file to:

```ts
import {
  FORMATIONS,
  eligible,
  formationName,
  nearestFormation,
  rankFormations,
} from "./lineup";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/domain/lineup.test.ts`
Expected: FAIL — `rankFormations is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/domain/lineup.ts`:

```ts
export type LineupMetric = "points" | "average";

export type Shortfall = {
  goalkeepers: number;
  defenders: number;
  midfielders: number;
  forwards: number;
};

export type RankedFormation = {
  formation: Formation;
  name: string;
  /** The eleven's total, or null when the formation cannot be fielded. */
  total: number | null;
  /** Empty when the formation cannot be fielded. */
  eleven: CatalogueRow[];
  /** Null when the formation CAN be fielded. */
  shortfall: Shortfall | null;
};

/** The line a player belongs to. One position each, which is why the lines are separable. */
const LINES = ["Goalkeeper", "Defender", "Midfielder", "Forward"] as const;

/**
 * What a player is worth under the chosen metric, or null when it is unknown.
 *
 * Null and not zero for an average nobody has: a player who has never featured has no
 * average at all, and treating the unknown as a low number would let them displace
 * somebody who has actually played. `sortCatalogue` draws the same distinction about an
 * unknown market value, and for the same reason.
 */
const valueOf = (row: CatalogueRow, metric: LineupMetric): number | null =>
  metric === "points" ? row.seasonPoints : row.averagePoints;

/**
 * Every formation, best first, with either its eleven or the reason it cannot be fielded.
 *
 * Each line is sorted ONCE and every formation then reads a prefix of it. That is not an
 * optimisation, it is the algorithm: because a player belongs to exactly one line, the
 * lines never compete, and the best N of a line is the best N of that line in every
 * formation that asks for N. Seven formations cost four sorts.
 *
 * An impossible formation carries a per-line shortfall rather than a bare `false`. "No
 * formation possible" on a squad of thirteen reads as a broken portal; "one midfielder
 * short" is a transfer instruction.
 */
export function rankFormations(
  rows: CatalogueRow[],
  metric: LineupMetric,
): RankedFormation[] {
  const fieldable = eligible(rows);

  const byLine = new Map<string, CatalogueRow[]>(
    LINES.map((line) => [
      line,
      fieldable
        .filter((row) => row.position === line)
        .sort((a, b) => {
          const left = valueOf(a, metric);
          const right = valueOf(b, metric);
          // An unknown value sinks, whichever side of the comparison it is on.
          if (left === null && right === null) return a.nickname.localeCompare(b.nickname);
          if (left === null) return 1;
          if (right === null) return -1;
          // Ties break on name so an eleven cannot wobble between renders.
          return right - left || a.nickname.localeCompare(b.nickname);
        }),
    ]),
  );

  const take = (line: string, n: number) => (byLine.get(line) ?? []).slice(0, n);
  const missing = (line: string, n: number) =>
    Math.max(0, n - (byLine.get(line) ?? []).length);

  const ranked = FORMATIONS.map((formation): RankedFormation => {
    const shortfall: Shortfall = {
      goalkeepers: missing("Goalkeeper", 1),
      defenders: missing("Defender", formation.defenders),
      midfielders: missing("Midfielder", formation.midfielders),
      forwards: missing("Forward", formation.forwards),
    };
    const short = Object.values(shortfall).some((n) => n > 0);

    if (short) {
      return { formation, name: formationName(formation), total: null, eleven: [], shortfall };
    }

    const eleven = [
      ...take("Goalkeeper", 1),
      ...take("Defender", formation.defenders),
      ...take("Midfielder", formation.midfielders),
      ...take("Forward", formation.forwards),
    ];
    // A fieldable eleven has no unknown values in it by construction: an unknown sinks,
    // so it is only ever selected when the line has nothing better, and then the total
    // would be a lie. Treat it as nought points scored, which is what it is.
    const total = eleven.reduce((sum, row) => sum + (valueOf(row, metric) ?? 0), 0);
    return { formation, name: formationName(formation), total, eleven, shortfall: null };
  });

  // Possible first by total; impossible after, in the order FORMATIONS declares them so
  // the list never reorders itself between renders.
  return ranked.sort((a, b) => {
    if (a.shortfall === null && b.shortfall === null) return (b.total ?? 0) - (a.total ?? 0);
    if (a.shortfall === null) return -1;
    if (b.shortfall === null) return 1;
    return 0;
  });
}

/** How many players a shortfall is asking for in total. */
const missingCount = (shortfall: Shortfall): number =>
  shortfall.goalkeepers + shortfall.defenders + shortfall.midfielders + shortfall.forwards;

/**
 * The impossible formation closest to being possible, or null if any is possible already.
 *
 * This is what turns "no formation possible" into something a manager can act on: the
 * cheapest route back to fielding a team. Ties keep the earlier formation, which is
 * `FORMATIONS` order, so the answer never wobbles.
 */
export function nearestFormation(ranked: RankedFormation[]): RankedFormation | null {
  if (ranked.some((r) => r.shortfall === null)) return null;
  return ranked.reduce<RankedFormation | null>((best, candidate) => {
    if (candidate.shortfall === null) return best;
    if (best?.shortfall == null) return candidate;
    return missingCount(candidate.shortfall) < missingCount(best.shortfall) ? candidate : best;
  }, null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/domain/lineup.test.ts`
Expected: PASS — all tests.

If "breaks a tie on the formation's own order" fails, check that `rankFormations` returns impossible formations in `FORMATIONS` order — the comparator returns `0` for two impossible ones, and `Array.prototype.sort` is stable in Node 24, so declaration order survives.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/domain/lineup.ts src/lib/domain/lineup.test.ts
git commit -m "feat: rank the formations a squad can field"
```

---

### Task 3: The board

**Files:**
- Create: `src/components/lineup-board.tsx`
- Test: `src/components/lineup-board.test.tsx`

**Interfaces:**
- Consumes: `RankedFormation`, `LineupMetric`, `Shortfall`, `nearestFormation` from Task 2; `statusLabel` from `@/lib/domain/players`.
- Produces: `function LineupBoard({ ranked, showing, metric, teamId, ownershipKnown }): JSX.Element`
  - `ranked: RankedFormation[]`, `showing: RankedFormation | null` (the one whose eleven to draw), `metric: LineupMetric`, `teamId: string`, `ownershipKnown: boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/components/lineup-board.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogueRow } from "@/lib/domain/players";
import { rankFormations } from "@/lib/domain/lineup";
import { LineupBoard } from "./lineup-board";

const row = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id,
  nickname: id,
  position: "Midfielder",
  status: "ok",
  currentValue: 1_000_000,
  seasonPoints: 10,
  averagePoints: 2.5,
  gameweeksRecorded: 4,
  ownerTeamId: "t1",
  ownerName: "Ada",
  clubName: null,
  ...over,
});

const full = [
  row("gk", { position: "Goalkeeper" }),
  ...[1, 2, 3, 4, 5].map((n) => row(`d${n}`, { position: "Defender" })),
  ...[1, 2, 3, 4, 5].map((n) => row(`m${n}`, { position: "Midfielder" })),
  ...[1, 2, 3].map((n) => row(`f${n}`, { position: "Forward" })),
];

const render = (rows: CatalogueRow[], ownershipKnown = true) => {
  const ranked = rankFormations(rows, "points");
  const showing = ranked.find((r) => r.shortfall === null) ?? null;
  return renderToStaticMarkup(
    <LineupBoard
      ranked={ranked}
      showing={showing}
      metric="points"
      teamId="t1"
      ownershipKnown={ownershipKnown}
    />,
  );
};

describe("LineupBoard", () => {
  it("names the formation it is showing and lists its eleven, each player linked", () => {
    const html = render(full);
    expect(html).toContain("3-4-3");
    expect(html).toContain('href="/players/gk"');
    expect(html).toContain('href="/players/f1"');
  });

  it("groups the eleven by line", () => {
    const html = render(full);
    for (const line of ["Goalkeeper", "Defender", "Midfielder", "Forward"]) {
      expect(html).toContain(line);
    }
  });

  it("lists every formation, with a link that selects it", () => {
    const html = render(full);
    expect(html).toContain("formation=4-4-2");
    expect(html).toContain("formation=5-3-2");
  });

  it("marks a doubtful player, because doubt is the reader's call", () => {
    // The score has to beat the other forwards or the tie-break would sort "iffy" last
    // and they would never reach the eleven — the test would then pass for no reason.
    const html = render([
      ...full,
      row("iffy", { position: "Forward", status: "doubtful", seasonPoints: 999 }),
    ]);
    expect(html).toContain("Doubtful");
  });

  it("marks a player whose average rests on fewer than three gameweeks", () => {
    const rows = full.map((r) =>
      r.id === "f1" ? { ...r, gameweeksRecorded: 1 } : r,
    );
    expect(render(rows)).toContain("1 gameweek");
  });

  it("says which line is short when nothing can be fielded, and names the nearest", () => {
    // "No formation possible" on a normal squad reads as a broken portal.
    const thin = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3, 4, 5].map((n) => row(`d${n}`, { position: "Defender" })),
      row("m1", { position: "Midfielder" }),
      ...[1, 2, 3, 4].map((n) => row(`f${n}`, { position: "Forward" })),
    ];
    const html = render(thin);
    expect(html).toContain("No formation");
    expect(html).toContain("5-3-2");
    expect(html).toContain("2 more midfielders");
  });

  it("says one midfielder, not 1 midfielders", () => {
    // 1 GK, 3 DF, 3 MF, 1 FW. Every formation is three players away, so the nearest is
    // the first in FORMATIONS order — 5-4-1, needing two defenders and one midfielder,
    // which exercises both the plural and the singular in one string.
    const thin = [
      row("gk", { position: "Goalkeeper" }),
      ...[1, 2, 3].map((n) => row(`d${n}`, { position: "Defender" })),
      ...[1, 2, 3].map((n) => row(`m${n}`, { position: "Midfielder" })),
      row("f1", { position: "Forward" }),
    ];
    const html = render(thin);
    expect(html).toContain("2 more defenders");
    expect(html).toContain("1 more midfielder");
    expect(html).not.toContain("1 more midfielders");
  });

  it("tells an empty squad apart from a portal that has read no squads at all", () => {
    expect(render([], false)).toContain("No squad has been read yet");
    expect(render([], true)).toContain("No formation");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/lineup-board.test.tsx`
Expected: FAIL — `Failed to resolve import "./lineup-board"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/lineup-board.tsx`:

```tsx
import Link from "next/link";
import {
  nearestFormation,
  type LineupMetric,
  type RankedFormation,
  type Shortfall,
} from "@/lib/domain/lineup";
import { statusLabel, type CatalogueRow } from "@/lib/domain/players";

/**
 * The best eleven a squad can field, and every formation ranked beside it.
 *
 * A server component: no search, no pills, no pagination, so none of these rows cross to
 * the browser — the same reasoning as `SquadList` and `OpportunityBoard`.
 *
 * The diagnosis is this board's most common output, not the podium. Measured on
 * 2026-09-09, four of thirteen managers could field nothing and four more had exactly one
 * option, so the reasons matter more than the ranking for most of the league.
 */

const LINES = ["Goalkeeper", "Defender", "Midfielder", "Forward"] as const;

const plural = (n: number, word: string) => `${n} more ${word}${n === 1 ? "" : "s"}`;

/** A shortfall in words, naming only the lines that are actually short. */
function shortfallWords(shortfall: Shortfall): string {
  const parts = [
    shortfall.goalkeepers > 0 ? plural(shortfall.goalkeepers, "goalkeeper") : null,
    shortfall.defenders > 0 ? plural(shortfall.defenders, "defender") : null,
    shortfall.midfielders > 0 ? plural(shortfall.midfielders, "midfielder") : null,
    shortfall.forwards > 0 ? plural(shortfall.forwards, "forward") : null,
  ].filter((part): part is string => part !== null);
  return parts.join(", ");
}

function Eleven({
  showing,
  metric,
}: {
  showing: RankedFormation;
  metric: LineupMetric;
}) {
  const figure = (player: CatalogueRow) =>
    metric === "points"
      ? `${player.seasonPoints} pts`
      : player.averagePoints === null
        ? "—"
        : `${player.averagePoints.toFixed(1)} avg`;

  return (
    <div className="mt-3 border-t" style={{ borderColor: "var(--board-line)" }}>
      {LINES.map((line) => {
        const players = showing.eleven.filter((p) => p.position === line);
        if (players.length === 0) return null;
        return (
          <div key={line}>
            <div
              className="px-2 py-[4px] text-[10px] uppercase tracking-[0.06em]"
              style={{ background: "var(--board-panel)", color: "var(--board-ink-dim)" }}
            >
              {line} · {players.length}
            </div>
            <ul>
              {players.map((player) => {
                const label = statusLabel(player.status);
                return (
                  <li
                    key={player.id}
                    className="grid grid-cols-[1fr_64px] items-baseline gap-2 border-b px-2 py-[6px]"
                    style={{ borderColor: "var(--board-line)" }}
                  >
                    <span className="min-w-0 truncate text-[13px]">
                      <Link
                        href={`/players/${player.id}`}
                        className="underline decoration-[var(--board-line)] underline-offset-4"
                      >
                        {player.nickname}
                      </Link>
                      {/* Doubt is a judgement, so the player counts and the reader is told. */}
                      {label === null ? null : (
                        <span className="ml-2 text-[10.5px]" style={{ color: "var(--board-alert)" }}>
                          {label}
                        </span>
                      )}
                      {/* Not a floor, a caveat: this average rests on very little. */}
                      {player.gameweeksRecorded < 3 ? (
                        <span className="ml-2 text-[10.5px]" style={{ color: "var(--board-ink-dim)" }}>
                          {player.gameweeksRecorded === 1
                            ? "1 gameweek"
                            : `${player.gameweeksRecorded} gameweeks`}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="text-right text-[12.5px] tabular-nums"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {figure(player)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function LineupBoard({
  ranked,
  showing,
  metric,
  teamId,
  ownershipKnown,
}: {
  ranked: RankedFormation[];
  showing: RankedFormation | null;
  metric: LineupMetric;
  teamId: string;
  ownershipKnown: boolean;
}) {
  if (!ownershipKnown) {
    return (
      <p className="mt-3 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        No squad has been read yet, so no lineup can be worked out. The next sweep settles
        it.
      </p>
    );
  }

  const nearest = nearestFormation(ranked);
  const best = ranked.find((r) => r.shortfall === null) ?? null;
  const href = (name: string) => `/teams/${teamId}/lineup?by=${metric}&formation=${name}`;

  return (
    <>
      {nearest === null || best !== null ? null : (
        <p className="mt-3 text-[13px]" style={{ color: "var(--board-alert)" }}>
          No formation can be fielded from this squad. The nearest is{" "}
          <strong>{nearest.name}</strong> — {shortfallWords(nearest.shortfall!)} needed.
        </p>
      )}

      {showing === null ? null : (
        <>
          <h2 className="mt-6 text-[15px] font-medium">
            {showing.name}
            <span
              className="ml-3 text-[13px] tabular-nums"
              style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
            >
              {metric === "points"
                ? `${showing.total ?? 0} pts`
                : `${(showing.total ?? 0).toFixed(1)} avg`}
            </span>
          </h2>
          <Eleven showing={showing} metric={metric} />
        </>
      )}

      <h3
        className="mt-8 text-[11px] uppercase tracking-[0.06em]"
        style={{ color: "var(--board-ink-dim)" }}
      >
        Every formation
      </h3>
      <ul className="mt-2 border-t" style={{ borderColor: "var(--board-line)" }}>
        {ranked.map((entry) => (
          <li
            key={entry.name}
            className="flex items-baseline justify-between gap-3 border-b px-2 py-[6px] text-[12.5px]"
            style={{
              borderColor: "var(--board-line)",
              background:
                entry.name === showing?.name
                  ? "color-mix(in srgb, var(--board-you) 10%, transparent)"
                  : undefined,
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)" }}>
              {entry.shortfall === null ? (
                <Link href={href(entry.name)} className="underline underline-offset-4">
                  {entry.name}
                </Link>
              ) : (
                <span style={{ color: "var(--board-ink-dim)" }}>{entry.name}</span>
              )}
            </span>
            <span
              className="text-right tabular-nums"
              style={{ fontFamily: "var(--font-mono)", color: "var(--board-ink-dim)" }}
            >
              {entry.shortfall === null
                ? metric === "points"
                  ? `${entry.total ?? 0} pts`
                  : `${(entry.total ?? 0).toFixed(1)} avg`
                : shortfallWords(entry.shortfall)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/lineup-board.test.tsx`
Expected: PASS — 8 tests.

- [ ] **Step 5: Typecheck, lint and commit**

Run these one at a time, never concurrently:

```bash
npx tsc --noEmit
npx eslint
git add src/components/lineup-board.tsx src/components/lineup-board.test.tsx
git commit -m "feat: draw the best eleven and every formation beside it"
```

---

### Task 4: The page, and the way in

**Files:**
- Create: `src/app/(portal)/teams/[id]/lineup/page.tsx`
- Modify: `src/app/(portal)/teams/[id]/page.tsx` — add the link in the squad section
- Test: `src/lib/domain/lineup.test.ts` (the parameter parsing lives in the domain so it can be tested)

**Interfaces:**
- Consumes: `rankFormations`, `LineupMetric`, `FORMATIONS`, `formationName` from Task 2; `LineupBoard` from Task 3; `loadPlayerCatalogue` and `loadSnapshots` from `@/lib/db/queries`; `buildCatalogue` from `@/lib/domain/players`; `requireSession` from `@/lib/auth/guards`; `PageHeader` from `@/components/page-header`.
- Produces:
  - `function parseMetric(raw: string | string[] | undefined): LineupMetric`
  - The route `/teams/[id]/lineup`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/domain/lineup.test.ts`:

```ts
describe("parseMetric", () => {
  it("takes the two the page offers", () => {
    expect(parseMetric("points")).toBe("points");
    expect(parseMetric("average")).toBe("average");
  });

  it("falls back to points for anything else", () => {
    // A hand-edited URL is not an exceptional condition worth a 404.
    expect(parseMetric(undefined)).toBe("points");
    expect(parseMetric("rubbish")).toBe("points");
    expect(parseMetric("")).toBe("points");
  });

  it("takes the first when the parameter is repeated", () => {
    // A repeated parameter arrives as an array; comparing the array would fall back
    // silently and the reader would never learn why.
    expect(parseMetric(["average", "points"])).toBe("average");
  });
});
```

Add `parseMetric` to the import list at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/domain/lineup.test.ts`
Expected: FAIL — `parseMetric is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/domain/lineup.ts`:

```ts
/**
 * The metric a URL is asking for.
 *
 * Anything unrecognised falls back to `points` rather than erroring: a hand-edited URL is
 * not an exceptional condition, and a 404 for `?by=banana` is a worse answer than the
 * table the reader came for. A repeated parameter arrives as an array — take the first,
 * because comparing the array itself would fall back silently.
 */
export function parseMetric(raw: string | string[] | undefined): LineupMetric {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "average" ? "average" : "points";
}
```

Create `src/app/(portal)/teams/[id]/lineup/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadPlayerCatalogue, loadSnapshots } from "@/lib/db/queries";
import { buildCatalogue } from "@/lib/domain/players";
import { parseMetric, rankFormations } from "@/lib/domain/lineup";
import { requireSession } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { LineupBoard } from "@/components/lineup-board";

/**
 * The best eleven this manager could field, and every formation ranked.
 *
 * A page of its own rather than a section on `/teams/[id]`, which already carries
 * metrics, squad, money and market. It takes no entry in the nav — `nav-links.tsx`
 * records that the destination row is already at its width at 375px — and is reached from
 * the squad section instead.
 *
 * Both choices live in the URL: the page stays a server component, a lineup is a link
 * somebody can paste into the group chat, and the back button works.
 */
export default async function LineupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireSession();
  const { id } = await params;
  const query = await searchParams;

  const { teams } = await loadSnapshots(db);
  const team = teams.find((candidate) => candidate.id === id);
  // A 404, not an empty board: an id that matches nothing is a wrong address, exactly as
  // `/teams/[id]` already decides.
  if (!team) notFound();

  const catalogue = await loadPlayerCatalogue(db);
  const squad = buildCatalogue(catalogue).filter((row) => row.ownerTeamId === id);

  const metric = parseMetric(query.by);
  const ranked = rankFormations(squad, metric);

  const askedFor = Array.isArray(query.formation) ? query.formation[0] : query.formation;
  const showing =
    ranked.find((entry) => entry.name === askedFor && entry.shortfall === null) ??
    ranked.find((entry) => entry.shortfall === null) ??
    null;

  const other = metric === "points" ? "average" : "points";

  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader
        title={`${team.managerName} — best lineup`}
        note="The highest-scoring eleven this squad can field, by formation. Injured, suspended and out-of-league players are left out; doubtful ones are counted and marked."
        meta={`${squad.length} in the squad`}
      />

      <p className="mt-2 flex items-center gap-3 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        <Link href={`/teams/${id}`} className="underline underline-offset-4">
          ← back to {team.managerName}
        </Link>
        <Link href={`/teams/${id}/lineup?by=${other}`} className="underline underline-offset-4">
          rank by {other === "points" ? "season points" : "average per gameweek"}
        </Link>
      </p>

      <LineupBoard
        ranked={ranked}
        showing={showing}
        metric={metric}
        teamId={id}
        ownershipKnown={catalogue.ownershipKnown}
      />
    </section>
  );
}
```

Then modify `src/app/(portal)/teams/[id]/page.tsx`. Find the squad section, which currently reads:

```tsx
      <h2 className="mt-10 text-[11px] uppercase tracking-[0.06em]" style={{ color: "var(--board-ink-dim)" }}>
        Their squad
      </h2>
```

Replace those three lines with:

```tsx
      <h2
        className="mt-10 flex items-baseline justify-between gap-3 text-[11px] uppercase tracking-[0.06em]"
        style={{ color: "var(--board-ink-dim)" }}
      >
        Their squad
        {/* The only way in to the lineup page. It belongs beside the squad because the
            two answer neighbouring questions — what they hold, and what they could field
            with it — and the nav bar is already at its width at 375px. */}
        <Link
          href={`/teams/${id}/lineup`}
          className="normal-case tracking-normal underline underline-offset-4"
        >
          best lineup →
        </Link>
      </h2>
```

Add `import Link from "next/link";` to the top of that file if it is not already there.

- [ ] **Step 4: Run the tests, then check the route**

Run these one at a time:

```bash
npx vitest run src/lib/domain/lineup.test.ts
npx tsc --noEmit
npx eslint
npx next build
```

Expected: all pass, and the build's route list includes `/teams/[id]/lineup`.

Then confirm the new route is guarded like every other portal page:

```bash
npx next dev &
# wait for it to answer, then:
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" "http://localhost:3000/teams/38126770/lineup"
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" "http://localhost:3000/teams/38126770/lineup?by=banana&formation=9-9-9"
pkill -f "next dev"
```

Expected: both `307 -> http://localhost:3000/login`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(portal)/teams/[id]/lineup/page.tsx" "src/app/(portal)/teams/[id]/page.tsx" src/lib/domain/lineup.ts src/lib/domain/lineup.test.ts
git commit -m "feat: a page for the best lineup, reached from the squad"
```

---

### Task 5: The whole-slice check

**Files:**
- Modify: `docs/superpowers/specs/2026-09-09-tebasfury-best-lineup-design.md` (record the outcome)

- [ ] **Step 1: Run every check, one at a time**

```bash
npx tsc --noEmit
npx vitest run
npx eslint
npx next build
```

Expected: typecheck clean, all tests pass, lint clean, build compiles. If several test files fail with `SIGKILL` or "Worker exited unexpectedly", that is this machine's OOM under concurrency — re-run `npx vitest run` alone before believing it.

- [ ] **Step 2: Check the arithmetic against production**

The optimiser's answer should be inspected against a real squad before it is trusted. Write a throwaway script in the scratchpad that reads `DATABASE_URL` from `.env.local` (strip the surrounding quotes; `@neondatabase/serverless` resolves only from the repo root; use `sql.query(text)` rather than the tagged template) and, for each manager, prints the feasible formation count and the best formation's total.

Expected, from the measurement the spec records: exactly one manager (`JMjugon`) can field all seven; four (`-papi—`, `LILTEAM`, `La rataneta`, `cristian1206`) can field none; `La rataneta`'s nearest formation is short of midfielders.

If those do not match, the domain is wrong — not the data.

- [ ] **Step 3: Record the outcome in the spec**

Append a short section to the spec saying what the live check found, in the house style of the other specs' "visual checks" sections.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-09-tebasfury-best-lineup-design.md
git commit -m "docs: record the best-lineup slice's live check"
```

---

## Notes for whoever implements this

- **The owner pushes.** `git push origin main` is the deploy trigger and only they can run it. Leave the commits on `main` and say so.
- **No migration in this slice.** If you find yourself editing `src/lib/db/schema.ts`, stop — the design says the squad comes from `loadPlayerCatalogue`, which already joins ownership.
- **The cost this slice accepts:** `/teams/[id]/lineup` reads the whole catalogue (840 players) to show one squad. `/teams/[id]` already does the same for its squad section, and the spec accepts it for the same reason — a second, narrower read path would be a second thing to keep correct.
