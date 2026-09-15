# Breakfast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name, on the standings, whoever must bring breakfast for a round, and mark the teams a shield is protecting.

**Architecture:** One pure fold over the settled rounds works out every round's duty at once — round N depends on who brought it in N−1, N−2 and N−3, so no round can be answered alone. A line above the table says who brings it in the league's own words; the round table marks the bringers and the shielded on their rows. Nothing is stored: the rule is arithmetic over snapshots the page already loads.

**Tech Stack:** Next.js 16 App Router (server components), TypeScript, Vitest. No database change, no migration, no new query.

**Spec:** `docs/superpowers/specs/2026-09-15-tebasfury-breakfast-design.md`

## Global Constraints

- **English only**, including every UI string, comment and commit message.
- **Somebody always brings breakfast.** No code path may produce "nobody": if the walk up the table runs out of unshielded teams, the shields yield and the bottom brings it.
- **Ties come from round POINTS, never from `roundPosition`.** Measured on 2026-09-09 and recorded in `buildRoundTable`'s doc comment: the API hands tied teams distinct sequential places by a tie-break it does not publish, so a position would name one team where the rule names two.
- **Only settled rounds have a duty.** A round with any provisional row, or any `roundPosition` of null, is still being played — the same line `lastPlaced` draws in `src/lib/domain/necroporra.ts`.
- **Marks are shapes and words, never colour alone.** The amber is the reader's own team and the green is a gain; neither may be spent here.
- **TDD**: write the test, run it, watch it fail for the stated reason, then implement.
- `pnpm test` does NOT typecheck. Run `npx tsc --noEmit`, `pnpm lint` and `pnpm build` before committing. Full suite: `pnpm vitest run --maxWorkers=2`.
- Comments explain WHY in the voice of the surrounding file.
- **Stage by explicit path** (`git add src/...`), never `git add -A` — this checkout is shared with other agents.

---

### Task 1: The rule

**Files:**
- Create: `src/lib/domain/breakfast.ts`, `src/lib/domain/breakfast.test.ts`

**Interfaces:**
- Consumes: `Snapshot` from `@/lib/domain/standings`.
- Produces:
  ```ts
  export type BreakfastDuty = {
    gameweek: number;
    /** Every team that brings it — more than one only on a tie. */
    bringers: string[];
    /** Who a shield protected during this round, and for how many more rounds counting it. */
    shielded: { teamId: string; roundsLeft: number }[];
  };
  export function breakfastDuties(snapshots: Snapshot[]): BreakfastDuty[];
  export function dutyFor(duties: BreakfastDuty[], gameweek: number): BreakfastDuty | null;
  export const SHIELD_ROUNDS = 3;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { breakfastDuties, dutyFor, SHIELD_ROUNDS } from "./breakfast";
import type { Snapshot } from "./standings";

const snap = (teamId: string, gameweek: number, points: number, over: Partial<Snapshot> = {}): Snapshot => ({
  teamId,
  gameweek,
  points,
  roundPosition: 1,
  livePoints: null,
  isProvisional: false,
  teamValue: null,
  ...over,
});

/** Three teams, one round, lowest last. */
const round = (gameweek: number, points: Record<string, number>): Snapshot[] =>
  Object.entries(points).map(([teamId, p]) => snap(teamId, gameweek, p));

describe("breakfastDuties", () => {
  it("names the team with the fewest points in the round", () => {
    const duties = breakfastDuties(round(1, { a: 40, b: 30, c: 20 }));
    expect(duties).toEqual([{ gameweek: 1, bringers: ["c"], shielded: [] }]);
  });

  it("names EVERY team tied at the bottom", () => {
    // The rule's own words, and the reason this is computed from points: the API breaks
    // a tie into distinct places by a rule it does not publish, so a position would pick
    // one of these two and the league would be short a breakfast.
    const duties = breakfastDuties(round(1, { a: 40, b: 20, c: 20 }));
    expect(duties[0].bringers.slice().sort()).toEqual(["b", "c"]);
  });

  it("walks up the table past a shielded team", () => {
    // `c` brings it in round 1 and is covered in 2, 3 and 4. It finishes last again in
    // round 2, so the bag passes to whoever is lowest among the rest.
    const duties = breakfastDuties([
      ...round(1, { a: 40, b: 30, c: 20 }),
      ...round(2, { a: 40, b: 25, c: 10 }),
    ]);
    expect(duties[1]).toMatchObject({ gameweek: 2, bringers: ["b"] });
  });

  it("keeps walking while the teams above are shielded too", () => {
    const duties = breakfastDuties([
      ...round(1, { a: 40, b: 30, c: 20 }),
      ...round(2, { a: 40, b: 25, c: 10 }),
      ...round(3, { a: 40, b: 25, c: 10 }),
    ]);
    // Round 3: `c` shielded from round 1, `b` shielded from round 2, so `a` brings it
    // despite being top of the round every week.
    expect(duties[2]).toMatchObject({ gameweek: 3, bringers: ["a"] });
  });

  it("exposes a team again once its three rounds are up", () => {
    const rounds = [1, 2, 3, 4, 5].map((gw) => round(gw, { a: 40, b: 30, c: 20 })).flat();
    const duties = breakfastDuties(rounds);
    // c in 1; shielded in 2, 3 and 4; exposed again in 5.
    expect(duties.map((d) => d.bringers)).toEqual([["c"], ["b"], ["a"], ["a"], ["c"]]);
  });

  it("reports who a shield is protecting, and for how many more rounds", () => {
    const duties = breakfastDuties([
      ...round(1, { a: 40, b: 30, c: 20 }),
      ...round(2, { a: 40, b: 30, c: 20 }),
    ]);
    // In round 2, `c`'s shield still covers 2, 3 and 4 — three rounds counting this one.
    expect(duties[1].shielded).toEqual([{ teamId: "c", roundsLeft: SHIELD_ROUNDS }]);
  });

  it("yields the shield rather than letting a round pass with nobody", () => {
    // Somebody always brings breakfast. Two teams, both shielded by rounds 1 and 2, and
    // round 3 still has to name somebody — so the shields give way and the bottom brings
    // it. Impossible with thirteen teams; the rule still has no "nobody" in it.
    const duties = breakfastDuties([
      ...round(1, { a: 30, b: 20 }),
      ...round(2, { a: 20, b: 30 }),
      ...round(3, { a: 30, b: 20 }),
    ]);
    expect(duties[2].bringers).toEqual(["b"]);
  });

  it("ignores a round still being played", () => {
    // No last place exists yet: the response reports the overall position rather than a
    // rank within the round, and the points are still climbing. `lastPlaced` refuses the
    // same question in the same words.
    const live = round(2, { a: 40, b: 30, c: 20 }).map((s) => ({ ...s, roundPosition: null }));
    const duties = breakfastDuties([...round(1, { a: 40, b: 30, c: 20 }), ...live]);
    expect(duties.map((d) => d.gameweek)).toEqual([1]);
  });

  it("ignores a provisional round, which is the same claim by another name", () => {
    const provisional = round(2, { a: 40, b: 30, c: 20 }).map((s) => ({ ...s, isProvisional: true }));
    expect(breakfastDuties(provisional)).toEqual([]);
  });

  it("leaves a team with no row for the round out of it", () => {
    // Being unlisted is not the same as finishing last, and the round table already
    // treats an absent team that way.
    const duties = breakfastDuties([snap("a", 1, 40), snap("b", 1, 30)]);
    expect(duties[0].bringers).toEqual(["b"]);
  });

  it("works the rounds out oldest first, whatever order the snapshots arrive in", () => {
    const shuffled = [...round(2, { a: 40, c: 10 }), ...round(1, { a: 40, c: 20 })];
    expect(breakfastDuties(shuffled).map((d) => d.gameweek)).toEqual([1, 2]);
  });
});

describe("dutyFor", () => {
  it("finds the round asked for", () => {
    const duties = breakfastDuties(round(4, { a: 40, b: 20 }));
    expect(dutyFor(duties, 4)?.bringers).toEqual(["b"]);
  });

  it("is null for a round with no duty, which is how a live round reads", () => {
    expect(dutyFor([], 6)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/lib/domain/breakfast.test.ts`
Expected: FAIL — `breakfastDuties` is not a function.

- [ ] **Step 3: Write the rule**

`src/lib/domain/breakfast.ts`:

```ts
export const SHIELD_ROUNDS = 3;

export type BreakfastDuty = {
  gameweek: number;
  bringers: string[];
  shielded: { teamId: string; roundsLeft: number }[];
};

export function breakfastDuties(snapshots: Snapshot[]): BreakfastDuty[] {
  const gameweeks = [...new Set(snapshots.map((s) => s.gameweek))].sort((a, b) => a - b);
  // Team id to the LAST round it brought breakfast in. The shield covers the three rounds
  // after that one, so this is all the history the fold has to carry.
  const broughtIn = new Map<string, number>();
  const duties: BreakfastDuty[] = [];

  for (const gameweek of gameweeks) {
    const rows = snapshots.filter((s) => s.gameweek === gameweek);
    // The same line `lastPlaced` draws: a round with a provisional row, or one the API gave
    // no rank within, is still being played and has no last place to punish.
    if (rows.some((s) => s.isProvisional || s.roundPosition === null)) continue;

    const shielded = rows.flatMap((row) => {
      const last = broughtIn.get(row.teamId);
      if (last === undefined) return [];
      const roundsLeft = SHIELD_ROUNDS - (gameweek - last) + 1;
      return roundsLeft > 0 ? [{ teamId: row.teamId, roundsLeft }] : [];
    });

    const covered = new Set(shielded.map((s) => s.teamId));
    // Walking up the table until somebody is not shielded IS taking the lowest points
    // among the unshielded — the league says it the first way, the code says it the second.
    // And if the walk runs out of table, the shields yield: somebody always brings it.
    const candidates = rows.filter((row) => !covered.has(row.teamId));
    const eligible = candidates.length > 0 ? candidates : rows;

    const lowest = Math.min(...eligible.map((row) => row.points));
    const bringers = eligible.filter((row) => row.points === lowest).map((row) => row.teamId);

    for (const teamId of bringers) broughtIn.set(teamId, gameweek);
    duties.push({ gameweek, bringers, shielded });
  }

  return duties;
}

export function dutyFor(duties: BreakfastDuty[], gameweek: number): BreakfastDuty | null {
  return duties.find((duty) => duty.gameweek === gameweek) ?? null;
}
```

The file's doc comment must carry three things, because each is a decision somebody will
otherwise undo: that ties come from points and never from `roundPosition` (with the
measurement's date), that the shield covers the three rounds AFTER the one it was earned
in, and that the shield yields rather than let a round name nobody.

Note the `shielded` list is built from the rows of THIS round, so a team that has left the
league does not haunt it. Check the `roundsLeft` arithmetic against the test that pins it:
brought in round 1, read at round 2, three rounds left.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm vitest run src/lib/domain/breakfast.test.ts`
Expected: PASS, output pristine.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit`, `pnpm lint`.

```bash
git add src/lib/domain/breakfast.ts src/lib/domain/breakfast.test.ts
git commit -m "feat: work out who brings breakfast, round by round"
```

---

### Task 2: The sentence

**Files:**
- Create: `src/components/breakfast-line.tsx`, `src/components/breakfast-line.test.tsx`
- Modify: `src/app/(portal)/standings/page.tsx`

**Interfaces:**
- Consumes: `BreakfastDuty`, `breakfastDuties`, `dutyFor` (Task 1).
- Produces: `<BreakfastLine duty={…} gameweek={…} names={Map<string,string>} />`.

- [ ] **Step 1: Write the failing tests**

```tsx
const names = new Map([["t1", "LILTEAM"], ["t2", "TheMessias"]]);

it("names the team that brings it", () => {
  const html = renderToStaticMarkup(
    <BreakfastLine duty={{ gameweek: 5, bringers: ["t1"], shielded: [] }} gameweek={5} names={names} />,
  );
  expect(html).toContain("Round 5: LILTEAM brings breakfast.");
});

it("names every team when they tie, because every one of them brings it", () => {
  const html = renderToStaticMarkup(
    <BreakfastLine duty={{ gameweek: 5, bringers: ["t1", "t2"], shielded: [] }} gameweek={5} names={names} />,
  );
  expect(html).toContain("Round 5: LILTEAM and TheMessias bring breakfast.");
});

it("says a round is still being played rather than inventing a duty", () => {
  const html = renderToStaticMarkup(<BreakfastLine duty={null} gameweek={6} names={names} />);
  expect(html).toContain("Round 6 is still being played.");
});

it("falls back to the id rather than printing an empty name", () => {
  const html = renderToStaticMarkup(
    <BreakfastLine duty={{ gameweek: 5, bringers: ["gone"], shielded: [] }} gameweek={5} names={names} />,
  );
  expect(html).toContain("gone");
});
```

Three or more names read "A, B and C" — write that test too, with the list built from three ids.

- [ ] **Step 2: Run and watch fail**, then write the component, then run and watch pass.

Run: `pnpm vitest run src/components/breakfast-line.test.tsx`

A server component. The sentence is the whole of it: no card, no icon, one line in the board's voice, sitting above the table it describes.

- [ ] **Step 3: Mount it twice on the standings page**

In `src/app/(portal)/standings/page.tsx`:

```tsx
const duties = breakfastDuties(snapshots);
const names = new Map(teams.map((team) => [team.id, team.managerName]));
// The season view answers the question the league actually asks on a Monday — who is
// bringing it — for the most recent round that has one. The round view answers it for the
// round being read.
const latest = duties.at(-1) ?? null;
```

Above the season table: `<BreakfastLine duty={latest} gameweek={latest?.gameweek ?? played.at(-1) ?? 0} names={names} />`, and above the round table: `<BreakfastLine duty={dutyFor(duties, round)} gameweek={round} names={names} />`.

A league with no settled round at all shows the live-round sentence, which is true and needs no special case.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit`, `pnpm vitest run --maxWorkers=2`, `pnpm lint`, `pnpm build`.

```bash
git add src/components/breakfast-line.tsx src/components/breakfast-line.test.tsx "src/app/(portal)/standings/page.tsx"
git commit -m "feat: say who brings breakfast, on the standings"
```

---

### Task 3: The marks on the round table

**Files:**
- Modify: `src/components/round-table.tsx`, `src/components/round-table.test.tsx`
- Modify: `src/app/(portal)/standings/page.tsx` (pass the duty down)

**Interfaces:**
- Consumes: `BreakfastDuty` (Task 1).
- Produces: `<RoundTable … duty={BreakfastDuty | null} />`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("marks the team bringing breakfast, in a word and not only a colour", () => {
  const html = render({ duty: { gameweek: 4, bringers: ["t3"], shielded: [] } });
  expect(html).toMatch(/brings breakfast/i);
});

it("marks a shielded team, and says how many rounds it has left", () => {
  // The reader is looking at the bottom of the table wondering why the last-placed team
  // is not the one named. The mark is the answer.
  const html = render({ duty: { gameweek: 4, bringers: ["t2"], shielded: [{ teamId: "t3", roundsLeft: 2 }] } });
  expect(html).toContain("shielded");
  expect(html).toContain("2");
});

it("spends neither the amber nor the green on these marks", () => {
  // The amber is the reader's own team and the green is a gain. A third meaning would
  // empty both of theirs.
  const html = render({ duty: { gameweek: 4, bringers: ["t3"], shielded: [{ teamId: "t2", roundsLeft: 1 }] } });
  expect(html).not.toContain("var(--board-you)");
  expect(html).not.toContain("var(--board-gain)");
});

it("draws the table unchanged when there is no duty", () => {
  expect(render({ duty: null })).not.toMatch(/breakfast|shielded/i);
});
```

The existing `render` helper in that file takes rows; extend it to take the duty rather than writing a second one. **Its existing assertions about places, points and the "you" marker must keep passing untouched** — if one has to change, say why in the report.

- [ ] **Step 2: Run and watch fail**, then implement, then run and watch pass.

Run: `pnpm vitest run src/components/round-table.test.tsx`

Careful with the row: it is a three-column grid (`24px_1fr_52px`) and the manager name already carries the "you" marker. Put the breakfast and shield marks where the clause marks go — after the name, outside any truncation — and keep the row a single line at 375px.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit`, `pnpm vitest run --maxWorkers=2`, `pnpm lint`, `pnpm build`.

```bash
git add src/components/round-table.tsx src/components/round-table.test.tsx "src/app/(portal)/standings/page.tsx"
git commit -m "feat: mark who brings breakfast and who a shield is covering"
```

---

### Task 4: Walk it against the real league

No database change ships with this, so there is nothing to migrate and nothing to backfill: the rule is arithmetic over five rounds already in the table.

- [ ] **Step 1: Check the rule against the real rounds**

With the production `DATABASE_URL`, list each settled round's lowest scorers:

```sql
select gameweek, team_id, points from team_gameweek_stats
where gameweek in (select gameweek from gameweeks where is_live = false)
order by gameweek, points asc;
```

Work the first three rounds through by hand and compare them with what `/standings?round=N` says. The rounds this league has played contain at least one tie at the bottom — the ties are the whole reason the rule reads from points — so check one of those specifically.

- [ ] **Step 2: Walk the page**

1. `/standings` names whoever brings it for the most recent settled round.
2. `/standings?round=1` names the same team the SQL above says, and that team carries the mark.
3. A later round shows a shielded team marked, with the rounds it has left, and the bag passed to somebody else.
4. The live round says it is still being played rather than naming anybody.
5. At 375px the marked rows stay on one line.

- [ ] **Step 3: Hand it over**

`git push origin main`. No migration, no sweep, no admin step: the page computes it on read.

## Notes for the executor

- **Nothing is stored.** If a task starts wanting a table, stop and ask — the rule is a fold over snapshots the page already has.
- **No round may name nobody.** The shield yields first.
- **`roundPosition` is not the rule.** Points are.
