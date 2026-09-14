# Round Lineups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show what each manager actually fielded in a round, on `/teams/[id]`, for every round that has started.

**Architecture:** The player sweep gains a second walk of the thirteen teams, calling `/v1/competition/1/teams/{teamId}/lineup/week/{week}` for every week that has a `gameweeks` row. A settled week is fetched once and stored; the live one is refetched while its points still climb. Two tables hold it — one row per lineup, eleven per lineup — and a section under the squad draws it behind the `RoundPicker` the rest of the portal already uses.

**Tech Stack:** Next.js 16 App Router, Drizzle on Neon (no transactions — sequential idempotent writes), Zod for every API shape, Vitest + PGlite, fixtures captured from the live API.

**Spec:** `docs/superpowers/specs/2026-09-14-tebasfury-round-lineups-design.md`

## Global Constraints

- **English only**, including UI strings, comments and commit messages.
- **No transactions.** Every write is a single idempotent statement; a sweep that dies halfway is corrected by the next one.
- **The API is undocumented and unofficial.** Every field it sends is `optional()` in the schema unless losing it should stop the sweep. Thirteen extra calls per week is the budget agreed; do not add a fourteenth call per team.
- **A week with no `gameweeks` row is never asked for.** That is the league's ruling about unplayed rounds, and it is enforced by the query that chooses weeks, not by a flag somebody has to remember.
- **TDD.** Write the test, run it, watch it fail for the stated reason, then implement.
- **`pnpm test` does not typecheck**; `npx tsc --noEmit` and `pnpm build` do. The suite needs `--maxWorkers=2` on a machine short of memory.
- **Migrations:** `drizzle-kit generate` stops to ask when a diff both adds and removes — keep each generate purely additive. `drizzle-kit migrate` **exits 1 with an empty stderr and applies nothing**; see the memory note. Verify the schema after applying, always.

---

### Task 1: The client can read one lineup

**Files:**
- Create: `scripts/capture-lineup-fixture.mts`, `src/lib/fantasy-client/__fixtures__/lineup-week.json`
- Modify: `src/lib/fantasy-client/schemas.ts`, `src/lib/fantasy-client/schemas.test.ts`
- Modify: `src/lib/fantasy-client/index.ts`, `src/lib/fantasy-client/index.test.ts`

**Interfaces:**
- Consumes: `apiGet`, `COMPETITION` (both already in `index.ts`).
- Produces: `getLineup(accessToken, teamId, week): Promise<LineupRow>` where
  `LineupRow = { teamId: string; gameweek: number; formation: string; points: number; snapshotTookOn: Date; players: FieldedPlayer[] }`
  and `FieldedPlayer = { playerId: string; line: "goalkeeper" | "defender" | "midfield" | "striker"; weekPoints: number; inIdeal: boolean }`.

- [ ] **Step 1: Capture a real response to test against**

Create `scripts/capture-lineup-fixture.mts`, copying the shape of `capture-players-fixture.mts` — including its env dance, which is not optional:

```ts
// `@/lib/db` calls `getEnv()` at module load and static imports hoist above every
// statement, so the environment is loaded first and the app's modules imported after it.
process.loadEnvFile(".env.local");

const { db } = await import("@/lib/db");
const { getAccessToken } = await import("@/lib/fantasy-client");
const { teams } = await import("@/lib/db/schema");

const BASE = "https://fantasy-api.llt-services.com/api";
const token = await getAccessToken(db);
const [team] = await db.select({ id: teams.id }).from(teams).limit(1);

const res = await fetch(`${BASE}/v1/competition/1/teams/${team.id}/lineup/week/4`, {
  headers: { authorization: `Bearer ${token}`, accept: "application/json" },
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const body = await res.json();

// `lastStats` is 90% of the payload and nothing reads it. Dropped from the fixture so the
// file stays readable, and NOT from the schema, which must keep tolerating it.
for (const line of ["goalkeeper", "defender", "midfield", "striker"]) {
  for (const player of body.formation[line] ?? []) delete player.playerMaster?.lastStats;
}
writeFileSync(
  "src/lib/fantasy-client/__fixtures__/lineup-week.json",
  `${JSON.stringify(body, null, 2)}\n`,
);
```

Run: `node --import ./scripts/register-alias.mjs scripts/capture-lineup-fixture.mts`

- [ ] **Step 2: Write the failing schema test**

In `src/lib/fantasy-client/schemas.test.ts`, beside the others:

```ts
import lineupWeek from "./__fixtures__/lineup-week.json";

describe("lineupSchema", () => {
  it("parses a real week's lineup", () => {
    const parsed = lineupSchema.parse(lineupWeek);
    expect(parsed.formation.tacticalFormation).toMatch(/^\d(-\d)+$/);
    expect(parsed.formation.goalkeeper).toHaveLength(1);
  });

  it("survives a player whose extras are missing", () => {
    // Thirteen of these are parsed per week. A missing `isInIdealFormation` must cost one
    // mark, never the sweep — the same ruling `squadSchema` already makes for the clause.
    const thin = {
      formation: {
        tacticalFormation: "1-4-4-2",
        goalkeeper: [{ playerMaster: { id: 1, weekPoints: 4 } }],
        defender: [],
        midfield: [],
        striker: [],
      },
      points: 0,
      teamSnapshotTookOn: "2026-09-03T19:03:47+02:00",
    };
    expect(() => lineupSchema.parse(thin)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run src/lib/fantasy-client/schemas.test.ts`
Expected: FAIL — `lineupSchema` is not exported.

- [ ] **Step 4: Write the schema**

In `schemas.ts`:

```ts
const fieldedPlayerSchema = z.object({
  playerMaster: z
    .object({
      id: z.coerce.string(),
      /** What they scored that round. Optional like every extra: a missing figure costs
       *  one player's points, not the thirteen lineups being read beside it. */
      weekPoints: z.coerce.number().optional(),
      /** Whether they made the round's ideal eleven. Free from the API, and the one
       *  detail here nothing else in the portal can work out. */
      isInIdealFormation: z.boolean().optional(),
    })
    .optional(),
});

export const lineupSchema = z.object({
  formation: z.object({
    tacticalFormation: z.string(),
    goalkeeper: z.array(fieldedPlayerSchema).default([]),
    defender: z.array(fieldedPlayerSchema).default([]),
    midfield: z.array(fieldedPlayerSchema).default([]),
    striker: z.array(fieldedPlayerSchema).default([]),
  }),
  points: z.coerce.number().default(0),
  teamSnapshotTookOn: z.coerce.date(),
});
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm vitest run src/lib/fantasy-client/schemas.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing client test**

In `src/lib/fantasy-client/index.test.ts`, following how the other endpoints are tested there (a stubbed `fetch` answering the fixture):

```ts
it("reads a week's lineup as a flat eleven", async () => {
  const lineup = await getLineup("token", "38127827", 4);

  expect(lineup).toMatchObject({ teamId: "38127827", gameweek: 4 });
  expect(lineup.formation).toMatch(/^\d(-\d)+$/);
  expect(lineup.players).toHaveLength(11);
  expect(lineup.players.filter((p) => p.line === "goalkeeper")).toHaveLength(1);
  // The line each player was fielded in is the shape of the pitch, and it is the one
  // thing the flat list would lose.
  expect(new Set(lineup.players.map((p) => p.line))).toEqual(
    new Set(["goalkeeper", "defender", "midfield", "striker"]),
  );
});

it("drops a fielded player the API named without an id, and keeps the rest", async () => {
  // Same tolerance `getSquad` applies: one unusable row costs one slot on the pitch and
  // not the lineup, and certainly not the twelve teams read after it.
  stubFetch({
    formation: {
      tacticalFormation: "1-4-4-2",
      goalkeeper: [{ playerMaster: { id: 1, weekPoints: 6 } }],
      defender: [{ playerMaster: { weekPoints: 2 } }],
      midfield: [],
      striker: [],
    },
    points: 8,
    teamSnapshotTookOn: "2026-09-03T19:03:47+02:00",
  });

  const lineup = await getLineup("token", "38127827", 4);

  expect(lineup.players).toHaveLength(1);
  expect(lineup.players[0]).toMatchObject({ playerId: "1", line: "goalkeeper" });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm vitest run src/lib/fantasy-client/index.test.ts`
Expected: FAIL — `getLineup` is not a function.

- [ ] **Step 8: Write `getLineup`**

In `index.ts`, beside `getSquad`:

```ts
const LINES = ["goalkeeper", "defender", "midfield", "striker"] as const;

/**
 * What one team fielded in one round.
 *
 * `/lineup/week/{week}`, and never plain `/lineup`: that one is a 403 for every team, and
 * rightly — it is the private, editable lineup. The week endpoint is the public record of
 * what was put out, and it answers for all thirteen teams.
 *
 * The four lines are flattened into one list that carries its own line, because that is
 * how the rows are stored and drawn; the shape of the pitch survives as a column.
 */
export async function getLineup(
  accessToken: string,
  teamId: string,
  week: number,
): Promise<LineupRow> {
  const lineup = await apiGet(
    accessToken,
    `/v1/competition/${COMPETITION}/teams/${teamId}/lineup/week/${week}`,
    lineupSchema,
  );

  return {
    teamId,
    gameweek: week,
    formation: lineup.formation.tacticalFormation,
    points: lineup.points,
    snapshotTookOn: lineup.teamSnapshotTookOn,
    players: LINES.flatMap((line) =>
      lineup.formation[line].flatMap((entry) => {
        const playerId = entry.playerMaster?.id;
        if (playerId === undefined) return [];
        return [
          {
            playerId,
            line,
            weekPoints: entry.playerMaster?.weekPoints ?? 0,
            inIdeal: entry.playerMaster?.isInIdealFormation ?? false,
          },
        ];
      }),
    ),
  };
}
```

Add `getLineup` to the `FantasyClient` interface and to what `createClient` returns, bound to the access token the same way `getSquad` is.

- [ ] **Step 9: Run it and watch it pass**

Run: `pnpm vitest run src/lib/fantasy-client`
Expected: PASS.

- [ ] **Step 10: Verify and commit**

Run: `npx tsc --noEmit`, `pnpm lint`.

```bash
git add -A
git commit -m "feat: the client can read what a team fielded in a round"
```

---

### Task 2: Two tables to keep it in

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle/00NN_round_lineups.sql` (+ its snapshot)
- Modify: `docs/deployment.md`

**Interfaces:**
- Produces: `roundLineups` and `roundLineupPlayers` tables.

- [ ] **Step 1: Add both tables to the schema**

```ts
/**
 * What one team fielded in one round.
 *
 * `gameweek` deliberately references nothing, exactly as `necroporra_votes` and
 * `player_gameweek_points` do: the cadence that writes this must not be able to fail the
 * cadence that writes `gameweeks`.
 *
 * A row exists only for a round that has STARTED. The API answers for the round to come —
 * a rival's intended eleven, before kickoff — and the league ruled that the portal does not
 * show what the official app refuses to. The rule lives in the query that picks weeks to
 * fetch, and this table simply never receives one.
 */
export const roundLineups = pgTable(
  "round_lineups",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    gameweek: integer("gameweek").notNull(),
    /** The label the client builds from the API's `tacticalFormation` array: `[5,3,2]`
     *  becomes "1-5-3-2". Stored as the label rather than the array because every reader
     *  of it wants the words, and the goalkeeper is implied by the endpoint, not optional. */
    formation: text("formation").notNull(),
    points: integer("points").notNull(),
    /** When the lineup froze. A reader comparing two managers needs to know both are
     *  frozen, and a live round's snapshot is what says so. */
    snapshotTookOn: timestamp("snapshot_took_on", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.gameweek] })],
);

/**
 * The eleven, one row each.
 *
 * `weekPoints` is STORED rather than joined from `player_gameweek_points`, for the reason
 * `market_operations` stores what a sale made: it is what was true of that round, and a
 * row that carries its own figures cannot be rewritten by a correction elsewhere.
 */
export const roundLineupPlayers = pgTable(
  "round_lineup_players",
  {
    teamId: text("team_id").notNull(),
    gameweek: integer("gameweek").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    /** Which line they were fielded in: the shape of the pitch, kept per row. */
    line: text("line").notNull(),
    weekPoints: integer("week_points").notNull(),
    inIdeal: boolean("in_ideal").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.gameweek, table.playerId] })],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm drizzle-kit generate --name round_lineups`

Purely additive — two new tables — so it asks nothing. Read the SQL before going further: it should be two `CREATE TABLE`s and their foreign keys, and **nothing else**. If any other table appears in it, stop: something in the schema drifted, and shipping it blind is how `squad_members` nearly got a column nobody asked for.

- [ ] **Step 3: Prove it applies**

Run: `pnpm vitest run src/lib/db/queries.test.ts`
Expected: PASS. Every integration test builds its database from `drizzle/`, so a migration that does not apply turns them red.

- [ ] **Step 4: Write the deployment note**

Add to `docs/deployment.md`, after the `0013`/`0014` section:

```markdown
### `00NN` — the round lineups, and it can go in either order

Two new tables, `round_lineups` and `round_lineup_players`. It drops nothing and alters
nothing, so the order does not matter: the code reads empty tables until the first sweep
fills them, and the sweep writes nothing anywhere the tables do not exist yet.

The first sweep after the deploy backfills every started week — thirteen calls per week,
once — so expect that run to take noticeably longer than the ones after it.
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: two tables for what each team fielded"
```

---

### Task 3: The sweep captures them

**Files:**
- Create: `src/lib/sync/lineups.ts`, `src/lib/sync/lineups.test.ts`
- Modify: `src/lib/sync/players.ts`, `src/lib/sync/players.test.ts`
- Modify: `src/lib/db/queries.ts`, `src/lib/db/queries.test.ts`

**Interfaces:**
- Consumes: `getLineup` (Task 1), both tables (Task 2).
- Produces: `captureLineups(db, client, { now }): Promise<{ captured: number; skipped: number; failed: number }>`; `loadStoredLineupWeeks(db): Promise<Set<string>>` keyed `"teamId:gameweek"`.

- [ ] **Step 1: Write the failing tests for which weeks get asked for**

In `src/lib/sync/lineups.test.ts`, with a fake client that records its calls:

```ts
it("asks only for weeks that have started", async () => {
  // The league's ruling, enforced where it cannot be forgotten: `gameweeks` gets a row
  // when a week goes live, so a week with no row is a week nobody may see yet.
  await h.db.insert(gameweeks).values([
    { number: 4, isLive: false },
    { number: 5, isLive: true },
  ]);
  await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Ana" });

  const client = fakeClient();
  await captureLineups(h.db, client, { now: NOW });

  expect(client.asked).toEqual([
    { teamId: "t1", week: 4 },
    { teamId: "t1", week: 5 },
  ]);
});

it("asks once for a settled week and never again", async () => {
  // A frozen lineup cannot change, and thirteen calls a week against an unofficial API
  // are the whole budget of this feature.
  await h.db.insert(gameweeks).values([
    { number: 4, isLive: false },
    { number: 5, isLive: true },
  ]);
  await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Ana" });

  const first = fakeClient();
  await captureLineups(h.db, first, { now: NOW });
  const second = fakeClient();
  const counts = await captureLineups(h.db, second, { now: NOW });

  expect(second.asked).toEqual([{ teamId: "t1", week: 5 }]);
  expect(counts).toMatchObject({ captured: 1, skipped: 1 });
});

it("asks again for the live week, because its points are still climbing", async () => {
  await h.db.insert(gameweeks).values({ number: 5, isLive: true });
  await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Ana" });

  await captureLineups(h.db, fakeClient({ points: 12 }), { now: NOW });
  await captureLineups(h.db, fakeClient({ points: 48 }), { now: NOW });

  const [stored] = await h.db.select().from(roundLineups);
  expect(stored.points).toBe(48);
});

it("replaces the eleven rather than adding to it", async () => {
  // The one place a stale row could survive: an upsert keyed on the player leaves behind
  // anybody who was dropped from the lineup between two fetches of a live round.
  await h.db.insert(gameweeks).values({ number: 5, isLive: true });
  await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Ana" });

  await captureLineups(h.db, fakeClient({ playerIds: ["p1", "p2"] }), { now: NOW });
  await captureLineups(h.db, fakeClient({ playerIds: ["p1", "p3"] }), { now: NOW });

  const rows = await h.db.select().from(roundLineupPlayers);
  expect(rows.map((r) => r.playerId).sort()).toEqual(["p1", "p3"]);
});

it("keeps the other twelve when one team's lineup fails", async () => {
  // Deliberately NOT the ruling `getActivity` gets. A lost lineup costs a page section
  // and the next sweep asks again; a lost market operation is gone for good, because the
  // feed's window will have rolled past it.
  await h.db.insert(gameweeks).values({ number: 5, isLive: true });
  await h.db.insert(teams).values([
    { id: "t1", managerId: 1, managerName: "Ana" },
    { id: "t2", managerId: 2, managerName: "Bruno" },
  ]);

  const client = fakeClient({ failFor: "t1" });
  const counts = await captureLineups(h.db, client, { now: NOW });

  expect(counts).toMatchObject({ captured: 1, failed: 1 });
  expect(await h.db.select().from(roundLineups)).toHaveLength(1);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/lib/sync/lineups.test.ts`
Expected: FAIL — `captureLineups` is not a function.

- [ ] **Step 3: Write `captureLineups`**

`src/lib/sync/lineups.ts`: read the started weeks from `gameweeks` (every row, with `isLive`), read every team, read what is already stored, then for each missing pair — and for the live week whatever is stored — call `client.getLineup`, upsert the lineup row and replace its eleven. Each write is its own statement, `onConflictDoUpdate` for the lineup and delete-then-insert per (team, week) for the players **in that order**, because eleven rows for one lineup is the one place a stale row could survive an upsert.

One team's failure is caught, counted and skipped; the function never throws.

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm vitest run src/lib/sync/lineups.test.ts`
Expected: PASS.

- [ ] **Step 5: Hang it on the sweep**

In `runPlayerSweep`, after `upsertOperations`, add:

```ts
// Lineups are the sweep's one tolerated failure besides none: `captureLineups` never
// throws, because a missing lineup costs a page section and the next sweep asks again.
// The market log above is the opposite ruling for the opposite reason.
const lineups = await captureLineups(db, client, { now });
```

and carry `lineupsCaptured`, `lineupsSkipped` and `lineupsFailed` in `PlayerSweepResult`. Extend `players.test.ts`'s fake client with `getLineup` so the existing sweep tests keep passing, and add one asserting the counts reach the result.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit`, `pnpm vitest run --maxWorkers=2`, `pnpm lint`, `pnpm build`.

```bash
git add -A
git commit -m "feat: the sweep records what every manager fielded"
```

---

### Task 4: The pitch on the manager's page

**Files:**
- Create: `src/components/round-lineup.tsx`, `src/components/round-lineup.test.tsx`
- Modify: `src/lib/db/queries.ts`, `src/lib/db/queries.test.ts`
- Modify: `src/app/(portal)/teams/[id]/page.tsx`

**Interfaces:**
- Consumes: both tables (Task 2).
- Produces: `loadRoundLineup(db, { teamId, gameweek })`; `loadLineupWeeks(db, { teamId })` for the picker.

- [ ] **Step 1: Write the failing query tests**

In `queries.test.ts`: the lineup comes back with its eleven in line order (goalkeeper, defender, midfield, striker) and each player's name from `players`; a round with nothing stored comes back null; `loadLineupWeeks` lists only the weeks this team has a lineup for, newest first.

- [ ] **Step 2: Run and watch fail**, then write both queries, then run and watch pass.

Run: `pnpm vitest run src/lib/db/queries.test.ts`

- [ ] **Step 3: Write the failing component tests**

`round-lineup.test.tsx`, rendered with `renderToStaticMarkup` like every component here.
The fixture and the first test in full; the rest follow its shape:

```tsx
const player = (over: Partial<FieldedRow> = {}): FieldedRow => ({
  playerId: "p1",
  nickname: "Courtois",
  line: "goalkeeper",
  weekPoints: 7,
  inIdeal: false,
  ...over,
});

const lineup = (over: Partial<RoundLineup> = {}): RoundLineup => ({
  gameweek: 4,
  formation: "1-4-4-2",
  points: 54,
  snapshotTookOn: new Date("2026-09-03T17:03:47Z"),
  players: [player(), player({ playerId: "p2", nickname: "Carvajal", line: "defender" })],
  ...over,
});

it("draws the lines in the order they stand on a pitch", () => {
  const html = renderToStaticMarkup(<RoundLineup lineup={lineup()} />);
  expect(html.indexOf("Courtois")).toBeLessThan(html.indexOf("Carvajal"));
});

it("gives each player their points for that round", () => {
  expect(renderToStaticMarkup(<RoundLineup lineup={lineup()} />)).toContain("7");
});

it("marks whoever made the round's ideal eleven, in a shape and a word", () => {
  // Never colour alone: the amber is the reader's own team and the green is a gain, and
  // a third meaning would empty both of theirs.
  const html = renderToStaticMarkup(
    <RoundLineup lineup={lineup({ players: [player({ inIdeal: true })] })} />,
  );
  expect(html).toContain("ideal eleven");
});

it("says a round has no lineup rather than drawing an empty pitch", () => {
  const html = renderToStaticMarkup(<RoundLineup lineup={null} />);
  expect(html).toContain("No lineup");
  expect(html).not.toContain("1-4-4-2");
});

it("names when the lineup froze, so two managers can be compared fairly", () => {
  expect(renderToStaticMarkup(<RoundLineup lineup={lineup()} />)).toContain("03 Sep");
});
```

- [ ] **Step 4: Run and watch fail**, then write `RoundLineup`, then run and watch pass.

A server component — no state, no search — like `SquadList` and `OpportunityBoard`. Four lines, each a row of players with `nickname`, `weekPoints` and the ideal mark; the formation string and the round's points at the top; the frozen-at line at the bottom.

- [ ] **Step 5: Wire the section into the page**

In `src/app/(portal)/teams/[id]/page.tsx`: read `?round=` from `searchParams` the way `/standings` and `/necroporra` do, default to the newest week with a lineup, and render `RoundPicker` (`basePath={/teams/${id}}`, `legend="Round"`, `allLabel={null}`) above `RoundLineup`. A team with no lineups at all gets one line saying so, not a picker with nothing in it.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit`, `pnpm vitest run --maxWorkers=2`, `pnpm lint`, `pnpm build`.

```bash
git add -A
git commit -m "feat: what a manager fielded, round by round"
```

---

### Task 5: Walk it, then ship it

- [ ] **Step 1: Apply the migration and verify it landed**

The owner runs it; `drizzle-kit migrate` lies, so the check is not optional:

```bash
DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate
```

```sql
select table_name from information_schema.tables
where table_name in ('round_lineups', 'round_lineup_players');
```

Both must be listed. If they are not, apply the file's statements by hand and record the
migration — the memory note on drizzle-kit carries the recipe.

- [ ] **Step 2: Deploy, then watch the first sweep**

It backfills every started week: thirteen calls per week, once. Press "Sweep players" on
`/admin/sync` rather than waiting six hours, then:

```sql
select gameweek, count(*) as teams, sum(points) as points
from round_lineups group by gameweek order by gameweek;
```

Thirteen teams per started week, and no row for a week that has not started.

- [ ] **Step 3: Walk the page**

1. `/teams/[id]` shows the newest started round's eleven, in four lines.
2. The picker moves between rounds and the eleven changes with it.
3. A player who made the ideal eleven carries the mark; the points add up to the round's total.
4. The week that has NOT started is absent from the picker — this is the ruling, and it is the check that matters most.
5. A second manager's page shows their eleven, not the first one's.

## Notes for the executor

- **Thirteen calls per week is the budget.** If a task starts wanting a second call per team, stop and ask.
- **Never fetch a week without a `gameweeks` row.** It is the league's ruling, not an optimisation.
- **`drizzle-kit migrate` exits 1 with an empty stderr and applies nothing.** Verify the schema after applying, every time.
