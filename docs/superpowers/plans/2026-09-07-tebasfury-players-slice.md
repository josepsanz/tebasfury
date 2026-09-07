# TebasFury Step 3 — Players and market values: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the league can look up any player, see what they cost and what they score, and watch both move over the season.

**Architecture:** One call — `GET …/players` — returns every eligible player with their current market value and their points for every gameweek played, so there is no per-player sweep. Points are backfilled from that array; market value has no history in the API and is therefore accumulated forward, one dated snapshot a day. Ownership costs thirteen more calls, one per team. All of it runs on a **second, daily cadence** that is separate from the ten-minute standings chain: same credential exchange, same `sync_runs` row shape, its own endpoint and its own self-scheduling chain.

**Tech Stack:** Next.js 16.3, Drizzle 0.45 over Neon, better-auth 1.7, Zod 4, Upstash QStash, Recharts 2.15, Vitest 5 with PGlite, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-07-tebasfury-players-slice-design.md`

## Global Constraints

- The portal is named **TebasFury**, capital F.
- **Everything is written in English** — documentation, comments, test names, commit messages and every user-visible string.
- Node 24, pnpm 11. All dependencies pinned to exact versions (`-E`). **This slice adds no dependency.**
- TypeScript `strict`. No explicit `any` in production code.
- **`pnpm test` must keep running with no environment variables, no `.env.local` and no network.** Every test in this plan obeys that.
- **Never `db.transaction()` and never `db.batch()`.** `transaction` works in tests and fails in production; `batch` exists only on `NeonHttpDatabase`, so it works in production and fails in every test. A **multi-row `INSERT … VALUES (…), (…) ON CONFLICT`** is neither of those — it is one statement and one round trip — and this slice depends on it (see Task 3).
- **Nothing outside `lib/fantasy-client/` may know the API's shape.** The client returns domain rows. This is not stylistic: a raw entry crossing that boundary unexamined is what made Step 2's standings show the wrong leader.
- **Store what is measured, derive what is computed.** Points per gameweek are stored per gameweek; season totals and averages are derived. Market value is a dated snapshot, never an overwritten "current value" column.
- Type every database parameter as `PgDatabase<PgQueryResultHKT, typeof schema>` from `drizzle-orm/pg-core`. The `Database` type exported from `@/lib/db` is a `NeonHttpDatabase` and will not compile against the PGlite instance the tests use.
- No secrets in the repository. The captured fixture is public data — player names are public, unlike the manager nicknames Step 2 had to scrub.
- **No opportunity view.** The data all three candidate views need gets built; none of the views do. That is a decision, not an omission.

## File structure

| File | Responsibility |
|---|---|
| `scripts/register-alias.mjs`, `scripts/alias-hook.mjs` | Let a `.mts` script import `@/…` modules under plain `node` |
| `scripts/capture-players-fixture.mts` | Capture `/players` and one squad through the real client, verify the shape, commit a trimmed slice |
| `src/lib/fantasy-client/__fixtures__/players.json`, `squad.json` | Real captured responses, trimmed, pinning the shape |
| `src/lib/fantasy-client/schemas.ts` | Gains `playerEntrySchema`, `playersSchema`, `squadSchema` |
| `src/lib/fantasy-client/index.ts` | Gains `getPlayers()` and `getSquad()`, both returning domain rows |
| `src/lib/db/schema.ts` | Gains `players`, `player_gameweek_points`, `player_value_snapshots`, `squad_members` |
| `src/lib/sync/failure.ts` | `describeFailure`, extracted so both cadences record a `CredentialError` by name |
| `src/lib/sync/players.ts` | The daily sweep: catalogue, value snapshot, points backfill, squads |
| `src/lib/sync/next-run.ts` | Gains the daily cadence's two intervals |
| `src/lib/sync/scheduled-run.ts` | Generic over the run's result, so both cadences share the rebooking |
| `src/lib/scheduler/index.ts` | Gains `schedulePlayerSweep` |
| `src/app/api/sync/players/route.ts` | The endpoint QStash calls once a day |
| `src/lib/domain/players.ts` | **Pure.** Catalogue rows, filtering, sorting, both series, points per million |
| `src/lib/db/queries.ts` | Gains `loadPlayerCatalogue` and `loadPlayer` |
| `src/components/player-catalogue.tsx` | The catalogue, client-side: filter, sort, cap |
| `src/components/player-charts.tsx` | The two charts, client-side |
| `src/app/(portal)/players/page.tsx` | The catalogue |
| `src/app/(portal)/players/[id]/page.tsx` | One player |

---

### Task 1: The `/players` and squad responses, captured and mapped

**Files:**
- Create: `scripts/alias-hook.mjs`, `scripts/register-alias.mjs`, `scripts/capture-players-fixture.mts`
- Create: `src/lib/fantasy-client/__fixtures__/players.json`, `src/lib/fantasy-client/__fixtures__/squad.json`
- Modify: `src/lib/fantasy-client/schemas.ts`, `src/lib/fantasy-client/schemas.test.ts`
- Modify: `src/lib/fantasy-client/index.ts`, `src/lib/fantasy-client/index.test.ts`
- Modify: `src/lib/sync/index.test.ts` (its fake client must satisfy the widened `FantasyClient`)

**Interfaces:**
- Consumes: `getAccessToken(db)`, `request`/`apiGet` and `API_BASE`/`COMPETITION` inside `src/lib/fantasy-client/index.ts`.
- Produces:
  - `playerEntrySchema`, `playersSchema`, `squadSchema` — Zod schemas, internal to the directory.
  - `type PlayerRow = { id: string; nickname: string; position: string; realTeamId: string; realTeamName: string | null; status: string; imageUrl: string | null; marketValue: number; weekPoints: number[] }`
  - `type SquadRow = { teamId: string; playerIds: string[] }`
  - `getPlayers(accessToken: string): Promise<PlayerRow[]>`
  - `getSquad(accessToken: string, leagueId: string, teamId: string): Promise<SquadRow>`
  - `FantasyClient` gains `getPlayers(): Promise<PlayerRow[]>` and `getSquad(teamId: string): Promise<SquadRow>`.

- [ ] **Step 1: Write the loader hook that lets a script import `@/…`**

A capture script has to go through `getAccessToken(db)` — the refresh token rotates on
every use and that function is the only thing that persists the rotation. Exchanging it
by hand would invalidate the stored credential and cost someone a browser bootstrap.
But `getAccessToken` lives in TypeScript behind the `@/` alias, and plain `node`
resolves neither. Node 24 strips types on its own; these twelve lines add the alias.

`scripts/alias-hook.mjs`:

```js
// Node 24 runs .ts and .mts directly, but it resolves neither the `@/` alias from
// tsconfig nor the extensionless relative specifiers TypeScript allows. This hook
// adds both, so `scripts/*.mts` can import the application's own modules instead of
// re-implementing them. It is used by scripts only — never by the app or the tests.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url).href;

function withExtension(url) {
  if (/\.[cm]?[jt]sx?$/.test(url)) return url;
  for (const candidate of [`${url}.ts`, `${url}/index.ts`, `${url}.tsx`]) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return url;
}

export function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    return next(withExtension(`${SRC}${specifier.slice(2)}`), context);
  }
  if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts")) {
    return next(withExtension(new URL(specifier, context.parentURL).href), context);
  }
  return next(specifier, context);
}
```

`scripts/register-alias.mjs`:

```js
import { register } from "node:module";

register("./alias-hook.mjs", import.meta.url);
```

- [ ] **Step 2: Write the capture script**

`scripts/capture-players-fixture.mts`:

```ts
/**
 * Captures the two responses this slice is built on, straight from the live API.
 *
 * Run it with the alias hook:
 *
 *   node --import ./scripts/register-alias.mjs scripts/capture-players-fixture.mts
 *
 * It needs a `.env.local` whose DATABASE_URL points at a database that already holds
 * a bootstrapped LaLiga credential (bootstrap one at /admin/sync first), and the
 * matching CREDENTIALS_KEY. It goes through `getAccessToken`, which persists the
 * rotated refresh token — exchanging the token by hand would invalidate the stored
 * one and cost someone a browser bootstrap.
 *
 * It writes a TRIMMED slice of the catalogue: six hundred players is a large fixture,
 * and the slice keeps one player for every distinct position and every distinct
 * status, so the committed file still carries the whole shape.
 */
import { writeFileSync } from "node:fs";

// `@/lib/db` calls `getEnv()` at module load, and static imports are hoisted above
// every statement in the file — so the environment has to be loaded first and the
// application's modules imported dynamically, after it.
process.loadEnvFile(".env.local");

const { db } = await import("@/lib/db");
const { getAccessToken } = await import("@/lib/fantasy-client");
const { playersSchema, squadSchema } = await import("@/lib/fantasy-client/schemas");
const { teams } = await import("@/lib/db/schema");

const BASE = "https://fantasy-api.llt-services.com/api";
const LEAGUE = process.env.LALIGA_LEAGUE_ID;
if (!LEAGUE) throw new Error("LALIGA_LEAGUE_ID must be set in .env.local");

const token = await getAccessToken(db);

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}: ${text.slice(0, 300)}`);
  console.log(`${path} → HTTP ${res.status}, ${text.length} bytes`);
  return JSON.parse(text);
}

const rawPlayers = await get(`/v1/competition/1/players`);

// Parsed BEFORE trimming, so a shape mismatch fails here against all six hundred
// entries rather than silently against the dozen that get committed.
const players = playersSchema.parse(rawPlayers);
console.log(`parsed ${players.length} players`);
console.log("distinct positionId:", [...new Set(players.map((p) => p.positionId))].sort());
console.log("distinct playerStatus:", [...new Set(players.map((p) => p.playerStatus))].sort());
console.log(
  "weekPoints lengths:",
  [...new Set(players.map((p) => p.weekPoints.length))].sort((a, b) => a - b),
);
const disagreeing = players.filter(
  (p) => p.weekPoints.reduce((sum, w) => sum + w, 0) !== p.points,
);
console.log(`players whose weekPoints do not sum to points: ${disagreeing.length}`);

// One entry per distinct position and per distinct status, deduplicated by id.
const wanted = new Map<string, unknown>();
const entries = rawPlayers as Record<string, unknown>[];
for (const key of ["positionId", "playerStatus"]) {
  const seen = new Set<unknown>();
  for (const [i, parsed] of players.entries()) {
    const value = key === "positionId" ? parsed.positionId : parsed.playerStatus;
    if (seen.has(value)) continue;
    seen.add(value);
    wanted.set(parsed.id, entries[i]);
  }
}

writeFileSync(
  "src/lib/fantasy-client/__fixtures__/players.json",
  `${JSON.stringify([...wanted.values()], null, 2)}\n`,
);
console.log(`wrote ${wanted.size} players to the fixture`);

const [team] = await db.select().from(teams).limit(1);
if (!team) throw new Error("No team is stored yet — run a standings sync first");

const rawSquad = await get(`/v1/competition/1/leagues/${LEAGUE}/teams/${team.id}`);
const squad = squadSchema.parse(rawSquad);
console.log(`parsed a squad of ${squad.players.length} players`);
writeFileSync(
  "src/lib/fantasy-client/__fixtures__/squad.json",
  `${JSON.stringify(rawSquad, null, 2)}\n`,
);
```

- [ ] **Step 3: Write the schemas the capture will be judged against**

These are written from the probe recorded in the spec. **The capture is the truth**: if
step 5 fails, change the schema to match what came back, and say so in the commit —
do not loosen a field to make the parse pass.

In `src/lib/fantasy-client/schemas.ts`, add:

```ts
/**
 * A player as the catalogue endpoint reports them.
 *
 * `marketValue` is CURRENT state — the same trap as `teamValue` on the standing
 * endpoint. There is no market-value history anywhere in this API; it can only be
 * accumulated forward, which is why the sync writes a dated snapshot rather than a
 * column it overwrites.
 *
 * `weekPoints` is the reason no per-player call is needed: it carries the points for
 * every gameweek played so far, for every player, in one response.
 *
 * Ids are coerced to strings. Team ids arrive as strings on the standing endpoint and
 * the columns are `text` either way, so coercion here costs nothing and survives the
 * catalogue reporting them as numbers.
 */
export const playerEntrySchema = z.object({
  id: z.coerce.string(),
  nickname: z.string(),
  positionId: z.coerce.number(),
  playerStatus: z.string(),
  marketValue: z.number(),
  points: z.number(),
  averagePoints: z.number(),
  lastSeasonPoints: z.number().nullable().optional(),
  weekPoints: z.array(z.number()),
  image: z.string().nullable().optional(),
  teamId: z.coerce.string(),
  team: z.object({ id: z.coerce.string(), name: z.string() }).optional(),
});

export const playersSchema = z.array(playerEntrySchema);

/**
 * One league team's squad. The entries nest the catalogue player under
 * `playerMaster` in every response seen so far, but a flat `id` is accepted too —
 * and `getSquad`'s test asserts that no entry is silently dropped, so a third shape
 * fails loudly instead of quietly shrinking a squad.
 */
export const squadSchema = z.object({
  id: z.coerce.string(),
  players: z.array(
    z.object({
      id: z.coerce.string().optional(),
      playerMaster: z.object({ id: z.coerce.string() }).optional(),
    }),
  ),
});

export type PlayerEntry = z.infer<typeof playerEntrySchema>;
export type Squad = z.infer<typeof squadSchema>;
```

`PlayerEntry` and `Squad` join `StandingEntry` and `CurrentWeek` under the note already
at the bottom of that file: they are internal to `lib/fantasy-client/`.

- [ ] **Step 4: Bootstrap a credential if the database has none**

The script needs a stored credential. If `/admin/sync` says none is stored, follow
"Bootstrap the LaLiga credential" in `docs/deployment.md` and store one, then run a
standings sync so `teams` has the thirteen rows the squad capture reads.

- [ ] **Step 5: Capture**

Run: `node --import ./scripts/register-alias.mjs scripts/capture-players-fixture.mts`

Expected: two HTTP 200s, a parsed count in the hundreds, and two fixture files written.

Read the printed summary before moving on — three lines of it decide code below:

- **`distinct positionId`** must be a subset of `{1,2,3,4,5}`. If a sixth appears, add
  it to `POSITIONS` in step 6 with the right label.
- **`distinct playerStatus`** is why `players.status` is a string and not an enum.
  Record the values seen in the commit message; do not turn them into a union type.
- **`players whose weekPoints do not sum to points`** must be `0`. That equality is the
  evidence that `weekPoints[i]` is gameweek `i + 1`'s score, which is the assumption
  the entire points backfill rests on. **If it is not 0, stop and re-read the fixture**:
  the array is probably objects, or offset, and the mapping in step 6 is wrong.

- [ ] **Step 6: Write the failing mapping tests**

In `src/lib/fantasy-client/index.test.ts`, add the fixture imports beside the existing
ones:

```ts
import playersFixture from "./__fixtures__/players.json";
import squadFixture from "./__fixtures__/squad.json";
```

and a new describe block:

```ts
describe("the players mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps every captured player into a domain row", async () => {
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");
    expect(rows).toHaveLength(playersFixture.length);
    expect(rows.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
    expect(rows.every((r) => typeof r.nickname === "string")).toBe(true);
  });

  it("names the position rather than handing on the API's id", async () => {
    // A number is not something a catalogue can print. The map lives in the client
    // because deciding what a field MEANS is this directory's whole job. An id the
    // map does not know falls through as a digit, and this is what catches it.
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");
    expect(rows.every((r) => /^[A-Za-z]/.test(r.position))).toBe(true);
  });

  it("keeps the API's own word for availability", async () => {
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");
    const statuses = new Set(playersFixture.map((p) => p.playerStatus));
    expect(new Set(rows.map((r) => r.status))).toEqual(statuses);
  });

  it("carries the per-gameweek points through untouched", async () => {
    // The backfill reads weekPoints[i] as gameweek i+1. The sum identity is the
    // evidence for that reading, and it is pinned here so a shape change breaks a
    // test rather than a season's history.
    stubFetch(playersFixture, 200);
    const rows = await getPlayers("at");
    for (const [i, row] of rows.entries()) {
      expect(row.weekPoints).toEqual(playersFixture[i].weekPoints);
      expect(row.weekPoints.reduce((s, w) => s + w, 0)).toBe(playersFixture[i].points);
    }
  });

  it("asks the competition's catalogue endpoint", async () => {
    const fetchMock = stubFetch(playersFixture, 200);
    await getPlayers("at");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/competition\/1\/players$/);
  });

  it("throws when the response no longer matches the schema", async () => {
    stubFetch([{ unexpected: true }], 200);
    await expect(getPlayers("at")).rejects.toThrowError();
  });
});

describe("the squad mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns one player id per squad entry, dropping none", async () => {
    // Dropping an entry would quietly shrink a squad and make an owned player look
    // free, so the count is asserted rather than the ids alone.
    stubFetch(squadFixture, 200);
    const squad = await getSquad("at", "018012894", "9000019");
    expect(squad.playerIds).toHaveLength(squadFixture.players.length);
    expect(squad.playerIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(squad.teamId).toBe("9000019");
  });

  it("asks for the team inside the league", async () => {
    const fetchMock = stubFetch(squadFixture, 200);
    await getSquad("at", "018012894", "9000019");
    expect(fetchMock.mock.calls[0][0]).toContain("/leagues/018012894/teams/9000019");
  });
});
```

Add `getPlayers` and `getSquad` to the import from `./index` at the top of the file.

- [ ] **Step 7: Run them and watch them fail**

Run: `pnpm test src/lib/fantasy-client/index.test.ts`
Expected: FAIL — `getPlayers is not a function`.

- [ ] **Step 8: Write the mapping**

In `src/lib/fantasy-client/index.ts`, import the two new schemas and their types, then add:

```ts
/**
 * The API numbers positions; a catalogue prints words. An unrecognised id falls back
 * to the number as a string rather than to "unknown", because the number is a fact
 * and "unknown" is not.
 */
const POSITIONS: Record<number, string> = {
  1: "Goalkeeper",
  2: "Defender",
  3: "Midfielder",
  4: "Forward",
  5: "Coach",
};

/**
 * A player, as the portal models it.
 *
 * `marketValue` is the value AT THE MOMENT OF THE CALL — there is no history in the
 * API, so the sync stamps it with a date and appends. `weekPoints` is the points for
 * every gameweek played so far, gameweek 1 first; it is the reason this slice needs
 * no per-player call at all.
 *
 * `status` is the API's own word. We have seen `ok`; guessing the rest would be
 * inventing a vocabulary, so it stays a string all the way into the column.
 */
export type PlayerRow = {
  id: string;
  nickname: string;
  position: string;
  realTeamId: string;
  realTeamName: string | null;
  status: string;
  imageUrl: string | null;
  marketValue: number;
  weekPoints: number[];
};

/** One league team's squad, as ids the portal can join on. */
export type SquadRow = { teamId: string; playerIds: string[] };

function toPlayerRow(entry: PlayerEntry): PlayerRow {
  return {
    id: entry.id,
    nickname: entry.nickname,
    position: POSITIONS[entry.positionId] ?? String(entry.positionId),
    realTeamId: entry.team?.id ?? entry.teamId,
    realTeamName: entry.team?.name ?? null,
    status: entry.playerStatus,
    imageUrl: entry.image ?? null,
    marketValue: entry.marketValue,
    weekPoints: entry.weekPoints,
  };
}

/**
 * The whole eligible catalogue, in one call.
 *
 * Unlike `getStanding` this does not hand back the undecoded body: the sweep does not
 * archive it. One catalogue response is around a megabyte, a daily cadence would put
 * thirty of them in `raw_sync_payloads`, and the shape is already pinned by the
 * committed fixture. A shape change surfaces as a Zod error naming the field.
 */
export async function getPlayers(accessToken: string): Promise<PlayerRow[]> {
  const entries = await apiGet(
    accessToken,
    `/v1/competition/${COMPETITION}/players`,
    playersSchema,
  );
  return entries.map(toPlayerRow);
}

export async function getSquad(
  accessToken: string,
  leagueId: string,
  teamId: string,
): Promise<SquadRow> {
  const squad = await apiGet(
    accessToken,
    `/v1/competition/${COMPETITION}/leagues/${leagueId}/teams/${teamId}`,
    squadSchema,
  );
  return {
    teamId,
    playerIds: squad.players
      .map((entry) => entry.playerMaster?.id ?? entry.id)
      .filter((id): id is string => id !== undefined),
  };
}
```

Widen the client surface and bind the two new calls:

```ts
/** The narrow surface a sync run needs, in mapped rows rather than API entries. */
export type FantasyClient = {
  getCurrentWeek(): Promise<Gameweek>;
  getStanding(week?: number): Promise<Standing>;
  getPlayers(): Promise<PlayerRow[]>;
  getSquad(teamId: string): Promise<SquadRow>;
};

/** Exchanges the credential once and binds it, so one run means one token exchange. */
export async function createClient(db: Db, leagueId: string): Promise<FantasyClient> {
  const accessToken = await getAccessToken(db);
  return {
    getCurrentWeek: () => getCurrentWeek(accessToken),
    getStanding: (week) => getStanding(accessToken, leagueId, week),
    getPlayers: () => getPlayers(accessToken),
    getSquad: (teamId) => getSquad(accessToken, leagueId, teamId),
  };
}
```

- [ ] **Step 9: Repair the standings fake, which no longer satisfies `FantasyClient`**

Widening the type breaks `fakeClient` in `src/lib/sync/index.test.ts` at compile time.
Give it the two new methods; the standings sync never calls them:

```ts
    // The standings sync never reaches for these two. They are here because both
    // cadences share one client, so the type carries all four calls.
    getPlayers: async () => [],
    getSquad: async (teamId: string) => ({ teamId, playerIds: [] }),
```

- [ ] **Step 10: Add the schema test against the captured responses**

In `src/lib/fantasy-client/schemas.test.ts`:

```ts
import playersFixture from "./__fixtures__/players.json";
import squadFixture from "./__fixtures__/squad.json";
import { playersSchema, squadSchema } from "./schemas";

describe("the players schemas parse the real captured responses", () => {
  it("parses the catalogue", () => {
    const parsed = playersSchema.parse(playersFixture);
    expect(parsed.length).toBe(playersFixture.length);
    expect(parsed[0].nickname.length).toBeGreaterThan(0);
  });

  it("keeps every captured position inside the mapped range", () => {
    // A position the map does not know would reach a view as a bare number.
    const parsed = playersSchema.parse(playersFixture);
    expect(parsed.every((p) => p.positionId >= 1 && p.positionId <= 5)).toBe(true);
  });

  it("parses a squad", () => {
    const parsed = squadSchema.parse(squadFixture);
    expect(parsed.players.length).toBeGreaterThan(0);
  });
});
```

Merge the imports with whatever that file already imports rather than repeating them.

- [ ] **Step 11: Run everything and watch it pass**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: read the player catalogue and league squads

One call returns every eligible player with their current market value and
their points for every gameweek played, so the 600-call sweep the spike warned
about is not needed and GET .../player/{id}/league/{id} stays unused.

The mapping pins the one assumption the whole points history rests on: that
weekPoints[i] is gameweek i+1's score. The evidence is that the array sums to
the season total for every player in the capture, and the test asserts it, so a
shape change breaks a test rather than a season.

Positions are named here because deciding what a field means is this
directory's job. Availability keeps the API's own word: we have seen one value
and inventing the rest would be inventing a vocabulary."
```

---

### Task 2: The four tables

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/schema.test.ts`
- Create: `drizzle/0005_*.sql` (generated)

**Interfaces:**
- Consumes: `teams` from the existing schema.
- Produces: `players`, `playerGameweekPoints`, `playerValueSnapshots`, `squadMembers` — Drizzle tables exported from `@/lib/db/schema`.

- [ ] **Step 1: Write the failing schema test**

In `src/lib/db/schema.test.ts`, add a new describe block at the end:

```ts
describe("the players schema", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Manager A" });
    await h.db.insert(players).values({
      id: "p1",
      nickname: "A Player",
      position: "Midfielder",
      realTeamId: "rt1",
      realTeamName: "A Club",
      status: "ok",
      imageUrl: "https://example.test/p1.png",
    });
  });
  afterAll(async () => {
    await h.close();
  });

  it("stores a player keyed by the id the API gives it", async () => {
    const [row] = await h.db.select().from(players);
    expect(row).toMatchObject({ id: "p1", nickname: "A Player", status: "ok" });
    expect(row.firstSeenAt).toBeInstanceOf(Date);
  });

  it("keeps one points row per player per gameweek", async () => {
    await h.db.insert(playerGameweekPoints).values({ playerId: "p1", gameweek: 1, points: 7 });
    await h.db
      .insert(playerGameweekPoints)
      .values({ playerId: "p1", gameweek: 1, points: 9 })
      .onConflictDoUpdate({
        target: [playerGameweekPoints.playerId, playerGameweekPoints.gameweek],
        set: { points: 9 },
      });

    const rows = await h.db.select().from(playerGameweekPoints);
    expect(rows).toHaveLength(1);
    expect(rows[0].points).toBe(9);
  });

  it("records a value snapshot per day, not per sweep", async () => {
    // The date primary key is what makes a second sweep on the same day idempotent.
    await h.db
      .insert(playerValueSnapshots)
      .values({ playerId: "p1", takenOn: "2026-09-07", value: 12_400_000 });
    await h.db
      .insert(playerValueSnapshots)
      .values({ playerId: "p1", takenOn: "2026-09-07", value: 12_500_000 })
      .onConflictDoUpdate({
        target: [playerValueSnapshots.playerId, playerValueSnapshots.takenOn],
        set: { value: 12_500_000 },
      });
    await h.db
      .insert(playerValueSnapshots)
      .values({ playerId: "p1", takenOn: "2026-09-08", value: 12_600_000 });

    const rows = await h.db.select().from(playerValueSnapshots);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.takenOn === "2026-09-07")?.value).toBe(12_500_000);
  });

  it("stores squad membership as current state, keyed by team and player", async () => {
    await h.db.insert(squadMembers).values({ teamId: "t1", playerId: "p1" });
    const [row] = await h.db.select().from(squadMembers);
    expect(row).toMatchObject({ teamId: "t1", playerId: "p1" });
    expect(row.firstSeenAt).toBeInstanceOf(Date);
  });
});
```

Add `players`, `playerGameweekPoints`, `playerValueSnapshots`, `squadMembers` to the
import from `./schema` at the top of the file.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test src/lib/db/schema.test.ts`
Expected: FAIL — the four tables are not exported.

- [ ] **Step 3: Add the tables**

In `src/lib/db/schema.ts`, add `date` to the `drizzle-orm/pg-core` import and append:

```ts
/**
 * The eligible player catalogue.
 *
 * `status` holds the API's own string rather than an enum. We have seen one value
 * (`ok`) and guessing the rest would be inventing a vocabulary; a lookup table can
 * come later, when the real values are known.
 *
 * `realTeamName` is nullable because the club's name is only present when the
 * catalogue nests a team object. The id is always there; the name is what a view can
 * print, and a view that cannot print it shows nothing rather than an id.
 *
 * `lastSeenAt` is how a player who leaves the competition is told apart from one who
 * is simply not in a squad: the row stays, and its age says so.
 */
export const players = pgTable("players", {
  id: text("id").primaryKey(),
  nickname: text("nickname").notNull(),
  position: text("position").notNull(),
  realTeamId: text("real_team_id").notNull(),
  realTeamName: text("real_team_name"),
  status: text("status").notNull(),
  imageUrl: text("image_url"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Points for one player in one gameweek — backfilled from `weekPoints` on the first
 * sweep, extended by every sweep after it.
 *
 * `gameweek` deliberately does NOT reference `gameweeks.number`. The two cadences are
 * independent: a player sweep must not fail because the standings chain has not
 * recorded a week yet, and the catalogue's own points are truthful without it.
 */
export const playerGameweekPoints = pgTable(
  "player_gameweek_points",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    gameweek: integer("gameweek").notNull(),
    points: integer("points").notNull(),
  },
  (table) => [primaryKey({ columns: [table.playerId, table.gameweek] })],
);

/**
 * One market value, on one day.
 *
 * The API has no value history — `marketValue` is current state, the same trap as
 * team value — so the series can only be accumulated forward. `takenOn` is a DATE and
 * not a timestamp on purpose: one snapshot a day is the resolution the daily cadence
 * can honestly claim, and the primary key is what makes a second sweep on the same
 * day correct the day's reading rather than duplicate it.
 */
export const playerValueSnapshots = pgTable(
  "player_value_snapshots",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    takenOn: date("taken_on", { mode: "string" }).notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.playerId, table.takenOn] })],
);

/**
 * Who owns whom, right now.
 *
 * This is current state, replaced each sweep — NOT an event log. The fair-play slice
 * will read the activity endpoint for transfers, which catches operations the portal
 * never observed; diffing these snapshots would not. `firstSeenAt` survives a sweep
 * that finds the player still there, so it means "in this squad since", and a
 * transfer resets it by deleting the old row.
 */
export const squadMembers = pgTable(
  "squad_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.playerId] })],
);
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm drizzle-kit generate`
Expected: a new `drizzle/0005_*.sql` creating four tables, and a journal entry. Read the
SQL: it must be four `CREATE TABLE`s and their constraints, and must not touch any
existing table.

- [ ] **Step 5: Run the schema tests and watch them pass**

Run: `pnpm test src/lib/db/schema.test.ts`
Expected: PASS. `createTestDatabase` migrates from `./drizzle`, so the new migration is
exercised by every database test from here on.

- [ ] **Step 6: Commit**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: tables for players, their points, their values and squads

Market value is a dated snapshot rather than a column that gets overwritten,
because overwriting is exactly what makes a history impossible to build later —
and the API publishes no history to fall back on. The date primary key makes a
second sweep on the same day correct the day's reading instead of duplicating
it.

player_gameweek_points.gameweek does not reference gameweeks.number: the two
cadences are independent, and a player sweep must not fail because the
standings chain has not recorded a week yet."
```

---

### Task 3: The daily sweep

**Files:**
- Create: `src/lib/sync/failure.ts`
- Create: `src/lib/sync/players.ts`, `src/lib/sync/players.test.ts`
- Modify: `src/lib/sync/index.ts` (import `describeFailure` instead of defining it)

**Interfaces:**
- Consumes: `PlayerRow`, `SquadRow`, `FantasyClient` from Task 1; the four tables from Task 2; `teams` and `syncRuns` from the existing schema.
- Produces:
  - `describeFailure(error: unknown): string` in `@/lib/sync/failure`.
  - `type PlayerClient = Pick<FantasyClient, "getPlayers" | "getSquad">`
  - `type PlayerSweepResult = { playersSynced: number; squadsSynced: number; nextRunAt: Date }`
  - `runPlayerSweep(deps: { db: Db; client: PlayerClient; now: Date; runId: string; trigger: "players-schedule" | "players-manual" }): Promise<PlayerSweepResult>`
  - `utcDate(now: Date): string` — the `YYYY-MM-DD` a snapshot is stamped with.
  - `MINIMUM_CATALOGUE = 100`

- [ ] **Step 1: Extract `describeFailure` so both cadences record a named error**

Create `src/lib/sync/failure.ts`:

```ts
/**
 * The error's name is part of the record: the admin history reads it back.
 *
 * `isCredentialFailure` in the admin screen matches on the `CredentialError:` prefix
 * this produces, and it is the only thing that turns a scheduled run's failure into
 * "the credential needs re-bootstrapping". Both cadences exchange the same credential,
 * so both must record it the same way — which is why this is a module and not a
 * private helper in one of them.
 */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.name === "Error" ? error.message : `${error.name}: ${error.message}`;
}
```

In `src/lib/sync/index.ts`, delete the local `describeFailure` and its doc comment, and
import it: `import { describeFailure } from "./failure";`

Run: `pnpm test src/lib/sync/index.test.ts`
Expected: PASS, unchanged — this is a move, not a change.

- [ ] **Step 2: Write the failing sweep tests**

`src/lib/sync/players.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import {
  playerGameweekPoints,
  playerValueSnapshots,
  players,
  squadMembers,
  syncRuns,
  teams,
} from "@/lib/db/schema";
import { CREDENTIAL_ERROR_NAME, CredentialError } from "@/lib/fantasy-client";
import type { PlayerRow, SquadRow } from "@/lib/fantasy-client";
import { MINIMUM_CATALOGUE, runPlayerSweep, utcDate, type PlayerClient } from "./players";

const player = (id: string, over: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  nickname: `Player ${id}`,
  position: "Midfielder",
  realTeamId: "rt1",
  realTeamName: "A Club",
  status: "ok",
  imageUrl: null,
  marketValue: 10_000_000,
  weekPoints: [4, 7],
  ...over,
});

/** A catalogue big enough to clear the plausibility floor. */
function catalogue(count: number, over: (i: number) => Partial<PlayerRow> = () => ({})) {
  return Array.from({ length: count }, (_, i) => player(`p${i}`, over(i)));
}

function fakeClient(rows: PlayerRow[], squads: Record<string, string[]> = {}): PlayerClient {
  return {
    getPlayers: async () => rows,
    getSquad: async (teamId: string): Promise<SquadRow> => ({
      teamId,
      playerIds: squads[teamId] ?? [],
    }),
  };
}

const now = new Date("2026-09-07T04:00:00Z");
const tomorrow = new Date("2026-09-08T04:00:00Z");

describe("runPlayerSweep", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.db.delete(squadMembers);
    await h.db.delete(playerValueSnapshots);
    await h.db.delete(playerGameweekPoints);
    await h.db.delete(players);
    await h.db.delete(teams);
    await h.db.delete(syncRuns);
  });

  it("writes the catalogue and backfills the points history on the first sweep", async () => {
    const client = fakeClient(catalogue(MINIMUM_CATALOGUE));

    const result = await runPlayerSweep({
      db: h.db, client, now, runId: "s1", trigger: "players-schedule",
    });

    expect(result.playersSynced).toBe(MINIMUM_CATALOGUE);
    expect(await h.db.select().from(players)).toHaveLength(MINIMUM_CATALOGUE);

    const points = await h.db
      .select()
      .from(playerGameweekPoints)
      .where(eq(playerGameweekPoints.playerId, "p0"));
    expect(points.sort((a, b) => a.gameweek - b.gameweek)).toMatchObject([
      { gameweek: 1, points: 4 },
      { gameweek: 2, points: 7 },
    ]);
  });

  it("stamps the value snapshot with the day, and a second sweep that day does not duplicate it", async () => {
    await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });
    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE, () => ({ marketValue: 11_000_000 }))),
      now: new Date("2026-09-07T16:00:00Z"),
      runId: "s2",
      trigger: "players-manual",
    });

    const snapshots = await h.db
      .select()
      .from(playerValueSnapshots)
      .where(eq(playerValueSnapshots.playerId, "p0"));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].takenOn).toBe("2026-09-07");
    // The later reading of the day wins: it is the more recent measurement, and the
    // resolution this cadence can honestly claim is a day, not a moment.
    expect(snapshots[0].value).toBe(11_000_000);
  });

  it("appends a second day rather than overwriting the first", async () => {
    await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });
    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE, () => ({ marketValue: 12_000_000 }))),
      now: tomorrow,
      runId: "s2",
      trigger: "players-schedule",
    });

    const snapshots = await h.db
      .select()
      .from(playerValueSnapshots)
      .where(eq(playerValueSnapshots.playerId, "p0"));
    expect(snapshots.map((s) => s.takenOn).sort()).toEqual(["2026-09-07", "2026-09-08"]);
  });

  it("refuses an implausibly small catalogue and leaves the last one in place", async () => {
    await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });

    await expect(
      runPlayerSweep({
        db: h.db,
        client: fakeClient(catalogue(MINIMUM_CATALOGUE - 1)),
        now: tomorrow,
        runId: "s2",
        trigger: "players-schedule",
      }),
    ).rejects.toThrowError(/99/);

    // Replacing six hundred players with a truncated response is worse than skipping
    // a day, so nothing was written.
    expect(await h.db.select().from(players)).toHaveLength(MINIMUM_CATALOGUE);
    const [failed] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "s2"));
    expect(failed.status).toBe("failed");
  });

  it("moves a transferred player between squads and keeps the others' first_seen_at", async () => {
    await h.db.insert(teams).values([
      { id: "t1", managerId: 1, managerName: "Manager A" },
      { id: "t2", managerId: 2, managerName: "Manager B" },
    ]);

    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p0", "p1"], t2: ["p2"] }),
      now,
      runId: "s1",
      trigger: "players-schedule",
    });
    const before = await h.db.select().from(squadMembers);
    const p1Before = before.find((m) => m.playerId === "p1")?.firstSeenAt;

    await runPlayerSweep({
      db: h.db,
      client: fakeClient(catalogue(MINIMUM_CATALOGUE), { t1: ["p1"], t2: ["p2", "p0"] }),
      now: tomorrow,
      runId: "s2",
      trigger: "players-schedule",
    });

    const after = await h.db.select().from(squadMembers);
    expect(after.find((m) => m.playerId === "p0")?.teamId).toBe("t2");
    expect(after.filter((m) => m.playerId === "p0")).toHaveLength(1);
    // A player who did not move keeps "in this squad since".
    expect(after.find((m) => m.playerId === "p1")?.firstSeenAt).toEqual(p1Before);
  });

  it("asks about every team it knows and reports how many squads it read", async () => {
    await h.db.insert(teams).values([
      { id: "t1", managerId: 1, managerName: "Manager A" },
      { id: "t2", managerId: 2, managerName: "Manager B" },
    ]);
    const result = await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });
    expect(result.squadsSynced).toBe(2);
  });

  it("records the run, and records a credential failure by name", async () => {
    const ok = await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });
    expect(ok.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
    const [run] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "s1"));
    expect(run).toMatchObject({ trigger: "players-schedule", status: "succeeded" });

    const broken: PlayerClient = {
      getPlayers: async () => {
        throw new CredentialError("nope");
      },
      getSquad: async (teamId) => ({ teamId, playerIds: [] }),
    };
    await expect(
      runPlayerSweep({
        db: h.db, client: broken, now, runId: "s2", trigger: "players-schedule",
      }),
    ).rejects.toBeInstanceOf(CredentialError);

    // The admin banner matches on this prefix. Without it a failed sweep reads as an
    // ordinary error and nobody is told to re-bootstrap.
    const [failed] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "s2"));
    expect(failed.error?.startsWith(`${CREDENTIAL_ERROR_NAME}:`)).toBe(true);
  });

  it("renames nothing it has already seen, but updates what moved", async () => {
    await runPlayerSweep({
      db: h.db, client: fakeClient(catalogue(MINIMUM_CATALOGUE)), now,
      runId: "s1", trigger: "players-schedule",
    });
    const [first] = await h.db.select().from(players).where(eq(players.id, "p0"));

    await runPlayerSweep({
      db: h.db,
      client: fakeClient(
        catalogue(MINIMUM_CATALOGUE, () => ({ status: "injured", nickname: "Renamed" })),
      ),
      now: tomorrow,
      runId: "s2",
      trigger: "players-schedule",
    });

    const [second] = await h.db.select().from(players).where(eq(players.id, "p0"));
    expect(second.status).toBe("injured");
    expect(second.nickname).toBe("Renamed");
    expect(second.firstSeenAt).toEqual(first.firstSeenAt);
    expect(second.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
  });
});

describe("utcDate", () => {
  it("stamps a snapshot with the UTC day", () => {
    expect(utcDate(new Date("2026-09-07T23:30:00Z"))).toBe("2026-09-07");
  });

  it("does not drift with the machine's timezone", () => {
    // A sweep runs on a serverless function whose zone is not ours. UTC everywhere is
    // what keeps two sweeps either side of local midnight on the same key.
    expect(utcDate(new Date("2026-09-08T00:30:00Z"))).toBe("2026-09-08");
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm test src/lib/sync/players.test.ts`
Expected: FAIL — `./players` does not exist.

- [ ] **Step 4: Add the cadence the sweep schedules against**

The sweep imports `nextPlayerSweep`, so this lands before it.

In `src/lib/sync/next-run.ts`, append:

```ts
export const PLAYER_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const PLAYER_FAILURE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * When the next player sweep should run.
 *
 * A flat day. Nothing in the response says when values move, the API is unofficial and
 * undocumented, and the consensus among the projects using it is one full sweep a day.
 * There is no live window to chase: this is the slow half of the design, and the
 * ten-minute standings chain is unaffected by it.
 */
export function nextPlayerSweep(now: Date): Date {
  return new Date(now.getTime() + PLAYER_SWEEP_INTERVAL_MS);
}

/**
 * When to come back after a sweep that failed.
 *
 * An hour, not the standings chain's five minutes: a failed sweep costs the portal a
 * day of value resolution at worst, and hammering an undocumented API is exactly what
 * the daily cadence exists to avoid. Still far sooner than a day, because a sweep that
 * books no successor ends the chain.
 */
export function nextPlayerSweepAfterFailure(now: Date): Date {
  return new Date(now.getTime() + PLAYER_FAILURE_INTERVAL_MS);
}
```

Add to `src/lib/sync/next-run.test.ts`, extending that file's existing import from
`./next-run` with both function names:

```ts
describe("the player sweep cadence", () => {
  const now = new Date("2026-09-07T04:00:00Z");

  it("comes back a day later", () => {
    expect(nextPlayerSweep(now).toISOString()).toBe("2026-09-08T04:00:00.000Z");
  });

  it("comes back sooner after a failure, but not fast enough to hammer", () => {
    expect(nextPlayerSweepAfterFailure(now).toISOString()).toBe("2026-09-07T05:00:00.000Z");
  });
});
```

Run: `pnpm test src/lib/sync/next-run.test.ts`
Expected: PASS, the two new tests and the existing ones.

- [ ] **Step 5: Write the sweep**

`src/lib/sync/players.ts`:

```ts
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import {
  playerGameweekPoints,
  playerValueSnapshots,
  players,
  squadMembers,
  syncRuns,
  teams,
} from "@/lib/db/schema";
import type { FantasyClient, PlayerRow } from "@/lib/fantasy-client";
import { describeFailure } from "./failure";
import { nextPlayerSweep } from "./next-run";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The two calls a sweep makes. Narrower than `FantasyClient`, so a fake is two lines. */
export type PlayerClient = Pick<FantasyClient, "getPlayers" | "getSquad">;

export type PlayerSweepResult = {
  playersSynced: number;
  squadsSynced: number;
  nextRunAt: Date;
};

/**
 * Below this, the response is treated as broken rather than believed.
 *
 * A truncated catalogue written over a good one is worse than a skipped day: the
 * players it drops keep their history but stop being listed, and nothing says why.
 * The real catalogue is around six hundred.
 */
export const MINIMUM_CATALOGUE = 100;

/**
 * Rows per statement.
 *
 * Writes go out as multi-row `INSERT … VALUES (…), (…) ON CONFLICT`, which is ONE
 * statement and one round trip — not `db.batch()`, which does not exist on the PGlite
 * instance the tests use, and not a transaction, which does not work on Neon's HTTP
 * driver. Row by row would be the alternative, and by the end of a season the points
 * backfill alone is six hundred players times thirty-eight weeks: twenty-two thousand
 * round trips, well past the function timeout. Postgres caps a statement at 65,535
 * bound parameters; 400 rows of eight columns is comfortably inside it.
 */
const CHUNK = 400;

function chunked<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/** The day a snapshot belongs to. UTC, so a sweep's zone cannot move the key. */
export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * One daily sweep of the player catalogue.
 *
 * A second cadence rather than more work inside the ten-minute standings chain:
 * player data does not move at that rate, and sweeping an unofficial, undocumented API
 * every ten minutes would be rude and pointless. Two calls plus one per team.
 *
 * Like `runSync`, writes are plain sequential awaits — never a transaction and never
 * `db.batch()` — and every one of them is idempotent, so a sweep that dies halfway is
 * corrected by the next one.
 */
export async function runPlayerSweep(deps: {
  db: Db;
  client: PlayerClient;
  now: Date;
  runId: string;
  trigger: "players-schedule" | "players-manual";
}): Promise<PlayerSweepResult> {
  const { db, client, now, runId, trigger } = deps;

  await db.insert(syncRuns).values({ id: runId, trigger, status: "running" });

  try {
    const catalogue = await client.getPlayers();

    if (catalogue.length < MINIMUM_CATALOGUE) {
      throw new Error(
        `The players endpoint returned only ${catalogue.length} players, which is ` +
          `below the ${MINIMUM_CATALOGUE} needed to be believable. The catalogue was ` +
          `left as it was.`,
      );
    }

    await upsertCatalogue(db, catalogue, now);
    await appendValueSnapshots(db, catalogue, now);
    await backfillPoints(db, catalogue);
    const squadsSynced = await replaceSquads(db, client);

    const nextRunAt = nextPlayerSweep(now);
    await db
      .update(syncRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(syncRuns.id, runId));

    return { playersSynced: catalogue.length, squadsSynced, nextRunAt };
  } catch (error) {
    await db
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date(), error: describeFailure(error) })
      .where(eq(syncRuns.id, runId));
    throw error;
  }
}

/**
 * `firstSeenAt` is never in the update set: it is when we first saw the player, and a
 * sweep that sees them again does not change that. `lastSeenAt` is, and it is the only
 * thing that will tell a player who left the competition from one who is merely
 * unowned.
 */
async function upsertCatalogue(db: Db, catalogue: PlayerRow[], now: Date) {
  const rows = catalogue.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    position: p.position,
    realTeamId: p.realTeamId,
    realTeamName: p.realTeamName,
    status: p.status,
    imageUrl: p.imageUrl,
    lastSeenAt: now,
  }));

  for (const chunk of chunked(rows)) {
    await db
      .insert(players)
      .values(chunk)
      .onConflictDoUpdate({
        target: players.id,
        set: {
          nickname: sql`excluded.nickname`,
          position: sql`excluded.position`,
          realTeamId: sql`excluded.real_team_id`,
          realTeamName: sql`excluded.real_team_name`,
          status: sql`excluded.status`,
          imageUrl: sql`excluded.image_url`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
  }
}

/**
 * One dated reading per player per day.
 *
 * On conflict the day's value is UPDATED rather than left alone: a second sweep on the
 * same day carries the more recent measurement, and a day is the finest resolution
 * this cadence can honestly claim anyway.
 */
async function appendValueSnapshots(db: Db, catalogue: PlayerRow[], now: Date) {
  const takenOn = utcDate(now);
  const rows = catalogue.map((p) => ({ playerId: p.id, takenOn, value: p.marketValue }));

  for (const chunk of chunked(rows)) {
    await db
      .insert(playerValueSnapshots)
      .values(chunk)
      .onConflictDoUpdate({
        target: [playerValueSnapshots.playerId, playerValueSnapshots.takenOn],
        set: { value: sql`excluded.value` },
      });
  }
}

/**
 * `weekPoints[i]` is gameweek `i + 1`'s score — the reading pinned by the client's
 * test, where the array sums to the season total for every player in the capture.
 *
 * Written on every sweep, not only the first: a gameweek in play has its points
 * revised, and the conflict update is what lets a later sweep correct an earlier one.
 */
async function backfillPoints(db: Db, catalogue: PlayerRow[]) {
  const rows = catalogue.flatMap((p) =>
    p.weekPoints.map((points, index) => ({
      playerId: p.id,
      gameweek: index + 1,
      points,
    })),
  );

  for (const chunk of chunked(rows)) {
    await db
      .insert(playerGameweekPoints)
      .values(chunk)
      .onConflictDoUpdate({
        target: [playerGameweekPoints.playerId, playerGameweekPoints.gameweek],
        set: { points: sql`excluded.points` },
      });
  }
}

/**
 * Squads, one call per team, from the teams the standings cadence has recorded.
 *
 * Insert-then-prune rather than delete-then-insert: `firstSeenAt` means "in this squad
 * since", and deleting every row each sweep would reset it to today for a player who
 * has not moved in months.
 */
async function replaceSquads(db: Db, client: PlayerClient): Promise<number> {
  const known = await db.select().from(teams);

  for (const team of known) {
    const squad = await client.getSquad(team.id);

    if (squad.playerIds.length > 0) {
      for (const chunk of chunked(squad.playerIds)) {
        await db
          .insert(squadMembers)
          .values(chunk.map((playerId) => ({ teamId: team.id, playerId })))
          .onConflictDoNothing({
            target: [squadMembers.teamId, squadMembers.playerId],
          });
      }
      await db
        .delete(squadMembers)
        .where(
          and(
            eq(squadMembers.teamId, team.id),
            notInArray(squadMembers.playerId, squad.playerIds),
          ),
        );
    } else {
      // `notInArray` against an empty list is not valid SQL, and an empty squad is a
      // real answer — an emptied team owns nobody.
      await db.delete(squadMembers).where(eq(squadMembers.teamId, team.id));
    }
  }

  return known.length;
}
```

A player id that the catalogue does not carry cannot be inserted into `squad_members`:
the foreign key refuses it. That is deliberate — a squad naming an unknown player means
the catalogue call and the squad call disagreed, and failing the sweep is better than
recording an owner for a player nobody can look up. The next sweep, with a fresh
catalogue, resolves it.

- [ ] **Step 6: Run the sweep tests and watch them pass**

Run: `pnpm test src/lib/sync`
Expected: PASS — the nine sweep tests, the two cadence tests, and the standings suite
unchanged.

- [ ] **Step 7: Commit**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: the daily player sweep

Two calls plus one per team, at most once a day. Points are backfilled from
weekPoints; market value is appended as a dated snapshot, because the API
publishes no value history and the series can only be accumulated forward.

A catalogue under a hundred players is refused rather than written: replacing
six hundred players with a truncated response is worse than skipping a day, and
the views show the last catalogue's age.

Writes go out as multi-row INSERT ... ON CONFLICT — one statement, one round
trip. Neither db.batch() nor a transaction, both of which are still forbidden;
row by row would be twenty-two thousand round trips by the end of a season."
```

---

### Task 4: The second cadence, end to end

**Files:**
- Modify: `src/lib/sync/scheduled-run.ts`, `src/lib/sync/scheduled-run.test.ts`
- Modify: `src/lib/scheduler/index.ts`, `src/lib/scheduler/index.test.ts`
- Create: `src/app/api/sync/players/route.ts`
- Modify: `src/app/admin/sync/actions.ts`, `src/app/admin/sync/sync-controls.tsx`
- Modify: `docs/deployment.md`
- Modify: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `runPlayerSweep`, `nextPlayerSweepAfterFailure` from Task 3.
- Produces:
  - `runAndSchedule<T extends { nextRunAt: Date }>(deps: { run; schedule; now; nextAfterFailure? })` — generic, with `nextRunAfterFailure` as the default.
  - `ScheduledRun<T extends { nextRunAt: Date } = SyncResult>`
  - `schedulePlayerSweep(at: Date, now?: Date): Promise<void>` in `@/lib/scheduler`
  - `triggerPlayerSweepNow(): Promise<ActionResult>` in `src/app/admin/sync/actions.ts`
  - `POST /api/sync/players`

- [ ] **Step 1: Make the rebooking generic**

Both cadences need the same thing: run, book the successor whether or not the run
worked, hand the failure back to the caller. Only the result shape and the retry
interval differ.

In `src/lib/sync/scheduled-run.ts`:

```ts
import type { SyncResult } from "./index";
import { nextRunAfterFailure } from "./next-run";

export type ScheduledRun<T extends { nextRunAt: Date } = SyncResult> =
  | { status: "succeeded"; result: T }
  | { status: "failed"; error: unknown };
```

and change the signature, leaving the doc comment above it as it stands and adding one
paragraph to it:

```ts
/**
 * …existing comment…
 *
 * Generic over the run's result because there are two cadences now — the ten-minute
 * standings chain and the daily player sweep — and the reasoning above is identical
 * for both. `nextAfterFailure` is what differs: an hour for the sweep, five minutes
 * for the standings chain, whose live window is what a lost schedule would miss.
 */
export async function runAndSchedule<T extends { nextRunAt: Date }>(deps: {
  run: () => Promise<T>;
  schedule: (at: Date) => Promise<void>;
  now: Date;
  nextAfterFailure?: (now: Date) => Date;
}): Promise<ScheduledRun<T>> {
  try {
    const result = await deps.run();
    await deps.schedule(result.nextRunAt);
    return { status: "succeeded", result };
  } catch (error) {
    try {
      await deps.schedule((deps.nextAfterFailure ?? nextRunAfterFailure)(deps.now));
    } catch {
      // Nothing left to do here. The run's own error is the one worth reporting.
    }
    return { status: "failed", error };
  }
}
```

Add to `src/lib/sync/scheduled-run.test.ts`:

```ts
it("books the successor with the caller's own failure interval", async () => {
  const booked: Date[] = [];
  const outcome = await runAndSchedule({
    now: new Date("2026-09-07T04:00:00Z"),
    run: async () => {
      throw new Error("the sweep failed");
    },
    schedule: async (at) => {
      booked.push(at);
    },
    nextAfterFailure: (now) => new Date(now.getTime() + 60 * 60 * 1000),
  });

  expect(outcome.status).toBe("failed");
  expect(booked[0].toISOString()).toBe("2026-09-07T05:00:00.000Z");
});
```

Run: `pnpm test src/lib/sync/scheduled-run.test.ts`
Expected: PASS, the existing tests unchanged — the default keeps the standings chain on
five minutes.

- [ ] **Step 2: Publish to the second endpoint**

In `src/lib/scheduler/index.ts`, factor the publish and add the sweep's:

```ts
/** One QStash publish. The two cadences differ only in the endpoint they wake. */
async function publish(path: string, trigger: string, at: Date, now: Date): Promise<void> {
  const client = new Client({ token: getEnv().QSTASH_TOKEN });
  await client.publishJSON({
    url: `${getEnv().BETTER_AUTH_URL}${path}`,
    delay: delaySecondsUntil(at, now),
    body: { trigger },
  });
}

/**
 * Publishes the next standings sync to QStash.
 *
 * The chain is self-scheduling: each run books its own successor, so there is no
 * fixed cron making calls while nothing is happening.
 */
export async function scheduleNextRun(at: Date, now: Date = new Date()): Promise<void> {
  await publish("/api/sync", "schedule", at, now);
}

/**
 * Publishes the next player sweep, on its own chain.
 *
 * Separate from the standings chain on purpose: player data does not move every ten
 * minutes, and the two cadences must not be able to drag each other along.
 */
export async function schedulePlayerSweep(at: Date, now: Date = new Date()): Promise<void> {
  await publish("/api/sync/players", "players-schedule", at, now);
}
```

- [ ] **Step 3: Write the endpoint**

`src/app/api/sync/players/route.ts`:

```ts
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { schedulePlayerSweep, verifyQStashSignature } from "@/lib/scheduler";
import { nextPlayerSweepAfterFailure } from "@/lib/sync/next-run";
import { runPlayerSweep } from "@/lib/sync/players";
import { failureMessage, runAndSchedule } from "@/lib/sync/scheduled-run";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("upstash-signature") ?? "";

  if (!(await verifyQStashSignature(signature, body))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const now = new Date();
  const outcome = await runAndSchedule({
    now,
    schedule: (at) => schedulePlayerSweep(at, now),
    nextAfterFailure: nextPlayerSweepAfterFailure,
    run: async () => {
      const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
      return runPlayerSweep({ db, client, now, runId: randomUUID(), trigger: "players-schedule" });
    },
  });

  if (outcome.status === "failed") {
    // A 500 so QStash retries this delivery too: its retries are the fast recovery,
    // and the successor `runAndSchedule` booked is what survives them running out.
    return Response.json({ error: failureMessage(outcome.error) }, { status: 500 });
  }

  return Response.json({
    playersSynced: outcome.result.playersSynced,
    squadsSynced: outcome.result.squadsSynced,
    nextRunAt: outcome.result.nextRunAt.toISOString(),
  });
}
```

- [ ] **Step 4: Add the manual trigger**

In `src/app/admin/sync/actions.ts`, add the imports (`schedulePlayerSweep`,
`nextPlayerSweepAfterFailure`, `runPlayerSweep`) and:

```ts
export async function triggerPlayerSweepNow(): Promise<ActionResult> {
  await requirePermission({ sync: ["trigger"] });

  const now = new Date();
  // Through `runAndSchedule` like the endpoint, and for the same reason: the daily
  // chain has to be started by hand once, and this button is where that happens.
  const outcome = await runAndSchedule({
    now,
    schedule: (at) => schedulePlayerSweep(at, now),
    nextAfterFailure: nextPlayerSweepAfterFailure,
    run: async () => {
      const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
      return runPlayerSweep({ db, client, now, runId: randomUUID(), trigger: "players-manual" });
    },
  });

  if (outcome.status === "failed") {
    if (outcome.error instanceof CredentialError) {
      return { ok: false, message: CREDENTIAL_RECOVERY_MESSAGE };
    }
    return { ok: false, message: failureMessage(outcome.error) };
  }

  revalidatePath("/players");
  revalidatePath("/admin/sync");
  const { playersSynced, squadsSynced, nextRunAt } = outcome.result;
  return {
    ok: true,
    message:
      `Swept ${playersSynced} players and ${squadsSynced} squads. ` +
      `Next sweep at ${nextRunAt.toISOString()}.`,
  };
}
```

- [ ] **Step 5: Put the second button on the admin screen**

In `src/app/admin/sync/sync-controls.tsx`, import `triggerPlayerSweepNow` and put the
two run buttons side by side. The standings sync keeps the filled treatment: it is the
action that screen is about, and one primary button per screen is the rule the board
buttons were built around.

```tsx
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending || !hasCredential}
          onClick={() => startTransition(async () => setResult(await triggerSyncNow()))}
          className="board-button board-button-primary"
        >
          {pending ? "Syncing…" : "Sync now"}
        </button>

        <button
          type="button"
          disabled={pending || !hasCredential}
          onClick={() => startTransition(async () => setResult(await triggerPlayerSweepNow()))}
          className="board-button"
        >
          {pending ? "Working…" : "Sweep players"}
        </button>
      </div>
```

Replace the existing single `<button>` block with this one. Update the paragraph above
the run history so it describes both cadences:

```tsx
        {hasCredential
          ? "A LaLiga credential is stored. Standings sync every few minutes while a " +
            "round is live; players are swept once a day. Trigger either here to check."
          : "No LaLiga credential is stored yet, so nothing can sync. Paste a bootstrap refresh token below."}
```

- [ ] **Step 6: Add the E2E guard test**

In `e2e/auth.spec.ts`:

```ts
test("the player sweep endpoint refuses an unsigned request", async ({ request }) => {
  const res = await request.post("/api/sync/players", { data: { trigger: "players-schedule" } });
  expect(res.status()).toBe(401);
});
```

- [ ] **Step 7: Write down what an operator has to do**

In `docs/deployment.md`, under "4. Apply migrations", note that migration `0005` adds
the four player tables and is safe against a populated database — it only creates.

Then add a section after "7. Bootstrap the LaLiga credential":

```markdown
## 8. Start the daily player sweep

The sweep runs on its own self-scheduling chain, separate from the standings sync, and
like that one it has no cron behind it: each sweep books the next. Nothing books the
first, so it has to be started by hand, once, per environment.

On `/admin/sync`, press **Sweep players**. A successful sweep reports how many players
and squads it read and when the next one is due; from then on the chain runs itself.

If sweeps stop — the run history shows no `players-schedule` row for more than a day —
press the button again. That is the whole recovery: the chain restarts from it.

The first sweep also backfills every player's points for every gameweek played so far,
so it does more work than the ones after it. Market value is different: it has no
history anywhere in LaLiga's API, so the value chart starts on the day of the first
sweep and fills in one day at a time. There is no way to recover the days before it.
```

- [ ] **Step 8: Run everything**

Run: `pnpm test && pnpm test:e2e && pnpm lint && npx tsc --noEmit`
Expected: PASS. If `pnpm test:e2e` fails with `EADDRINUSE`, a stale `next start`
survived — `ss -ltnp | grep :3000`, then `kill -9` the pid. `lsof -ti:3000 | xargs kill`
does not always do it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: a second, daily cadence for the player sweep

Its own endpoint and its own self-scheduling chain, sharing the credential
exchange, the sync_runs row shape and the rebooking logic with the standings
sync — which is now generic over its result and takes the retry interval as a
parameter. An hour for the sweep, five minutes for the standings chain, whose
live window is what a lost schedule would miss.

Neither chain has a cron behind it, so the first sweep has to be started by
hand. docs/deployment.md says so, and says it plainly: nothing books the first
one."
```

---

### Task 5: Reading it back, and the pure domain

**Files:**
- Create: `src/lib/domain/players.ts`, `src/lib/domain/players.test.ts`
- Modify: `src/lib/db/queries.ts`, `src/lib/db/queries.test.ts` (`loadSnapshots` included — see Step 8)

**Interfaces:**
- Consumes: the four tables from Task 2, `teams` from the existing schema.
- Produces, in `@/lib/domain/players`:
  - `type PlayerRecord = { id: string; nickname: string; position: string; realTeamId: string; realTeamName: string | null; status: string; imageUrl: string | null }`
  - `type PlayerTotals = { playerId: string; seasonPoints: number; gameweeksRecorded: number }`
  - `type CurrentValue = { playerId: string; value: number; takenOn: string }`
  - `type Ownership = { playerId: string; teamId: string; managerName: string }`
  - `type ValuePoint = { takenOn: string; value: number }`
  - `type GameweekPoints = { gameweek: number; points: number }`
  - `type CatalogueRow = { id; nickname; position; realTeamName: string | null; status; currentValue: number | null; seasonPoints: number; averagePoints: number | null; ownerTeamId: string | null; ownerName: string | null }`
  - `buildCatalogue(input: { players: PlayerRecord[]; totals: PlayerTotals[]; values: CurrentValue[]; ownership: Ownership[] }): CatalogueRow[]`
  - `type CatalogueFilter = { query: string; position: string | null; ownership: "all" | "owned" | "free" }`
  - `filterCatalogue(rows: CatalogueRow[], filter: CatalogueFilter): CatalogueRow[]`
  - `type SortKey = "value" | "points" | "average" | "name"`
  - `sortCatalogue(rows: CatalogueRow[], key: SortKey): CatalogueRow[]`
  - `valueSeries(values: ValuePoint[]): ValuePoint[]`
  - `pointsSeries(points: GameweekPoints[]): { gameweek: number; points: number | null }[]`
  - `pointsPerMillion(seasonPoints: number, currentValue: number | null): number | null`
  - `formatMoney(value: number): string`
- Produces, in `@/lib/db/queries`:
  - `type CatalogueData = { players: PlayerRecord[]; totals: PlayerTotals[]; values: CurrentValue[]; ownership: Ownership[]; ownershipKnown: boolean; lastSweep: Date | null }`
  - `loadPlayerCatalogue(db): Promise<CatalogueData>`
  - `type PlayerDetail = { player: PlayerRecord; values: ValuePoint[]; points: GameweekPoints[]; owner: Ownership | null; lastSweep: Date | null }`
  - `loadPlayer(db, playerId: string): Promise<PlayerDetail | null>`

- [ ] **Step 1: Write the failing domain tests**

`src/lib/domain/players.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildCatalogue,
  filterCatalogue,
  formatMoney,
  pointsPerMillion,
  pointsSeries,
  sortCatalogue,
  valueSeries,
  type CatalogueRow,
  type PlayerRecord,
} from "./players";

const record = (id: string, over: Partial<PlayerRecord> = {}): PlayerRecord => ({
  id,
  nickname: `Player ${id}`,
  position: "Midfielder",
  realTeamId: "rt1",
  realTeamName: "A Club",
  status: "ok",
  imageUrl: null,
  ...over,
});

describe("buildCatalogue", () => {
  const input = {
    players: [
      record("p1", { nickname: "Ada" }),
      record("p2", { nickname: "Bruno", position: "Forward" }),
      record("p3", { nickname: "Cleo", position: "Goalkeeper" }),
    ],
    totals: [
      { playerId: "p1", seasonPoints: 40, gameweeksRecorded: 4 },
      { playerId: "p2", seasonPoints: 9, gameweeksRecorded: 3 },
    ],
    values: [
      { playerId: "p1", value: 12_000_000, takenOn: "2026-09-07" },
      { playerId: "p2", value: 4_000_000, takenOn: "2026-09-07" },
    ],
    ownership: [{ playerId: "p1", teamId: "t1", managerName: "Manager A" }],
  };

  it("joins value, points and ownership onto every player", () => {
    const rows = buildCatalogue(input);
    const ada = rows.find((r) => r.id === "p1");
    expect(ada).toMatchObject({
      nickname: "Ada",
      currentValue: 12_000_000,
      seasonPoints: 40,
      ownerTeamId: "t1",
      ownerName: "Manager A",
    });
  });

  it("derives the average rather than storing it", () => {
    // Storing both the total and the average invites the two to disagree. The average
    // is points per gameweek recorded for that player.
    const rows = buildCatalogue(input);
    expect(rows.find((r) => r.id === "p1")?.averagePoints).toBe(10);
    expect(rows.find((r) => r.id === "p2")?.averagePoints).toBe(3);
  });

  it("marks a player nobody owns as unowned rather than guessing", () => {
    const rows = buildCatalogue(input);
    expect(rows.find((r) => r.id === "p2")?.ownerName).toBeNull();
  });

  it("keeps a player with no value snapshot and no points, as an absence", () => {
    // A player who joined the competition between sweeps has a catalogue row and
    // nothing else. A zero would be a claim; null is the truth.
    const rows = buildCatalogue(input);
    expect(rows.find((r) => r.id === "p3")).toMatchObject({
      currentValue: null,
      seasonPoints: 0,
      averagePoints: null,
    });
  });
});

describe("filterCatalogue", () => {
  const rows: CatalogueRow[] = [
    {
      id: "p1", nickname: "Ada", position: "Midfielder", realTeamName: "A Club",
      status: "ok", currentValue: 12_000_000, seasonPoints: 40, averagePoints: 10,
      ownerTeamId: "t1", ownerName: "Manager A",
    },
    {
      id: "p2", nickname: "Bruno", position: "Forward", realTeamName: "B Club",
      status: "ok", currentValue: 4_000_000, seasonPoints: 9, averagePoints: 3,
      ownerTeamId: null, ownerName: null,
    },
  ];

  it("matches a name regardless of case", () => {
    expect(filterCatalogue(rows, { query: "ad", position: null, ownership: "all" })).toHaveLength(1);
  });

  it("matches the club as well as the player", () => {
    // "who plays for Betis" is as ordinary a question as "where is Ada".
    expect(filterCatalogue(rows, { query: "b club", position: null, ownership: "all" })[0].id).toBe("p2");
  });

  it("filters by position", () => {
    expect(filterCatalogue(rows, { query: "", position: "Forward", ownership: "all" })[0].id).toBe("p2");
  });

  it("separates the free from the owned", () => {
    expect(filterCatalogue(rows, { query: "", position: null, ownership: "free" })[0].id).toBe("p2");
    expect(filterCatalogue(rows, { query: "", position: null, ownership: "owned" })[0].id).toBe("p1");
  });

  it("returns everything when nothing is asked", () => {
    expect(filterCatalogue(rows, { query: "  ", position: null, ownership: "all" })).toHaveLength(2);
  });
});

describe("sortCatalogue", () => {
  const rows: CatalogueRow[] = [
    {
      id: "p1", nickname: "Zoe", position: "Midfielder", realTeamName: null, status: "ok",
      currentValue: 1_000_000, seasonPoints: 40, averagePoints: 10, ownerTeamId: null, ownerName: null,
    },
    {
      id: "p2", nickname: "Ada", position: "Forward", realTeamName: null, status: "ok",
      currentValue: 9_000_000, seasonPoints: 9, averagePoints: 3, ownerTeamId: null, ownerName: null,
    },
    {
      id: "p3", nickname: "Bruno", position: "Forward", realTeamName: null, status: "ok",
      currentValue: null, seasonPoints: 0, averagePoints: null, ownerTeamId: null, ownerName: null,
    },
  ];

  it("puts the most valuable first", () => {
    expect(sortCatalogue(rows, "value").map((r) => r.id)).toEqual(["p2", "p1", "p3"]);
  });

  it("puts the highest scorer first", () => {
    expect(sortCatalogue(rows, "points").map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("sorts by name alphabetically", () => {
    expect(sortCatalogue(rows, "name").map((r) => r.id)).toEqual(["p2", "p3", "p1"]);
  });

  it("sinks the unknowns rather than treating them as zero", () => {
    // A player with no snapshot yet is not the cheapest player in the league.
    expect(sortCatalogue(rows, "average").at(-1)?.id).toBe("p3");
  });

  it("does not mutate its input", () => {
    const before = rows.map((r) => r.id);
    sortCatalogue(rows, "value");
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("valueSeries", () => {
  it("orders the snapshots by the day they were taken", () => {
    const series = valueSeries([
      { takenOn: "2026-09-09", value: 3 },
      { takenOn: "2026-09-07", value: 1 },
      { takenOn: "2026-09-08", value: 2 },
    ]);
    expect(series.map((p) => p.value)).toEqual([1, 2, 3]);
  });
});

describe("pointsSeries", () => {
  it("fills the gameweeks it has no row for, as gaps and not as zeros", () => {
    // A gameweek with no row was never recorded. Nought points is a different claim,
    // and the chart must not make it.
    const series = pointsSeries([
      { gameweek: 1, points: 7 },
      { gameweek: 3, points: 2 },
    ]);
    expect(series).toEqual([
      { gameweek: 1, points: 7 },
      { gameweek: 2, points: null },
      { gameweek: 3, points: 2 },
    ]);
  });

  it("is empty before anything has been swept", () => {
    expect(pointsSeries([])).toEqual([]);
  });
});

describe("pointsPerMillion", () => {
  it("is points divided by millions of market value", () => {
    expect(pointsPerMillion(40, 8_000_000)).toBe(5);
  });

  it("is unknown when the value is unknown or nothing", () => {
    expect(pointsPerMillion(40, null)).toBeNull();
    expect(pointsPerMillion(40, 0)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("reads in millions above a million", () => {
    expect(formatMoney(12_400_000)).toBe("12.4M");
  });

  it("reads in thousands below one", () => {
    expect(formatMoney(840_000)).toBe("840K");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm test src/lib/domain/players.test.ts`
Expected: FAIL — `./players` does not exist.

- [ ] **Step 3: Write the domain module**

`src/lib/domain/players.ts`:

```ts
export type PlayerRecord = {
  id: string;
  nickname: string;
  position: string;
  realTeamId: string;
  realTeamName: string | null;
  status: string;
  imageUrl: string | null;
};

/** Aggregated in SQL, not in here: by May this is six hundred players times thirty-eight weeks. */
export type PlayerTotals = { playerId: string; seasonPoints: number; gameweeksRecorded: number };

export type CurrentValue = { playerId: string; value: number; takenOn: string };
export type Ownership = { playerId: string; teamId: string; managerName: string };
export type ValuePoint = { takenOn: string; value: number };
export type GameweekPoints = { gameweek: number; points: number };

export type CatalogueRow = {
  id: string;
  nickname: string;
  position: string;
  realTeamName: string | null;
  status: string;
  /** Null until the first sweep records one. Not zero: zero would be a claim. */
  currentValue: number | null;
  seasonPoints: number;
  /** Points per gameweek recorded for this player; null when none are. */
  averagePoints: number | null;
  ownerTeamId: string | null;
  ownerName: string | null;
};

/**
 * Everything the catalogue view shows, joined.
 *
 * Season totals and averages are DERIVED here rather than stored. The API states both,
 * and storing them alongside the per-gameweek series would let the two disagree — and
 * the series is the half that cannot be recomputed.
 */
export function buildCatalogue(input: {
  players: PlayerRecord[];
  totals: PlayerTotals[];
  values: CurrentValue[];
  ownership: Ownership[];
}): CatalogueRow[] {
  const totals = new Map(input.totals.map((t) => [t.playerId, t]));
  const values = new Map(input.values.map((v) => [v.playerId, v]));
  const owners = new Map(input.ownership.map((o) => [o.playerId, o]));

  return input.players.map((player) => {
    const total = totals.get(player.id);
    const owner = owners.get(player.id) ?? null;
    return {
      id: player.id,
      nickname: player.nickname,
      position: player.position,
      realTeamName: player.realTeamName,
      status: player.status,
      currentValue: values.get(player.id)?.value ?? null,
      seasonPoints: total?.seasonPoints ?? 0,
      averagePoints:
        total && total.gameweeksRecorded > 0
          ? total.seasonPoints / total.gameweeksRecorded
          : null,
      ownerTeamId: owner?.teamId ?? null,
      ownerName: owner?.managerName ?? null,
    };
  });
}

export type CatalogueFilter = {
  query: string;
  position: string | null;
  ownership: "all" | "owned" | "free";
};

/** Name or club, case-insensitively — "who plays for Betis" is an ordinary question. */
export function filterCatalogue(rows: CatalogueRow[], filter: CatalogueFilter): CatalogueRow[] {
  const query = filter.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (query !== "") {
      const haystack = `${row.nickname} ${row.realTeamName ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filter.position !== null && row.position !== filter.position) return false;
    if (filter.ownership === "owned" && row.ownerTeamId === null) return false;
    if (filter.ownership === "free" && row.ownerTeamId !== null) return false;
    return true;
  });
}

export type SortKey = "value" | "points" | "average" | "name";

/**
 * Sorts a copy, never the caller's array.
 *
 * An unknown value sinks rather than sorting as zero: a player whose first snapshot
 * has not been taken is not the cheapest player in the league, and putting them there
 * is the same false-zero mistake the team-value chart already had to fix once.
 */
export function sortCatalogue(rows: CatalogueRow[], key: SortKey): CatalogueRow[] {
  const byName = (a: CatalogueRow, b: CatalogueRow) => a.nickname.localeCompare(b.nickname);

  const descending = (pick: (row: CatalogueRow) => number | null) => (a: CatalogueRow, b: CatalogueRow) => {
    const left = pick(a);
    const right = pick(b);
    if (left === null && right === null) return byName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || byName(a, b);
  };

  const comparators: Record<SortKey, (a: CatalogueRow, b: CatalogueRow) => number> = {
    value: descending((row) => row.currentValue),
    points: descending((row) => row.seasonPoints),
    average: descending((row) => row.averagePoints),
    name: byName,
  };

  return [...rows].sort(comparators[key]);
}

/** Oldest first: the chart reads left to right, and the caller's order is not a series. */
export function valueSeries(values: ValuePoint[]): ValuePoint[] {
  return [...values].sort((a, b) => a.takenOn.localeCompare(b.takenOn));
}

/**
 * One entry per gameweek from the first to the last recorded.
 *
 * A gameweek with no row is `null`, not `0`: nothing was recorded, and nought points is
 * a different statement about a player's season.
 */
export function pointsSeries(points: GameweekPoints[]): { gameweek: number; points: number | null }[] {
  if (points.length === 0) return [];
  const last = Math.max(...points.map((p) => p.gameweek));
  const at = new Map(points.map((p) => [p.gameweek, p.points]));
  return Array.from({ length: last }, (_, i) => ({
    gameweek: i + 1,
    points: at.get(i + 1) ?? null,
  }));
}

/**
 * Points per million of market value.
 *
 * Nothing renders this yet, on purpose. "Opportunity" could mean players rising in
 * value, points per million, or unowned players scoring well; the slice builds what
 * all three need and none of the views, so the choice is made against a real catalogue
 * rather than guessed at now. This is the arithmetic half of one of them.
 */
export function pointsPerMillion(seasonPoints: number, currentValue: number | null): number | null {
  if (currentValue === null || currentValue === 0) return null;
  return seasonPoints / (currentValue / 1_000_000);
}

/** Money, at the length a phone can read. Shared by both views, so it lives here. */
export function formatMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${Math.round(value / 1000)}K`;
}
```

- [ ] **Step 4: Run the domain tests and watch them pass**

Run: `pnpm test src/lib/domain/players.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing query tests**

In `src/lib/db/queries.test.ts`, add a new describe block. Note the seeded value
snapshots: `p1` has two days, so the "latest per player" behaviour is what is asserted.

```ts
describe("loadPlayerCatalogue", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Manager A" });
    await h.db.insert(players).values([
      { id: "p1", nickname: "Ada", position: "Midfielder", realTeamId: "rt1", realTeamName: "A Club", status: "ok" },
      { id: "p2", nickname: "Bruno", position: "Forward", realTeamId: "rt2", realTeamName: "B Club", status: "injured" },
    ]);
    await h.db.insert(playerValueSnapshots).values([
      { playerId: "p1", takenOn: "2026-09-06", value: 11_000_000 },
      { playerId: "p1", takenOn: "2026-09-07", value: 12_000_000 },
      { playerId: "p2", takenOn: "2026-09-07", value: 4_000_000 },
    ]);
    await h.db.insert(playerGameweekPoints).values([
      { playerId: "p1", gameweek: 1, points: 12 },
      { playerId: "p1", gameweek: 2, points: 28 },
      { playerId: "p2", gameweek: 1, points: 9 },
    ]);
    await h.db.insert(squadMembers).values({ teamId: "t1", playerId: "p1" });
    await h.db.insert(syncRuns).values({
      id: "s1", trigger: "players-schedule", status: "succeeded",
      startedAt: new Date("2026-09-07T04:00:00Z"),
      finishedAt: new Date("2026-09-07T04:00:20Z"),
    });
  });
  afterAll(async () => { await h.close(); });

  it("returns the latest value per player, not every snapshot ever taken", async () => {
    // By May this table is six hundred players times a season of days. Reading all of
    // it to find today's value is the difference between a page and a timeout.
    const { values } = await loadPlayerCatalogue(h.db);
    expect(values).toHaveLength(2);
    expect(values.find((v) => v.playerId === "p1")).toMatchObject({
      value: 12_000_000,
      takenOn: "2026-09-07",
    });
  });

  it("aggregates the points in the database rather than shipping every row", async () => {
    const { totals } = await loadPlayerCatalogue(h.db);
    expect(totals.find((t) => t.playerId === "p1")).toEqual({
      playerId: "p1",
      seasonPoints: 40,
      gameweeksRecorded: 2,
    });
  });

  it("names the owner of an owned player", async () => {
    const { ownership } = await loadPlayerCatalogue(h.db);
    expect(ownership).toEqual([{ playerId: "p1", teamId: "t1", managerName: "Manager A" }]);
  });

  it("reports whether ownership is known at all", async () => {
    // Before a sweep reads the squads, every player would look free. That is a
    // different statement from "nobody owns them", and the view must be able to tell.
    const { ownershipKnown } = await loadPlayerCatalogue(h.db);
    expect(ownershipKnown).toBe(true);
  });

  it("reports when the catalogue was last swept", async () => {
    const { lastSweep } = await loadPlayerCatalogue(h.db);
    expect(lastSweep?.toISOString()).toBe("2026-09-07T04:00:20.000Z");
  });
});

describe("loadPlayer", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Manager A" });
    await h.db.insert(players).values({
      id: "p1", nickname: "Ada", position: "Midfielder",
      realTeamId: "rt1", realTeamName: "A Club", status: "ok",
    });
    await h.db.insert(playerValueSnapshots).values([
      { playerId: "p1", takenOn: "2026-09-06", value: 11_000_000 },
      { playerId: "p1", takenOn: "2026-09-07", value: 12_000_000 },
    ]);
    await h.db.insert(playerGameweekPoints).values([
      { playerId: "p1", gameweek: 1, points: 12 },
      { playerId: "p1", gameweek: 2, points: 28 },
    ]);
    await h.db.insert(squadMembers).values({ teamId: "t1", playerId: "p1" });
  });
  afterAll(async () => { await h.close(); });

  it("returns the player with their whole value and points history", async () => {
    const detail = await loadPlayer(h.db, "p1");
    expect(detail?.player.nickname).toBe("Ada");
    expect(detail?.values).toHaveLength(2);
    expect(detail?.points).toHaveLength(2);
    expect(detail?.owner?.managerName).toBe("Manager A");
  });

  it("returns null for a player nobody has ever swept", async () => {
    expect(await loadPlayer(h.db, "nope")).toBeNull();
  });
});
```

Extend that file's imports: `players`, `playerGameweekPoints`, `playerValueSnapshots`,
`squadMembers` from `./schema`, and `loadPlayer`, `loadPlayerCatalogue` from `./queries`.

- [ ] **Step 6: Run them and watch them fail**

Run: `pnpm test src/lib/db/queries.test.ts`
Expected: FAIL — `loadPlayerCatalogue is not a function`.

- [ ] **Step 7: Write the queries**

In `src/lib/db/queries.ts`, **merge** these into the import statements already at the
top of the file rather than adding second `from "drizzle-orm"` and `from "./schema"`
lines — `no-duplicate-imports` will object:

- from `drizzle-orm`: add `and`, `count`, `like`, `notLike`, `sum` to the existing
  `desc, eq`.
- from `./schema`: add `playerGameweekPoints`, `playerValueSnapshots`,
  `players as playersTable`, `squadMembers`.

Then append:

```ts
import type {
  CurrentValue,
  GameweekPoints,
  Ownership,
  PlayerRecord,
  PlayerTotals,
  ValuePoint,
} from "@/lib/domain/players";

export type CatalogueData = {
  players: PlayerRecord[];
  totals: PlayerTotals[];
  values: CurrentValue[];
  ownership: Ownership[];
  /**
   * Whether any squad has been read at all. Before the first sweep reads them every
   * player would look free, which is a different statement from "nobody owns them".
   */
  ownershipKnown: boolean;
  lastSweep: Date | null;
};

const toRecord = (row: typeof playersTable.$inferSelect): PlayerRecord => ({
  id: row.id,
  nickname: row.nickname,
  position: row.position,
  realTeamId: row.realTeamId,
  realTeamName: row.realTeamName,
  status: row.status,
  imageUrl: row.imageUrl,
});

/** Everything the catalogue needs, aggregated in the database. */
export async function loadPlayerCatalogue(db: Db): Promise<CatalogueData> {
  const [playerRows, totalRows, valueRows, ownershipRows, sweeps] = await Promise.all([
    db.select().from(playersTable).orderBy(playersTable.nickname),

    // Six hundred players times thirty-eight weeks by May. Summed here, not shipped.
    db
      .select({
        playerId: playerGameweekPoints.playerId,
        seasonPoints: sum(playerGameweekPoints.points),
        gameweeksRecorded: count(),
      })
      .from(playerGameweekPoints)
      .groupBy(playerGameweekPoints.playerId),

    // Ordered by player, then newest first, so the reduce below can take the first
    // row per player. The primary key is `(player_id, taken_on)`, so this reads off
    // that index rather than sorting a season's worth of rows.
    db
      .select({
        playerId: playerValueSnapshots.playerId,
        value: playerValueSnapshots.value,
        takenOn: playerValueSnapshots.takenOn,
      })
      .from(playerValueSnapshots)
      .orderBy(playerValueSnapshots.playerId, desc(playerValueSnapshots.takenOn)),

    db
      .select({
        playerId: squadMembers.playerId,
        teamId: squadMembers.teamId,
        managerName: teams.managerName,
      })
      .from(squadMembers)
      .innerJoin(teams, eq(teams.id, squadMembers.teamId)),

    db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.status, "succeeded"), like(syncRuns.trigger, "players-%")))
      .orderBy(desc(syncRuns.finishedAt))
      .limit(1),
  ]);

  // Ordered by player then by date descending above, so the first row per player is
  // the newest one.
  const latest = new Map<string, CurrentValue>();
  for (const row of valueRows) {
    if (!latest.has(row.playerId)) {
      latest.set(row.playerId, {
        playerId: row.playerId,
        value: row.value,
        takenOn: row.takenOn,
      });
    }
  }

  return {
    players: playerRows.map(toRecord),
    // Postgres returns a bigint for `sum`, which the driver hands over as a string.
    totals: totalRows.map((t) => ({
      playerId: t.playerId,
      seasonPoints: Number(t.seasonPoints ?? 0),
      gameweeksRecorded: t.gameweeksRecorded,
    })),
    values: [...latest.values()],
    ownership: ownershipRows,
    ownershipKnown: ownershipRows.length > 0,
    lastSweep: sweeps[0]?.finishedAt ?? null,
  };
}

export type PlayerDetail = {
  player: PlayerRecord;
  values: ValuePoint[];
  points: GameweekPoints[];
  owner: Ownership | null;
  lastSweep: Date | null;
};

export async function loadPlayer(db: Db, playerId: string): Promise<PlayerDetail | null> {
  const [row] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!row) return null;

  const [values, points, owners, sweeps] = await Promise.all([
    db
      .select({ takenOn: playerValueSnapshots.takenOn, value: playerValueSnapshots.value })
      .from(playerValueSnapshots)
      .where(eq(playerValueSnapshots.playerId, playerId))
      .orderBy(playerValueSnapshots.takenOn),
    db
      .select({ gameweek: playerGameweekPoints.gameweek, points: playerGameweekPoints.points })
      .from(playerGameweekPoints)
      .where(eq(playerGameweekPoints.playerId, playerId))
      .orderBy(playerGameweekPoints.gameweek),
    db
      .select({
        playerId: squadMembers.playerId,
        teamId: squadMembers.teamId,
        managerName: teams.managerName,
      })
      .from(squadMembers)
      .innerJoin(teams, eq(teams.id, squadMembers.teamId))
      .where(eq(squadMembers.playerId, playerId)),
    db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.status, "succeeded"), like(syncRuns.trigger, "players-%")))
      .orderBy(desc(syncRuns.finishedAt))
      .limit(1),
  ]);

  return {
    player: toRecord(row),
    values,
    points,
    owner: owners[0] ?? null,
    lastSweep: sweeps[0]?.finishedAt ?? null,
  };
}
```

One note on the code above. `takenOn` is a `date` column read as a string, and
`ORDER BY` on it is a calendar ordering in Postgres — not the lexicographic one the
`localeCompare` in `valueSeries` relies on. `YYYY-MM-DD` makes the two agree, which is
why the column is stored in that form and why the ordering test in Task 5 asserts it.

- [ ] **Step 8: Keep the two cadences out of each other's "last synced"**

`loadSnapshots` picks the newest succeeded run of ANY trigger, which was unambiguous
when there was one cadence. It is not any more: a player sweep at 04:00 would become
what `/standings` and `/progress` print as their own last sync, and those pages would
claim freshness they do not have — a sweep does not touch a single gameweek snapshot.

Add the failing test to the existing `loadSnapshots` describe in
`src/lib/db/queries.test.ts`, inside its `beforeAll`, after the run it already seeds:

```ts
    // A player sweep, later than the standings run above. It must not be what the
    // standings pages call their last sync: it wrote no snapshot of theirs.
    await h.db.insert(syncRuns).values({
      id: "s1", trigger: "players-schedule", status: "succeeded",
      startedAt: new Date("2026-08-24T04:00:00Z"),
      finishedAt: new Date("2026-08-24T04:00:20Z"),
    });
```

and the assertion:

```ts
  it("reports the last standings sync, not the last run of any kind", async () => {
    const { lastSync } = await loadSnapshots(h.db);
    expect(lastSync?.toISOString()).toBe("2026-08-23T10:00:05.000Z");
  });
```

Run: `pnpm test src/lib/db/queries.test.ts`
Expected: FAIL — `lastSync` comes back as the sweep's `2026-08-24T04:00:20.000Z`.

Then narrow the query in `src/lib/db/queries.ts`. In `loadSnapshots`, replace the
`syncRuns` read's `.where(eq(syncRuns.status, "succeeded"))` with:

```ts
      .where(
        and(
          eq(syncRuns.status, "succeeded"),
          // The daily player sweep writes no gameweek snapshot, so its success says
          // nothing about how fresh THIS page is.
          notLike(syncRuns.trigger, "players-%"),
        ),
      )
```

Add `notLike` to the `drizzle-orm` import.

- [ ] **Step 9: Run the query tests and watch them pass**

Run: `pnpm test src/lib/db/queries.test.ts`
Expected: PASS — the four existing `loadSnapshots` tests, the new one, and the eight
new player tests.

- [ ] **Step 10: Commit**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: read the catalogue back, and the pure domain over it

Totals and averages are derived, never stored: the API states both, and keeping
them beside the per-gameweek series would let the two disagree — and the series
is the half that cannot be recomputed.

Two absences are kept as absences rather than flattened to zero: a gameweek
with no row, and a player with no value snapshot yet. Both sort last and render
as gaps, which is the same false-zero the team-value chart already had to fix.

points-per-million is built and tested and rendered nowhere. The three things
'opportunity' could mean all need data this slice now has; which view to build
gets decided against a real catalogue instead of guessed at now.

loadSnapshots now ignores player runs when it reports a last sync. With two
cadences the newest succeeded run of any trigger is no longer the answer: a
sweep writes no gameweek snapshot, so the standings pages would have claimed a
freshness they did not have."
```

---

### Task 6: The catalogue

**Files:**
- Create: `src/components/player-catalogue.tsx`, `src/components/player-catalogue.test.tsx`
- Create: `src/app/(portal)/players/page.tsx`
- Modify: `src/components/app-nav.tsx`, `src/app/globals.css`, `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `buildCatalogue`, `filterCatalogue`, `sortCatalogue`, `formatMoney`, `CatalogueRow` from Task 5; `loadPlayerCatalogue` from Task 5.
- Produces: `PlayerCatalogue({ rows, ownershipKnown }: { rows: CatalogueRow[]; ownershipKnown: boolean })`.

**Design notes.** This applies the matchday-board system already in `globals.css`; it
does not open a new direction. Three decisions specific to this screen:

- **Value is the dominant numeral**, in Barlow Condensed, where the standings put the
  position number. A catalogue of a market is read by price first — "who can I afford"
  is the question — and points ride second.
- **Free agents get their own colour.** Green is spoken for (live points) and the
  alert red is spoken for (a broken credential), so this adds one token,
  `--board-free`, a brass that reads as "on the market" without competing with either.
  It is the only new colour in the slice.
- **Six hundred rows are not a page.** The list renders sixty at a time behind a
  count line and a "Show 60 more" control. No virtualisation library: a filter that
  actually narrows is the better answer, and it is the one the header offers first.

- [ ] **Step 1: Add the one new token**

In `src/app/globals.css`, inside `:root`, after `--board-alert`:

```css
  /* Ownership. Green is live points and the red is a broken credential, so an
     unowned player — the one thing a catalogue is scanned for — needs its own. */
  --board-free: #cbb26a;
```

- [ ] **Step 2: Write the failing catalogue test**

`src/components/player-catalogue.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogueRow } from "@/lib/domain/players";
import { PlayerCatalogue } from "./player-catalogue";

const row = (id: string, over: Partial<CatalogueRow> = {}): CatalogueRow => ({
  id,
  nickname: `Player ${id}`,
  position: "Midfielder",
  realTeamName: "A Club",
  status: "ok",
  currentValue: 12_400_000,
  seasonPoints: 40,
  averagePoints: 10,
  ownerTeamId: "t1",
  ownerName: "Manager A",
  ...over,
});

describe("PlayerCatalogue", () => {
  it("lists players with their value, points and owner", () => {
    const html = renderToStaticMarkup(
      <PlayerCatalogue rows={[row("p1", { nickname: "Ada" })]} ownershipKnown />,
    );
    expect(html).toContain("Ada");
    expect(html).toContain("12.4M");
    expect(html).toContain("40");
    expect(html).toContain("Manager A");
  });

  it("says a free agent is free", () => {
    const html = renderToStaticMarkup(
      <PlayerCatalogue
        rows={[row("p1", { ownerTeamId: null, ownerName: null })]}
        ownershipKnown
      />,
    );
    expect(html).toContain("Free agent");
  });

  it("does not call anyone free before the squads have been read", () => {
    // Before a sweep reads the squads every player is unowned in the database. Saying
    // "free agent" then would be a claim the portal cannot make.
    const html = renderToStaticMarkup(
      <PlayerCatalogue
        rows={[row("p1", { ownerTeamId: null, ownerName: null })]}
        ownershipKnown={false}
      />,
    );
    expect(html).not.toContain("Free agent");
    expect(html).toContain("Owners not swept yet");
  });

  it("surfaces a player who is not available, and stays quiet when they are", () => {
    const injured = renderToStaticMarkup(
      <PlayerCatalogue rows={[row("p1", { status: "injured" })]} ownershipKnown />,
    );
    expect(injured).toContain("injured");

    const fine = renderToStaticMarkup(<PlayerCatalogue rows={[row("p1")]} ownershipKnown />);
    // The status renders as " · <status>", and matching that rather than a bare "ok"
    // keeps the test from passing or failing on some unrelated word in the markup.
    expect(fine).not.toContain(" · ok");
  });

  it("shows a player with no snapshot yet as an absence, not as nothing owed", () => {
    const html = renderToStaticMarkup(
      <PlayerCatalogue
        rows={[row("p1", { currentValue: null, seasonPoints: 0, averagePoints: null })]}
        ownershipKnown
      />,
    );
    expect(html).toContain("—");
    expect(html).not.toContain("0.0M");
  });

  it("caps the list and says how much it is not showing", () => {
    const many = Array.from({ length: 90 }, (_, i) => row(`p${i}`));
    const html = renderToStaticMarkup(<PlayerCatalogue rows={many} ownershipKnown />);
    expect(html).toContain("Showing 60 of 90");
    expect(html).toContain("Show 60 more");
  });

  it("invites the first sweep when there is nothing to list", () => {
    const html = renderToStaticMarkup(<PlayerCatalogue rows={[]} ownershipKnown={false} />);
    expect(html).toContain("No players have been swept yet");
  });

  it("links each player to their own page", () => {
    const html = renderToStaticMarkup(<PlayerCatalogue rows={[row("p1")]} ownershipKnown />);
    expect(html).toContain('href="/players/p1"');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test src/components/player-catalogue.test.tsx`
Expected: FAIL — `./player-catalogue` does not exist.

- [ ] **Step 4: Build the catalogue**

`src/components/player-catalogue.tsx`:

```tsx
"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  filterCatalogue,
  formatMoney,
  sortCatalogue,
  type CatalogueRow,
  type SortKey,
} from "@/lib/domain/players";

const PAGE = 60;

const POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Coach"];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "value", label: "Most valuable" },
  { key: "points", label: "Highest scoring" },
  { key: "average", label: "Best average" },
  { key: "name", label: "By name" },
];

const OWNERSHIP: { key: "all" | "owned" | "free"; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "owned", label: "Owned" },
  { key: "free", label: "Free" },
];

/** The pill treatment the progress view already uses for pinning managers. */
function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full border px-3 py-1 text-[12px]"
      style={{
        borderColor: active ? "var(--board-ink-dim)" : "var(--board-line)",
        color: active ? "var(--board-ink)" : "var(--board-ink-dim)",
      }}
    >
      {children}
    </button>
  );
}

function Owner({ row, ownershipKnown }: { row: CatalogueRow; ownershipKnown: boolean }) {
  if (row.ownerName !== null) return <>{row.ownerName}</>;
  // Nobody has read the squads yet, so "unowned" is a gap in what we know, not a fact
  // about the player.
  if (!ownershipKnown) return <span style={{ color: "var(--board-ink-dim)" }}>Owners not swept yet</span>;
  return <span style={{ color: "var(--board-free)" }}>Free agent</span>;
}

export function PlayerCatalogue({
  rows,
  ownershipKnown,
}: {
  rows: CatalogueRow[];
  ownershipKnown: boolean;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<"all" | "owned" | "free">("all");
  const [sort, setSort] = useState<SortKey>("value");
  const [shown, setShown] = useState(PAGE);

  const visible = useMemo(
    () => sortCatalogue(filterCatalogue(rows, { query, position, ownership }), sort),
    [rows, query, position, ownership, sort],
  );

  if (rows.length === 0) {
    return (
      <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
        No players have been swept yet. An admin can run the first sweep from the Sync page.
      </p>
    );
  }

  return (
    <div className="mt-6">
      <input
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setShown(PAGE);
        }}
        placeholder="Search a player or a club"
        aria-label="Search a player or a club"
        className="w-full rounded-md border px-3 py-2 text-[14px]"
        style={{ background: "transparent", color: "var(--board-ink)" }}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {POSITIONS.map((name) => (
          <Pill
            key={name}
            active={position === name}
            onClick={() => {
              setPosition(position === name ? null : name);
              setShown(PAGE);
            }}
          >
            {name}
          </Pill>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {OWNERSHIP.map((option) => (
          <Pill
            key={option.key}
            active={ownership === option.key}
            onClick={() => {
              setOwnership(option.key);
              setShown(PAGE);
            }}
          >
            {option.label}
          </Pill>
        ))}
        {SORTS.map((option) => (
          <Pill key={option.key} active={sort === option.key} onClick={() => setSort(option.key)}>
            {option.label}
          </Pill>
        ))}
      </div>

      <ol className="mt-5">
        {visible.slice(0, shown).map((row) => (
          <li key={row.id} style={{ borderColor: "var(--board-line)" }} className="border-b">
            <Link
              href={`/players/${row.id}`}
              className="grid grid-cols-[1fr_auto] items-center gap-3 py-[11px]"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14.5px]">{row.nickname}</span>
                <span className="block truncate text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
                  {row.position}
                  {row.realTeamName === null ? "" : ` · ${row.realTeamName}`} ·{" "}
                  <Owner row={row} ownershipKnown={ownershipKnown} />
                  {row.status === "ok" ? null : (
                    <span style={{ color: "var(--board-alert)" }}> · {row.status}</span>
                  )}
                </span>
              </span>
              <span className="text-right">
                <span
                  className="block text-[20px] font-normal tabular-nums leading-none"
                  style={{ fontFamily: "var(--font-barlow-condensed)" }}
                >
                  {row.currentValue === null ? "—" : formatMoney(row.currentValue)}
                </span>
                <span className="block text-[11px] tabular-nums" style={{ color: "var(--board-ink-dim)" }}>
                  {row.seasonPoints} pts
                  {row.averagePoints === null ? "" : ` · ${row.averagePoints.toFixed(1)} avg`}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {visible.length === 0 && (
        <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
          No player matches that. Clear a filter to widen it.
        </p>
      )}

      {visible.length > shown && (
        <div className="mt-5 flex items-center gap-4">
          <button type="button" onClick={() => setShown(shown + PAGE)} className="board-button">
            Show {PAGE} more
          </button>
          <span className="text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
            Showing {shown} of {visible.length}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the catalogue test and watch it pass**

Run: `pnpm test src/components/player-catalogue.test.tsx`
Expected: PASS, eight tests.

- [ ] **Step 6: Build the page**

`src/app/(portal)/players/page.tsx`:

```tsx
import { db } from "@/lib/db";
import { loadPlayerCatalogue } from "@/lib/db/queries";
import { buildCatalogue } from "@/lib/domain/players";
import { requireSession } from "@/lib/auth/guards";
import { PlayerCatalogue } from "@/components/player-catalogue";

export default async function PlayersPage() {
  await requireSession();
  const { players, totals, values, ownership, ownershipKnown, lastSweep } =
    await loadPlayerCatalogue(db);
  const rows = buildCatalogue({ players, totals, values, ownership });

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">Players</h1>
      <p className="mt-1 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        Every eligible player, what they cost and what they score.
      </p>

      <PlayerCatalogue rows={rows} ownershipKnown={ownershipKnown} />

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastSweep ? `Last swept ${lastSweep.toISOString()}` : "Never swept"}
      </p>
    </section>
  );
}
```

- [ ] **Step 7: Link it from the navigation**

In `src/components/app-nav.tsx`, after the Progress link:

```tsx
      {session && <Link href="/players">Players</Link>}
```

- [ ] **Step 8: Add the E2E guard tests**

In `e2e/auth.spec.ts`:

```ts
test("the players page redirects anyone who has not signed in", async ({ page }) => {
  await page.goto("/players");
  await expect(page).toHaveURL(/\/login$/);
});

test("the players link is hidden without a session", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Players" })).toHaveCount(0);
});
```

- [ ] **Step 9: Look at it**

Run `pnpm dev` and open `/players` with real data. Check by eye, at 375px wide:

- The value numeral does not collide with a long name plus a long club.
- Two rows of pills do not push the list below the fold before anything is visible.
- The brass "Free agent" is legible against `#10120f` and does not read as a warning.
- The page does not scroll horizontally.
- Typing in the search box narrows the list without a visible stall at six hundred rows.

Fix what you see before calling this done.

- [ ] **Step 10: Commit**

Run: `pnpm test && pnpm test:e2e && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: the player catalogue

Value is the dominant numeral, where the standings put the position: a market
is read by price first. Points ride underneath with the average.

Free agents get the one new colour in the slice — green is live points and red
is a broken credential, so the thing a catalogue is actually scanned for needed
its own. Before the squads have been swept nobody is called free at all: every
player is unowned in the database then, and saying otherwise would be a claim.

Six hundred rows render sixty at a time behind a count line. The better answer
to a long list is a filter that narrows, which is what the header offers first."
```

---

### Task 7: One player

**Files:**
- Create: `src/components/player-charts.tsx`, `src/components/player-charts.test.tsx`
- Create: `src/app/(portal)/players/[id]/page.tsx`
- Modify: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `loadPlayer` from Task 5; `pointsSeries`, `valueSeries`, `formatMoney` from Task 5.
- Produces: `PlayerCharts({ points, values }: { points: { gameweek: number; points: number | null }[]; values: ValuePoint[] })`.

**Design note.** The points chart is bars, in the same two greys as the standings' form
bars — the form bars and this chart are the same idea at two scales, so they share a
vocabulary. The value chart is a line in `--series-1`. Each carries a
`<details>` table, as the progress charts do: `ResponsiveContainer` renders nothing
without a width, so the table is both the accessible reading of the data and the only
part a server-rendered test can assert on.

- [ ] **Step 1: Write the failing chart test**

`src/components/player-charts.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { pointsSeries, valueSeries } from "@/lib/domain/players";
import { PlayerCharts } from "./player-charts";

describe("PlayerCharts", () => {
  const points = pointsSeries([
    { gameweek: 1, points: 12 },
    { gameweek: 2, points: 28 },
  ]);
  const values = valueSeries([
    { takenOn: "2026-09-06", value: 11_000_000 },
    { takenOn: "2026-09-07", value: 12_400_000 },
  ]);

  it("titles both charts and puts the real numbers in a table", () => {
    const html = renderToStaticMarkup(<PlayerCharts points={points} values={values} />);
    expect(html).toContain("Points per gameweek");
    expect(html).toContain("Market value");
    expect(html).toContain("Show the numbers");
    expect(html).toContain("28");
    expect(html).toContain("12.4M");
  });

  it("says why the value chart starts where it does", () => {
    // The same honesty the team-value chart uses: this series only exists from the
    // first sweep onward, and the API publishes no history to fill in behind it.
    const html = renderToStaticMarkup(<PlayerCharts points={points} values={values} />);
    expect(html).toContain("only recorded from the first sweep onward");
  });

  it("renders a gameweek with no row as a gap, not as nought points", () => {
    const gappy = pointsSeries([
      { gameweek: 1, points: 12 },
      { gameweek: 3, points: 5 },
    ]);
    const html = renderToStaticMarkup(<PlayerCharts points={gappy} values={values} />);
    expect(html).toContain("—");
  });

  it("has an empty state for each chart before anything is swept", () => {
    const html = renderToStaticMarkup(<PlayerCharts points={[]} values={[]} />);
    expect(html.match(/Nothing has been swept yet\./g)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test src/components/player-charts.test.tsx`
Expected: FAIL — `./player-charts` does not exist.

- [ ] **Step 3: Build the charts**

`src/components/player-charts.tsx`:

```tsx
"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, type ValuePoint } from "@/lib/domain/players";

type PointsPoint = { gameweek: number; points: number | null };

const AXIS = { stroke: "var(--board-ink-dim)", fontSize: 11 };

function Empty() {
  return (
    <p className="mt-2 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
      Nothing has been swept yet.
    </p>
  );
}

function Numbers({
  head,
  rowLabel,
  rows,
}: {
  head: string;
  rowLabel: string;
  rows: [string, string][];
}) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
        Show the numbers
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="text-[12px] tabular-nums">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left font-medium">{head}</th>
              {rows.map(([label]) => (
                <th key={label} className="px-2 py-1 text-right font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-2 py-1">{rowLabel}</td>
              {rows.map(([label, value]) => (
                <td key={label} className="px-2 py-1 text-right">
                  {value}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function PlayerCharts({ points, values }: { points: PointsPoint[]; values: ValuePoint[] }) {
  return (
    <div className="space-y-12">
      <section>
        <h2 className="text-[15px] font-medium">Points per gameweek</h2>
        {points.length === 0 ? (
          <Empty />
        ) : (
          <>
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points}>
                  <CartesianGrid stroke="var(--board-line)" vertical={false} />
                  <XAxis dataKey="gameweek" {...AXIS} tickLine={false} />
                  <YAxis {...AXIS} tickLine={false} width={28} />
                  <Bar dataKey="points" fill="var(--board-form-best)" radius={[1, 1, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Numbers
              head="Gameweek"
              rowLabel="Points"
              rows={points.map((p) => [
                String(p.gameweek),
                p.points === null ? "—" : String(p.points),
              ])}
            />
          </>
        )}
      </section>

      <section>
        <h2 className="text-[15px] font-medium">Market value</h2>
        <p className="mt-1 text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
          Market value is only recorded from the first sweep onward. LaLiga publishes no
          history, so the days before it cannot be recovered.
        </p>
        {values.length === 0 ? (
          <Empty />
        ) : (
          <>
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={values}>
                  <CartesianGrid stroke="var(--board-line)" vertical={false} />
                  <XAxis dataKey="takenOn" {...AXIS} tickLine={false} />
                  <YAxis
                    {...AXIS}
                    tickLine={false}
                    width={44}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => formatMoney(v)}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="var(--series-1)"
                    strokeWidth={2}
                    dot={values.length === 1}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Numbers
              head="Day"
              rowLabel="Value"
              rows={values.map((v) => [v.takenOn, formatMoney(v.value)])}
            />
          </>
        )}
      </section>
    </div>
  );
}
```

`dot={values.length === 1}` is deliberate: a single snapshot draws no line at all, and
without a dot the first day after a sweep is a blank chart with no explanation.

- [ ] **Step 4: Run the chart test and watch it pass**

Run: `pnpm test src/components/player-charts.test.tsx`
Expected: PASS, four tests.

- [ ] **Step 5: Build the page**

`src/app/(portal)/players/[id]/page.tsx`. Note `params` is a promise in this version of
Next — see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`.

```tsx
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadPlayer } from "@/lib/db/queries";
import { formatMoney, pointsSeries, valueSeries } from "@/lib/domain/players";
import { requireSession } from "@/lib/auth/guards";
import { PlayerCharts } from "@/components/player-charts";

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const detail = await loadPlayer(db, id);
  if (detail === null) notFound();

  const { player, owner, lastSweep } = detail;
  const values = valueSeries(detail.values);
  const points = pointsSeries(detail.points);
  const seasonPoints = detail.points.reduce((sum, p) => sum + p.points, 0);
  const currentValue = values.at(-1)?.value ?? null;

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">{player.nickname}</h1>
      <p className="mt-1 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        {player.position}
        {player.realTeamName === null ? "" : ` · ${player.realTeamName}`} ·{" "}
        {owner === null ? (
          <span style={{ color: "var(--board-free)" }}>Free agent</span>
        ) : (
          owner.managerName
        )}
        {player.status === "ok" ? null : (
          <span style={{ color: "var(--board-alert)" }}> · {player.status}</span>
        )}
      </p>

      <div className="mt-6 flex gap-10">
        <span>
          <span
            className="block text-[27px] font-extralight leading-none tabular-nums"
            style={{ fontFamily: "var(--font-barlow-condensed)" }}
          >
            {currentValue === null ? "—" : formatMoney(currentValue)}
          </span>
          <span className="block text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
            market value
          </span>
        </span>
        <span>
          <span
            className="block text-[27px] font-extralight leading-none tabular-nums"
            style={{ fontFamily: "var(--font-barlow-condensed)" }}
          >
            {seasonPoints}
          </span>
          <span className="block text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
            points this season
          </span>
        </span>
      </div>

      <div className="mt-10">
        <PlayerCharts points={points} values={values} />
      </div>

      <p className="mt-10 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastSweep ? `Last swept ${lastSweep.toISOString()}` : "Never swept"}
      </p>
    </section>
  );
}
```

- [ ] **Step 6: Add the E2E guard test**

In `e2e/auth.spec.ts`:

```ts
test("a player page redirects anyone who has not signed in", async ({ page }) => {
  // The guard has to run before the lookup, or an anonymous visitor learns which ids
  // exist from the difference between a redirect and a 404.
  await page.goto("/players/9999");
  await expect(page).toHaveURL(/\/login$/);
});
```

- [ ] **Step 7: Look at it**

Run `pnpm dev`, open `/players`, and click through to a player. Check by eye, at 375px:

- The two big numerals sit on one line without wrapping the labels under them.
- The value chart with a single snapshot shows a dot rather than an empty frame.
- The bar chart's gameweek axis is readable at thirty-eight weeks, not just at four.
- Neither `<details>` table makes the page scroll horizontally — they scroll inside
  their own container.
- A player with a long name and an injured status does not push the status off-screen.

Fix what you see before calling this done.

- [ ] **Step 8: Commit**

Run: `pnpm test && pnpm test:e2e && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: the player page, with points and value over time

Points per gameweek is bars in the standings' own form-bar greys — the two are
the same idea at different scales. Market value is a line, and it says in words
that it only starts at the first sweep: LaLiga publishes no value history, so
the days before it are not recoverable and the chart must not imply they are.

A gameweek with no row draws as a gap and reads as an em dash in the table. A
single snapshot draws a dot, so the first day after a sweep is a chart rather
than an empty frame."
```

---

## Follow-ups this plan knows it is leaving

Not tasks — things to write into the spec's own follow-ups section at merge, unless
they get fixed on the way:

- `sync_runs` has no column for what a sweep did, so the admin history's "Gameweeks"
  cell is empty for every `players-*` row. The counts are only visible in the manual
  trigger's reply. One nullable `items_synced` column would fix it; it was left out
  because the spec asked both cadences to share one row shape unchanged.
- Every new environment variable still forces an edit in six places. This slice adds
  none, so the shared test stub the standings slice asked for is still not urgent — but
  the market slice will need it.
- The shared `Db` type alias is now copied verbatim in six modules rather than four.
- `players.status` is a free string. Once the capture's distinct values are known and
  stable for a few weeks, a lookup table becomes worth having.
- Nothing prunes `player_value_snapshots`. A full season is around six hundred players
  times two hundred and fifty days; that is the point of the table, but it is unbounded
  in a way `raw_sync_payloads` is not.
