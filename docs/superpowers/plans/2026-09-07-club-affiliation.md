# Club Affiliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every player in the catalogue says which club they play for, and searching a club name lists its players.

**Architecture:** The club name already rides along in the squad responses the daily sweep fetches for ownership, nested under `playerMaster.team`. A new `real_teams` table accumulates the clubs actually observed — never a seeded list — and the catalogue resolves names against it in the domain layer rather than by SQL join. Zero additional API calls.

**Tech Stack:** Next.js 16.3.4 (App Router, `cacheComponents` off), React 19, Drizzle ORM on Neon HTTP in production and PGlite in tests, Zod at the API boundary, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-07-tebasfury-club-affiliation-design.md` — read it first; every ruling referenced below is argued there.

## Global Constraints

- **No transactions, no `db.batch()`.** Neon's HTTP driver has no transactions and PGlite has no `batch`. Writes are plain sequential awaits and every one must be idempotent, so a sweep that dies halfway is corrected by the next one.
- **No foreign key on `players.real_team_id`.** Ruling 2. Inside a sweep the catalogue is written before any squad is read.
- **Never seed club names.** Ruling 1. Only what a squad response actually stated is stored.
- **Zod types stay inside `lib/fantasy-client/`.** Only mapped types (`RealTeamRow`) cross the boundary.
- **Parameter budget.** Postgres caps a statement at 65,535 bound parameters, counted as `rows × columns`. `real_teams` is ~20 rows × 6 columns ≈ 120, which is why it alone needs no chunking. Re-check against `65,535 / columns` if a column is ever added.
- **UI copy is English**, as is every artefact in this repo.
- Run tests with `pnpm test` (Vitest, `vitest run`). Lint with `pnpm lint`.
- Commit after every task. Do not push — the owner pushes.

---

### Task 1: The `real_teams` table

**Files:**
- Modify: `src/lib/db/schema.ts` (append after `squadMembers`, end of file)
- Create: `drizzle/0007_*.sql` (generated — do not hand-write)
- Test: `src/lib/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `realTeams` table export from `@/lib/db/schema`, with columns `id: string`, `name: string`, `slug: string`, `badgeUrl: string | null`, `firstSeenAt: Date`, `lastSeenAt: Date`.

- [x] **Step 1: Write the failing test**

Append to `src/lib/db/schema.test.ts`. It needs its own `describe` with its own database handle, matching the file's existing structure:

```ts
describe("the club table", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
  });
  afterAll(async () => {
    await h.close();
  });

  it("stores a club keyed by the id the API gives it, with the badge nullable", async () => {
    await h.db.insert(realTeams).values({
      id: "21",
      name: "Deportivo Alavés",
      slug: "deportivo-alaves",
      badgeUrl: null,
    });
    const [row] = await h.db.select().from(realTeams);
    expect(row).toMatchObject({ id: "21", name: "Deportivo Alavés", badgeUrl: null });
    expect(row.firstSeenAt).toBeInstanceOf(Date);
    expect(row.lastSeenAt).toBeInstanceOf(Date);
  });

  it("does not constrain players to a known club", async () => {
    // Ruling 2: inside a sweep the catalogue is written BEFORE any squad is read, so
    // on the first sweep every player is written when no club is known at all. A
    // foreign key here would fail the sweep and every retry after it, for ever.
    await h.db.insert(players).values({
      id: "p1",
      nickname: "Nobody's Club",
      position: "Midfielder",
      realTeamId: "not-a-club-we-have-seen",
      status: "ok",
      imageUrl: null,
    });
    const [row] = await h.db.select().from(players).where(eq(players.id, "p1"));
    expect(row.realTeamId).toBe("not-a-club-we-have-seen");
  });
});
```

Add `realTeams` to the import list from `./schema` at the top of the file.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/db/schema.test.ts`
Expected: FAIL — `realTeams` is not exported from `./schema`.

- [x] **Step 3: Add the table to the schema**

Append to the end of `src/lib/db/schema.ts`:

```ts
/**
 * A LaLiga club, learned from `playerMaster.team` on the squad response the sweep
 * already fetches for ownership. Costs no extra API call.
 *
 * Accumulated, never seeded. A club nobody in this league owns a player from simply
 * has no row, and the views say so by omission rather than by guessing — the same
 * refusal to invent that keeps `gameweeks.opensAt` null for a backfilled week.
 *
 * Deliberately NOT the target of a foreign key from `players.real_team_id`. Inside
 * `runPlayerSweep` the catalogue is written before a single squad is read, so on the
 * first sweep all ~836 players are written at a moment when no club is known at all.
 * A foreign key would fail the whole sweep, and every retry after it, for ever — the
 * same trap `squad_members.player_id` documents from the other side.
 *
 * `slug` and `badgeUrl` are stored and rendered by nothing: they arrive in a response
 * already being parsed, so keeping them costs two columns, while recovering them
 * later would cost a migration and a full sweep.
 */
export const realTeams = pgTable("real_teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  badgeUrl: text("badge_url"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [x] **Step 4: Generate the migration**

Run: `pnpm drizzle-kit generate`

This writes `drizzle/0007_<random-name>.sql` and updates `drizzle/meta/_journal.json`. Do **not** hand-write either — the journal must stay consistent and the existing files carry generated names.

Verify the generated SQL creates the table and nothing else:

```bash
cat drizzle/0007_*.sql
```

Expected: a single `CREATE TABLE "real_teams"` with the six columns, no `ALTER TABLE` on any other table, and no foreign key.

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/lib/db/schema.test.ts`
Expected: PASS. `createTestDatabase` runs the whole `./drizzle` folder, so the new migration is applied automatically.

- [x] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/schema.test.ts drizzle/
git commit -m "feat: add the real_teams table for observed club names"
```

---

### Task 2: The client learns clubs from a squad response

**Files:**
- Modify: `src/lib/fantasy-client/schemas.ts:89-121` (the `playerEntrySchema` doc comment and `squadSchema`)
- Modify: `src/lib/fantasy-client/index.ts:289-290` (`SquadRow`) and `:331-347` (`getSquad`)
- Test: `src/lib/fantasy-client/index.test.ts` (the `"the squad mapping"` describe, around line 342)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `RealTeamRow = { id: string; name: string; slug: string; badgeUrl: string | null }` and `SquadRow = { teamId: string; playerIds: string[]; realTeams: RealTeamRow[] }`, both exported from `@/lib/fantasy-client`.

- [x] **Step 1: Write the failing tests**

Add to the `"the squad mapping"` describe in `src/lib/fantasy-client/index.test.ts`:

```ts
  it("returns the clubs named in the squad, deduplicated", async () => {
    // The committed fixture's 15 entries name 10 distinct clubs — several players
    // share one. A squad's clubs are a set, not a list parallel to its players.
    stubFetch(squadFixture, 200);
    const squad = await getSquad("at", "018012894", "9000019");
    expect(squad.realTeams).toHaveLength(10);
    expect(squad.realTeams).toContainEqual({
      id: "14",
      name: "Rayo Vallecano",
      slug: "rayo-vallecano",
      badgeUrl:
        "https://assets-fantasy.llt-services.com/teambadge/t184/color/t184_rayo-vallecano.png",
    });
  });

  it("learns no club, rather than throwing, when an entry carries no team", async () => {
    // Every entry in the one capture carries `team`, but one capture is not a
    // specification. A response that omits it must leave the club unlearned — never
    // fail the sweep for that team.
    stubFetch({ id: "9000019", players: [{ playerMaster: { id: "p1" } }] }, 200);
    const squad = await getSquad("at", "018012894", "9000019");
    expect(squad.playerIds).toEqual(["p1"]);
    expect(squad.realTeams).toEqual([]);
  });
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/fantasy-client/index.test.ts`
Expected: FAIL — `squad.realTeams` is `undefined`.

- [x] **Step 3: Describe the club at the boundary**

In `src/lib/fantasy-client/schemas.ts`, add above `squadSchema`:

```ts
/**
 * The club a player belongs to, nested under `playerMaster` on a squad response.
 *
 * `team` is OPTIONAL and that is the point: all 15 entries in the committed fixture
 * carry it, but one capture is not a specification, and a squad response that omits
 * it must leave the club unlearned rather than fail the sweep for that team.
 *
 * The response also carries `assets` and `badgeWhite`. They are deliberately not
 * described here — nothing has a use for them, and an unused field is an assumption
 * travelling for free.
 */
const squadTeamSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  slug: z.string(),
  badgeColor: z.string().nullable().optional(),
});
```

Then replace `squadSchema`'s player entry shape so `playerMaster` carries the team:

```ts
export const squadSchema = z.object({
  id: z.coerce.string(),
  players: z.array(
    z.object({
      id: z.coerce.string().optional(),
      playerMaster: z
        .object({ id: z.coerce.string(), team: squadTeamSchema.optional() })
        .optional(),
    }),
  ),
});
```

Also correct the now-false sentence in the `playerEntrySchema` doc comment. Replace:

```
 * There is no `team` object here: the catalogue names a `teamId` and nothing else, so
 * a club's NAME cannot be read from this endpoint at all.
```

with:

```
 * There is no `team` object here: the catalogue names a `teamId` and nothing else. The
 * NAME behind that id comes from the squad response instead, where `playerMaster.team`
 * carries it in the same id space — which is why club affiliation costs no extra call.
```

- [x] **Step 4: Map it across the boundary**

In `src/lib/fantasy-client/index.ts`, replace the `SquadRow` type:

```ts
/** One LaLiga club, as a squad response reveals it. */
export type RealTeamRow = {
  id: string;
  name: string;
  slug: string;
  badgeUrl: string | null;
};

/**
 * One league team's squad, as ids the portal can join on.
 *
 * `teamId` is the FANTASY team of a manager. `realTeams` are the LaLiga clubs its
 * players belong to. The two live one field apart in the same type and the collision
 * is easy to trip on — they are different id spaces entirely.
 */
export type SquadRow = { teamId: string; playerIds: string[]; realTeams: RealTeamRow[] };
```

And replace the body of `getSquad`'s return:

```ts
  const realTeams = new Map<string, RealTeamRow>();
  for (const entry of squad.players) {
    const team = entry.playerMaster?.team;
    if (team === undefined) continue;
    realTeams.set(team.id, {
      id: team.id,
      name: team.name,
      slug: team.slug,
      badgeUrl: team.badgeColor ?? null,
    });
  }

  return {
    teamId,
    playerIds: squad.players
      .map((entry) => entry.playerMaster?.id ?? entry.id)
      .filter((id): id is string => id !== undefined),
    realTeams: [...realTeams.values()],
  };
```

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/lib/fantasy-client/`
Expected: PASS, including the pre-existing assertion that no squad entry is silently dropped.

- [x] **Step 6: Commit**

```bash
git add src/lib/fantasy-client/
git commit -m "feat: read club names from the squad response"
```

---

### Task 3: The sweep persists the clubs it observes

**Files:**
- Modify: `src/lib/sync/players.ts` — imports, `PlayerSweepResult`, `runPlayerSweep`, `SquadSweepResult`, `replaceSquads`, plus a new `upsertRealTeams`
- Test: `src/lib/sync/players.test.ts`

**Interfaces:**
- Consumes: `realTeams` table (Task 1); `RealTeamRow`, `SquadRow.realTeams` (Task 2).
- Produces: `PlayerSweepResult.realTeamsKnown: number` — **the number of rows in `real_teams` after the sweep**, not the number of clubs this sweep observed.

- [x] **Step 1: Extend the test fake**

In `src/lib/sync/players.test.ts`, replace `fakeClient` and add a club helper. Existing call sites pass one or two arguments and stay untouched:

```ts
const club = (id: string, name: string): RealTeamRow => ({
  id,
  name,
  slug: name.toLowerCase().replaceAll(" ", "-"),
  badgeUrl: null,
});

function fakeClient(
  rows: PlayerRow[],
  squads: Record<string, string[]> = {},
  clubs: Record<string, RealTeamRow[]> = {},
): PlayerClient {
  return {
    getPlayers: async () => rows,
    getSquad: async (teamId: string): Promise<SquadRow> => ({
      teamId,
      playerIds: squads[teamId] ?? [],
      realTeams: clubs[teamId] ?? [],
    }),
  };
}
```

Add `RealTeamRow` to the type import from `@/lib/fantasy-client`, and `realTeams` to the schema import. Add `await h.db.delete(realTeams);` to the `beforeEach` cleanup, **before** `await h.db.delete(players);`.

- [x] **Step 2: Write the failing tests**

Add to the `runPlayerSweep` describe:

```ts
  it("writes one club row when two squads name the same club", async () => {
    await h.db.insert(teams).values([
      { id: "t1", managerId: 1, managerName: "A" },
      { id: "t2", managerId: 2, managerName: "B" },
    ]);

    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(
        catalogue(MINIMUM_CATALOGUE),
        { t1: ["p0"], t2: ["p1"] },
        { t1: [club("4", "FC Barcelona")], t2: [club("4", "FC Barcelona"), club("5", "Real Betis")] },
      ),
      now,
      runId: "s1",
      trigger: "players-manual",
    });

    const rows = await h.db.select().from(realTeams);
    expect(rows).toHaveLength(2);
    expect(result.realTeamsKnown).toBe(2);
  });

  it("refreshes a renamed club and keeps first_seen_at", async () => {
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "A" });
    const first = fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0"] }, { t1: [club("4", "Barcelona")] });
    await runPlayerSweep({ db: h.db, client: first, now, runId: "s1", trigger: "players-manual" });
    const [before] = await h.db.select().from(realTeams);

    const second = fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0"] }, { t1: [club("4", "FC Barcelona")] });
    await runPlayerSweep({ db: h.db, client: second, now: tomorrow, runId: "s2", trigger: "players-manual" });
    const [after] = await h.db.select().from(realTeams);

    expect(after.name).toBe("FC Barcelona");
    expect(after.firstSeenAt.getTime()).toBe(before.firstSeenAt.getTime());
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(before.lastSeenAt.getTime());
  });

  it("learns a club from a squad whose membership is skipped", async () => {
    // The empty-squad guard protects `first_seen_at` from a suspicious response. It is
    // not a verdict that a club NAME in that response is false — a club name is a
    // weaker claim than a membership list, not a stronger one.
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "A" });
    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0"] }, {}),
      now,
      runId: "s1",
      trigger: "players-manual",
    });

    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: [] }, { t1: [club("4", "FC Barcelona")] }),
      now: tomorrow,
      runId: "s2",
      trigger: "players-manual",
    });

    expect(result.squadsSkipped).toBe(1);
    expect(await h.db.select().from(realTeams)).toHaveLength(1);
  });

  it("reports every club known, not only the ones this sweep saw", async () => {
    // This pins the definition of realTeamsKnown. It is the accumulated total, because
    // the question it answers is "how many clubs can the catalogue name?" — and that is
    // the table the views resolve against. This assertion is what fails if someone
    // later "simplifies" it to a per-sweep count.
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "A" });
    await runPlayerSweep({
      db: h.db,
      client: fakeClient(
        catalogue(MINIMUM_CATALOGUE),
        { t1: ["p0"] },
        { t1: [club("4", "FC Barcelona"), club("5", "Real Betis"), club("6", "Celta")] },
      ),
      now,
      runId: "s1",
      trigger: "players-manual",
    });

    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0"] }, {}),
      now: tomorrow,
      runId: "s2",
      trigger: "players-manual",
    });

    expect(result.realTeamsKnown).toBe(3);
  });

  it("reports no clubs when none have ever been observed", async () => {
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "A" });
    const result = await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0"] }, {}),
      now,
      runId: "s1",
      trigger: "players-manual",
    });
    expect(result.realTeamsKnown).toBe(0);
  });
```

- [x] **Step 3: Run tests to verify they fail**

Run: `pnpm test src/lib/sync/players.test.ts`
Expected: FAIL — `result.realTeamsKnown` is `undefined` and `real_teams` stays empty.

- [x] **Step 4: Implement**

In `src/lib/sync/players.ts`:

Add `count` to the `drizzle-orm` import, `realTeams` to the schema import, and `RealTeamRow` to the type import from `@/lib/fantasy-client`.

Add to `PlayerSweepResult`:

```ts
  /**
   * How many clubs the catalogue can put a NAME to — the row count of `real_teams`
   * after this sweep, not the number of clubs this sweep happened to observe. The two
   * differ whenever a club was learned earlier and not seen today, and the accumulated
   * total is the one that answers the question actually being asked.
   *
   * Ruling 1 accepts that coverage may never reach twenty. This counter is the only
   * place that gap is visible without opening the database.
   */
  realTeamsKnown: number;
```

Add the write, next to the other upserts:

```ts
/**
 * The clubs observed this sweep, deduplicated across every squad.
 *
 * One statement, unchunked, and that is deliberate: a competition has about twenty
 * clubs, so ~20 rows × 6 columns ≈ 120 bound parameters — three orders of magnitude
 * inside Postgres's 65,535 cap. Like every other write in this file, a column added
 * here must be re-checked against `65,535 / columns`.
 *
 * `firstSeenAt` is never in the update set; `lastSeenAt` always is. Name, slug and
 * badge are overwritten, so a rebranded club's newest observation wins.
 */
async function upsertRealTeams(db: Db, clubs: RealTeamRow[], now: Date) {
  if (clubs.length === 0) return;

  await db
    .insert(realTeams)
    .values(clubs.map((c) => ({ ...c, lastSeenAt: now })))
    .onConflictDoUpdate({
      target: realTeams.id,
      set: {
        name: sql`excluded.name`,
        slug: sql`excluded.slug`,
        badgeUrl: sql`excluded.badge_url`,
        lastSeenAt: sql`excluded.last_seen_at`,
      },
    });
}
```

Widen `SquadSweepResult` and collect in `replaceSquads`:

```ts
type SquadSweepResult = {
  squadsSynced: number;
  squadsSkipped: number;
  droppedSquadPlayers: number;
  realTeams: RealTeamRow[];
};
```

Inside `replaceSquads`, declare `const clubs = new Map<string, RealTeamRow>();` beside the other counters, and immediately after `const squad = await client.getSquad(team.id);` add:

```ts
    // Clubs are learned from every response that PARSED — including one whose
    // membership the guard below then refuses. That guard protects `firstSeenAt` from
    // a suspicious response; it does not make a club name in it false.
    for (const c of squad.realTeams) clubs.set(c.id, c);
```

Return `{ squadsSynced: known.length, squadsSkipped, droppedSquadPlayers, realTeams: [...clubs.values()] }`.

In `runPlayerSweep`, after `const squads = await replaceSquads(...)`:

```ts
    await upsertRealTeams(db, squads.realTeams, now);
    const [clubCount] = await db.select({ value: count() }).from(realTeams);
```

and add `realTeamsKnown: clubCount.value,` to the returned object.

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/lib/sync/`
Expected: PASS — the five new tests plus every pre-existing sweep test.

- [x] **Step 6: Commit**

```bash
git add src/lib/sync/players.ts src/lib/sync/players.test.ts
git commit -m "feat: persist the clubs a sweep observes"
```

---

### Task 4: Reads and domain resolve the club name

**Files:**
- Modify: `src/lib/db/queries.ts` — imports, `CatalogueData`, `loadPlayerCatalogue`, `PlayerDetail`, `loadPlayer`
- Modify: `src/lib/domain/players.ts` — `CatalogueRow`, `buildCatalogue`, `filterCatalogue`, new `clubOrPosition`
- Test: `src/lib/domain/players.test.ts`, `src/lib/db/queries.test.ts`

**Interfaces:**
- Consumes: `realTeams` table (Task 1).
- Produces: `RealTeamRecord = { id: string; name: string }`; `CatalogueRow.clubName: string | null`; `buildCatalogue` gains a required `clubs: RealTeamRecord[]` input; `clubOrPosition(row): string`; `CatalogueData.clubs: RealTeamRecord[]`; `PlayerDetail.club: RealTeamRecord | null`.

- [x] **Step 1: Write the failing domain tests**

In `src/lib/domain/players.test.ts`, add `clubs` to the shared `input` object used by the `buildCatalogue` describe (the tests below assume `p1` maps to a known club and `p3` does not):

```ts
    clubs: [{ id: "rt1", name: "FC Barcelona" }],
```

The `record` helper already defaults `realTeamId` to `"rt1"`, so give `p3` an unmapped one where it is built: `record("p3", { nickname: "Cleo", position: "Goalkeeper", realTeamId: "rt9" })`.

Then add:

```ts
describe("club names on the catalogue", () => {
  const row = (over: Partial<CatalogueRow> = {}): CatalogueRow => ({
    id: "p1",
    nickname: "Ada",
    position: "Midfielder",
    status: "ok",
    currentValue: 1_000_000,
    seasonPoints: 10,
    averagePoints: 5,
    gameweeksRecorded: 2,
    ownerTeamId: null,
    ownerName: null,
    clubName: "FC Barcelona",
    ...over,
  });

  it("fills the club name from the club map and leaves it null when unmapped", () => {
    const rows = buildCatalogue({
      players: [
        { id: "p1", nickname: "Ada", position: "Midfielder", realTeamId: "rt1", status: "ok", imageUrl: null },
        { id: "p2", nickname: "Bo", position: "Forward", realTeamId: "rt9", status: "ok", imageUrl: null },
      ],
      totals: [],
      values: [],
      ownership: [],
      clubs: [{ id: "rt1", name: "FC Barcelona" }],
    });
    expect(rows[0].clubName).toBe("FC Barcelona");
    expect(rows[1].clubName).toBeNull();
  });

  it("searches the club name as well as the nickname", () => {
    const rows = [row({ id: "p1", nickname: "Ada", clubName: "Real Betis" }), row({ id: "p2", nickname: "Bo" })];
    const found = filterCatalogue(rows, { query: "betis", position: null, ownership: "all" });
    expect(found.map((r) => r.id)).toEqual(["p1"]);
  });

  it("does not match a club query against a player whose club is unknown", () => {
    const rows = [row({ clubName: null })];
    expect(filterCatalogue(rows, { query: "barcelona", position: null, ownership: "all" })).toEqual([]);
  });

  it("leads the meta line with the club, and with the position when there is none", () => {
    // Rulings 4 and 5. A plain function rather than inline JSX because
    // renderToStaticMarkup cannot drive component state — this is the only way the
    // rule is provable at all.
    expect(clubOrPosition({ clubName: "Real Betis", position: "Forward" })).toBe("Real Betis");
    expect(clubOrPosition({ clubName: null, position: "Forward" })).toBe("Forward");
  });
});
```

Add `clubOrPosition` to the imports at the top of the test file.

**Expect a wave of type errors here, and they are the point.** `src/lib/domain/players.test.ts` has no module-level `CatalogueRow` factory — the `filterCatalogue` and `sortCatalogue` describes build their rows as inline `CatalogueRow` literals (see the `oneGame` and `steady` pair around line 155). Once `clubName` joins the type, every one of those literals fails to compile until it is given a value. Add `clubName: null` to each; that is the correct default for a row whose club is beside the point of the test. The local `row()` factory above is block-scoped inside its own describe and does not clash with the file's existing `record()`.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/domain/players.test.ts`
Expected: FAIL — `clubOrPosition` is not exported and `clubName` is not on the built rows.

- [x] **Step 3: Implement the domain**

In `src/lib/domain/players.ts`:

```ts
/** A club, as the catalogue needs it. Slug and badge stay in the database — Ruling 3. */
export type RealTeamRecord = { id: string; name: string };
```

Add to `CatalogueRow`:

```ts
  /** Null when no squad response has yet named this player's club. See Ruling 1. */
  clubName: string | null;
```

In `buildCatalogue`, add `clubs: RealTeamRecord[]` to the input type, build the map beside the other three —

```ts
  const clubs = new Map(input.clubs.map((c) => [c.id, c.name]));
```

— and add `clubName: clubs.get(player.realTeamId) ?? null,` to the returned row.

Replace `filterCatalogue`'s doc comment and its name check. The current comment cites Step 3's Ruling 1 to explain why the haystack is the nickname alone; that is now false:

```ts
/**
 * Name and club, case-insensitively. The club name does not come from this endpoint —
 * it is joined in from the squad responses the sweep already fetches — so a player
 * whose club has never been observed is findable by name only.
 */
export function filterCatalogue(rows: CatalogueRow[], filter: CatalogueFilter): CatalogueRow[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (query !== "") {
      const haystack =
        row.clubName === null ? row.nickname : `${row.nickname} ${row.clubName}`;
      if (!haystack.toLowerCase().includes(query)) return false;
    }
    if (filter.position !== null && row.position !== filter.position) return false;
    if (filter.ownership === "owned" && row.ownerTeamId === null) return false;
    if (filter.ownership === "free" && row.ownerTeamId !== null) return false;
    return true;
  });
}
```

And add:

```ts
/**
 * What a catalogue row's meta line leads with: the club when it is known, the position
 * when it is not.
 *
 * Ruling 4 gave the club the position's place because position is the only one of that
 * line's four facts reachable another way — the filter pills select it and the player's
 * own page prints it — while the owner and the availability status have no second
 * route. Ruling 5 hands the slot back when there is no club to show, so no row is ever
 * left opening on the owner, and the catalogue behaves exactly as it did before on the
 * day this deploys, improving on its own as sweeps observe clubs.
 *
 * The two categories are visually unmistakable, so a reader is never misled about
 * which one a given row is showing.
 */
export function clubOrPosition(row: Pick<CatalogueRow, "clubName" | "position">): string {
  return row.clubName ?? row.position;
}
```

- [x] **Step 4: Implement the reads**

In `src/lib/db/queries.ts`, add `realTeams` to the schema import and `RealTeamRecord` to the type import from `@/lib/domain/players`.

Add to `CatalogueData`:

```ts
  /**
   * Every club observed so far — about twenty rows. Read whole and merged in
   * `buildCatalogue` rather than LEFT JOINed: `toRecord` is shared by both reads, and
   * a join would change Drizzle's row shape in both of them for the sake of a table
   * this small. `buildCatalogue` already merges three maps; this is the fourth.
   */
  clubs: RealTeamRecord[];
```

Add to `loadPlayerCatalogue`'s `Promise.all` (and to its destructuring):

```ts
    db.select({ id: realTeams.id, name: realTeams.name }).from(realTeams),
```

and return `clubs` in the object.

Add to `PlayerDetail`:

```ts
  /** This player's club, or null when no squad response has named it yet. */
  club: RealTeamRecord | null;
```

In `loadPlayer`, add to the `Promise.all` — `row` is already in scope, fetched above it — a keyed lookup, because one player needs one club and not twenty:

```ts
    db
      .select({ id: realTeams.id, name: realTeams.name })
      .from(realTeams)
      .where(eq(realTeams.id, row.realTeamId))
      .limit(1),
```

Destructure it as `clubRows` and return `club: clubRows[0] ?? null,`.

- [x] **Step 5: Add the read test**

Append to `src/lib/db/queries.test.ts` a describe with its own database handle, matching how every other describe in that file is built. Add `realTeams` to the schema import and `buildCatalogue` to the imports from `@/lib/domain/players`:

```ts
describe("club names", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    // The ids and the name are the real ones from the committed fixtures: `F. Garcés`
    // is teamId "21" in players.json, and 21 is Deportivo Alavés in squad.json. This
    // is the mapping the whole slice exists to make, checked end to end.
    await h.db.insert(realTeams).values({
      id: "21",
      name: "Deportivo Alavés",
      slug: "deportivo-alaves",
      badgeUrl: null,
    });
    await h.db.insert(players).values([
      { id: "p1", nickname: "F. Garcés", position: "Defender", realTeamId: "21", status: "ok", imageUrl: null },
      { id: "p2", nickname: "Unplaced", position: "Forward", realTeamId: "99", status: "ok", imageUrl: null },
    ]);
  });
  afterAll(async () => { await h.close(); });

  it("resolves a club id to its name, from the database through to a catalogue row", async () => {
    const { players: records, totals, values, ownership, clubs } = await loadPlayerCatalogue(h.db);
    const rows = buildCatalogue({ players: records, totals, values, ownership, clubs });

    expect(clubs).toContainEqual({ id: "21", name: "Deportivo Alavés" });
    expect(rows.find((r) => r.id === "p1")?.clubName).toBe("Deportivo Alavés");
  });

  it("leaves a player whose club has never been observed without one", async () => {
    const { players: records, totals, values, ownership, clubs } = await loadPlayerCatalogue(h.db);
    const rows = buildCatalogue({ players: records, totals, values, ownership, clubs });
    expect(rows.find((r) => r.id === "p2")?.clubName).toBeNull();
  });

  it("gives the player page its club, and null when there is none", async () => {
    expect((await loadPlayer(h.db, "p1"))?.club).toEqual({ id: "21", name: "Deportivo Alavés" });
    expect((await loadPlayer(h.db, "p2"))?.club).toBeNull();
  });
});
```

- [x] **Step 6: Fix the one remaining call site**

`src/app/(portal)/players/page.tsx:9-11` — destructure `clubs` from `loadPlayerCatalogue` and pass it through:

```tsx
  const { players, totals, values, ownership, clubs, ownershipKnown, lastSweep } =
    await loadPlayerCatalogue(db);
  const rows = buildCatalogue({ players, totals, values, ownership, clubs });
```

- [x] **Step 7: Run the whole suite**

Run: `pnpm test`
Expected: PASS. TypeScript will have flagged any `buildCatalogue` call site still missing `clubs`.

- [x] **Step 8: Commit**

```bash
git add src/lib/db/queries.ts src/lib/db/queries.test.ts src/lib/domain/players.ts src/lib/domain/players.test.ts "src/app/(portal)/players/page.tsx"
git commit -m "feat: resolve club names into the catalogue and player detail"
```

---

### Task 5: The views show the club

**Files:**
- Modify: `src/components/player-catalogue.tsx` (the meta line inside the row `<Link>`)
- Modify: `src/app/(portal)/players/[id]/page.tsx` (the header meta line)
- Test: `src/components/player-catalogue.test.tsx`

**Interfaces:**
- Consumes: `clubOrPosition`, `CatalogueRow.clubName` (Task 4); `PlayerDetail.club` (Task 4).
- Produces: nothing later tasks depend on.

- [x] **Step 1: Write the failing test**

`src/components/player-catalogue.test.tsx` already has a factory at the top of the file, `row(id, over)`, that builds a `CatalogueRow`. Add `clubName: null` to its defaults — TypeScript will demand it once Task 4 lands — and then add this test to the `PlayerCatalogue` describe:

```tsx
  it("leads a row with its club, and falls back to the position without one", () => {
    // Rulings 4 and 5: the club takes the position's place on the meta line, and hands
    // it back when no squad response has named the club yet.
    const html = renderToStaticMarkup(
      <PlayerCatalogue
        rows={[
          row("p1", { nickname: "Ada", clubName: "Real Betis", position: "Forward" }),
          row("p2", { nickname: "Bo", clubName: null, position: "Goalkeeper" }),
        ]}
        ownershipKnown
      />,
    );
    expect(html).toContain("Real Betis");
    expect(html).not.toContain("Forward");
    expect(html).toContain("Goalkeeper");
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/player-catalogue.test.tsx`
Expected: FAIL — the markup contains `Forward` and not `Real Betis`.

- [x] **Step 3: Change the catalogue meta line**

In `src/components/player-catalogue.tsx`, add `clubOrPosition` to the imports from `@/lib/domain/players`, and replace `{row.position} · <Owner ... />` with:

```tsx
                  {clubOrPosition(row)} · <Owner row={row} ownershipKnown={ownershipKnown} />
```

Nothing else in the row changes: the line keeps its `truncate`, its 11px size and its three facts, so the width behaviour verified at 320px is preserved.

- [x] **Step 4: Change the detail header**

In `src/app/(portal)/players/[id]/page.tsx`, `detail.club` is now available. The header's meta line is a 13px `<p>` that wraps freely, so it keeps the position **and** gains the club — the deliberate divergence from the catalogue argued in Ruling 4. Replace:

```tsx
        {player.position} ·{" "}
```

with:

```tsx
        {player.position}
        {detail.club === null ? "" : ` · ${detail.club.name}`} ·{" "}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [x] **Step 6: Lint and build**

Run: `pnpm lint && pnpm build`
Expected: both clean. The build is what catches a type error in a server component that Vitest never renders.

- [x] **Step 7: Commit**

```bash
git add src/components/player-catalogue.tsx src/components/player-catalogue.test.tsx "src/app/(portal)/players/[id]/page.tsx"
git commit -m "feat: show the club on the catalogue and the player page"
```

---

### Task 6: The operator surface, and the docs that have gone stale

**Files:**
- Modify: `src/app/admin/sync/actions.ts:96-115` (the trigger message)
- Modify: `src/app/api/sync/players/route.ts:46-53` (the JSON response)
- Modify: `docs/deployment.md:88-106`
- Modify: `docs/superpowers/specs/2026-09-07-tebasfury-players-slice-design.md` ("Before the next deploy", and the visual checklist)

**Interfaces:**
- Consumes: `PlayerSweepResult.realTeamsKnown` (Task 3).
- Produces: nothing.

- [ ] **Step 1: Report the count from the manual trigger**

In `src/app/admin/sync/actions.ts`, add `realTeamsKnown` to the destructuring of `outcome.result`, and change the message so it reads `Swept 836 players and 13 squads, 20 clubs known. Next sweep at …`:

```ts
    message:
      `Swept ${playersSynced} players and ${squadsSynced} squads, ` +
      `${realTeamsKnown} clubs known` +
      (notes.length > 0 ? ` (${notes.join(", ")})` : "") +
      `. Next sweep at ${nextRunAt.toISOString()}.`,
```

It is not one of the `notes`, which appear only when non-zero: club coverage is worth seeing on every sweep precisely because Ruling 1 accepts it may be incomplete, and a number that only appears when something is wrong cannot show a gap closing.

- [ ] **Step 2: Report it from the scheduled route**

In `src/app/api/sync/players/route.ts`, add to the success response body:

```ts
    realTeamsKnown: outcome.result.realTeamsKnown,
```

- [ ] **Step 3: Correct the deployment runbook**

`docs/deployment.md:90-105` states that `0003`, `0004`, `0005` and `0006` have never been applied to production. That was true when written and is not any more — the players slice is in production, swept and verified, which cannot have happened without them.

Rewrite that passage so it says: `drizzle-kit generate` still writes SQL locally and applies nothing; `0003`–`0006` **were** applied when the players slice shipped; and `0007` (the `real_teams` table) is outstanding and must be applied before this slice deploys, with the same command already documented:

```bash
DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate
```

Keep the reassurance that it is safe against a populated database, updated for `0007`: it only creates a table, adds no constraint to any existing one, and no foreign key.

- [ ] **Step 4: Correct the players spec**

In `docs/superpowers/specs/2026-09-07-tebasfury-players-slice-design.md`, replace the body of the "Before the next deploy" bullet with a note that those four migrations were applied when the slice shipped and that the item is closed, so the next reader is not sent chasing it.

In the same file, mark the "Club name is recoverable for free…" soft spot as resolved, pointing at `docs/superpowers/specs/2026-09-07-tebasfury-club-affiliation-design.md`.

Add to its visual checklist, under `/players`:

```
18. The meta line at 320px with the longest club name and a non-`ok` status — does
    anything truncate now that the club has taken the position's place?
19. A row whose club is unknown sitting next to one whose club is known — do the two
    read as different kinds of fact rather than as an inconsistency?
```

and under `/players/{id}`:

```
20. Does the header meta line wrap acceptably with four facts instead of three?
```

- [ ] **Step 5: Run the whole suite and lint**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/sync/actions.ts src/app/api/sync/players/route.ts docs/
git commit -m "feat: report club coverage, and correct two stale migration claims"
```

---

## After the last task

The slice is code-complete but **not deployed**. Deployment is the owner's call and needs, in this order:

1. `DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate` — `0007` is additive and safe against the populated database, but nothing applies it automatically.
2. `git push origin main` — the deploy trigger.
3. A manual "Sweep players" from `/admin/sync`, so club names appear before anyone loads `/players` rather than at the next daily sweep. Ruling 5 means the catalogue is not broken without it, just no better than yesterday.
4. The visual checklist items 18–20 added in Task 6, on a real device.
