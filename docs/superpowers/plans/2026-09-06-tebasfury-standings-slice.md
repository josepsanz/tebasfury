# TebasFury Step 2 — Standings and progress slice: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the league opens the portal and sees where everyone stands, live during a round, and how the season got there.

**Architecture:** One endpoint feeds everything: `GET …/leagues/{id}/standing[/{week}]` returns all 13 teams at once. Only measured values are stored — points scored in a week, rank within it — and cumulative totals and table positions are derived by a pure function, so the two can never drift. A sync run ends by deciding when the next should be and scheduling it on QStash, so there is no fixed cron burning calls while nothing happens.

**Tech Stack:** Next.js 16.3, Drizzle 0.45 over Neon, better-auth 1.7, Zod 4, Upstash QStash, Vitest 5 with PGlite, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-06-tebasfury-standings-slice-design.md`

## Global Constraints

- The portal is named **TebasFury**, capital F.
- **Everything is written in English** — documentation, comments, test names, commit messages and every user-visible string.
- Node 24, pnpm 11. All dependencies pinned to exact versions (`-E`).
- TypeScript `strict`. No explicit `any` in production code.
- Roles are `user`, `collaborator`, `admin`.
- **`pnpm test` must keep running with no environment variables, no `.env.local` and no network.** Every test in this plan obeys that.
- **Never `db.transaction()`.** `neon-http` does not support it and PGlite does, so a transaction passes every test and throws in production. Group writes with **`db.batch()`**.
- **The API is the only source of truth for shape.** Every response is parsed with Zod before it enters the system; nothing else in the codebase may import from `lib/fantasy-client/` except its own public functions.
- No secrets in the repository.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/crypto/index.ts` | AES-256-GCM `seal` / `open` |
| `src/lib/fantasy-client/schemas.ts` | Zod schemas for every response |
| `src/lib/fantasy-client/credentials.ts` | Read and rotate the stored refresh token |
| `src/lib/fantasy-client/index.ts` | The client: token exchange and the four data calls |
| `src/lib/fantasy-client/__fixtures__/*.json` | Anonymised real responses, moved from `spike/` |
| `src/lib/domain/standings.ts` | Pure: snapshots → table and the four series |
| `src/lib/sync/index.ts` | Orchestration; returns when to run next |
| `src/lib/scheduler/index.ts` | QStash publish and signature verification |
| `src/app/api/sync/route.ts` | The endpoint QStash calls |
| `src/app/(portal)/standings/page.tsx` | The table |
| `src/app/(portal)/progress/page.tsx` | The four charts |
| `src/components/progress-chart.tsx` | The chart, client-side |
| `src/app/admin/sync/page.tsx` | Bootstrap field, manual trigger, run history |

---

### Task 1: Encrypted credential store

**Files:**
- Create: `src/lib/crypto/index.ts`, `src/lib/crypto/index.test.ts`
- Create: `src/lib/fantasy-client/credentials.ts`, `src/lib/fantasy-client/credentials.test.ts`
- Modify: `src/lib/db/schema.ts`, `src/lib/env.ts`, `src/lib/env.test.ts`, `.env.example`

**Interfaces:**
- Consumes: `getEnv()`, `createTestDatabase()`.
- Produces:
  - `seal(plaintext: string): string` and `open(sealed: string): string` — AES-256-GCM, key from `CREDENTIALS_KEY`. The sealed form is `iv.ciphertext.tag`, base64url, dot-separated.
  - `loadRefreshToken(db): Promise<{ refreshToken: string; clientId: string } | null>`
  - `saveRefreshToken(db, args: { refreshToken: string; clientId: string; updatedBy: string }): Promise<void>` — upserts the single row.

- [ ] **Step 1: Add `CREDENTIALS_KEY` to the environment schema**

In `src/lib/env.ts`, add to `envSchema`:

```ts
  CREDENTIALS_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "must be 32 bytes, base64 encoded",
  }),
```

Add to `.env.example`, with a comment in English:

```bash
# 32-byte key, base64, sealing the stored LaLiga refresh token.
# Generate with: openssl rand -base64 32
# Must differ per environment. Losing it means re-bootstrapping the credential.
CREDENTIALS_KEY=""
```

In `src/lib/env.test.ts`, add `CREDENTIALS_KEY: Buffer.alloc(32).toString("base64")` to the `valid` fixture, and add this test:

```ts
  it("rejects a credentials key that is not 32 bytes", () => {
    expect(() =>
      parseEnv({ ...valid, CREDENTIALS_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrowError(/CREDENTIALS_KEY/);
  });
```

- [ ] **Step 2: Run the env tests and watch them fail**

Run: `pnpm test src/lib/env.test.ts`
Expected: FAIL — the new test passes no key of the wrong length yet because the field does not exist, so `parseEnv` does not reject it.

- [ ] **Step 3: Run them again after the schema change and watch them pass**

Run: `pnpm test src/lib/env.test.ts`
Expected: PASS, 6 tests. Also add `CREDENTIALS_KEY` to the `env` block in `playwright.config.ts`, with the value `Buffer.alloc(32).toString("base64")` written out literally as `"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="`, so the E2E suite still builds with no `.env.local`.

- [ ] **Step 4: Write the failing crypto test**

`src/lib/crypto/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { open, seal } from "./index";

const KEY = Buffer.alloc(32, 7).toString("base64");
process.env.CREDENTIALS_KEY = KEY;

describe("seal and open", () => {
  it("round-trips a secret", () => {
    expect(open(seal("a-refresh-token"))).toBe("a-refresh-token");
  });

  it("produces a different ciphertext each time", () => {
    expect(seal("same")).not.toBe(seal("same"));
  });

  it("refuses a tampered ciphertext", () => {
    const sealed = seal("a-refresh-token");
    const [iv, body, tag] = sealed.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 0xff;
    expect(() => open([iv, flipped.toString("base64url"), tag].join("."))).toThrowError();
  });

  it("refuses a sealed value with the wrong number of parts", () => {
    expect(() => open("only.two")).toThrowError(/malformed/i);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `pnpm test src/lib/crypto`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 6: Implement the crypto module**

`src/lib/crypto/index.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";

function key(): Buffer {
  return Buffer.from(getEnv().CREDENTIALS_KEY, "base64");
}

/** Encrypts a secret for storage. The result is `iv.ciphertext.tag`, base64url. */
export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, body, cipher.getAuthTag()].map((b) => b.toString("base64url")).join(".");
}

/** Reverses `seal`. Throws if the value was tampered with or is not well formed. */
export function open(sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 3) throw new Error("Malformed sealed value");
  const [iv, body, tag] = parts.map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 7: Run it and watch it pass**

Run: `pnpm test src/lib/crypto`
Expected: PASS, 4 tests.

- [ ] **Step 8: Add the credentials table**

In `src/lib/db/schema.ts`:

```ts
export const leagueCredentials = pgTable("league_credentials", {
  id: text("id").primaryKey(),
  refreshTokenSealed: text("refresh_token_sealed").notNull(),
  clientId: text("client_id").notNull(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").notNull(),
});
```

The table holds exactly one row, keyed by the constant `"league"`. A single-row table rather than a config file because the refresh token rotates on every use and has to be written back at runtime.

Run: `pnpm drizzle-kit generate`

- [ ] **Step 9: Write the failing credentials test**

`src/lib/fantasy-client/credentials.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { leagueCredentials } from "@/lib/db/schema";
import { loadRefreshToken, saveRefreshToken } from "./credentials";

process.env.CREDENTIALS_KEY = Buffer.alloc(32, 3).toString("base64");

describe("credential storage", () => {
  let h: TestDatabase;
  beforeAll(async () => { h = await createTestDatabase(); });
  afterAll(async () => { await h.close(); });

  it("returns null when nothing has been stored", async () => {
    expect(await loadRefreshToken(h.db)).toBeNull();
  });

  it("stores a token and reads it back", async () => {
    await saveRefreshToken(h.db, { refreshToken: "tok-1", clientId: "cid", updatedBy: "u1" });
    expect(await loadRefreshToken(h.db)).toEqual({ refreshToken: "tok-1", clientId: "cid" });
  });

  it("never writes the token in the clear", async () => {
    await saveRefreshToken(h.db, { refreshToken: "tok-secret", clientId: "cid", updatedBy: "u1" });
    const [row] = await h.db.select().from(leagueCredentials);
    expect(row.refreshTokenSealed).not.toContain("tok-secret");
  });

  it("replaces the token on rotation rather than adding a row", async () => {
    await saveRefreshToken(h.db, { refreshToken: "tok-2", clientId: "cid", updatedBy: "u1" });
    await saveRefreshToken(h.db, { refreshToken: "tok-3", clientId: "cid", updatedBy: "u1" });
    expect(await h.db.select().from(leagueCredentials)).toHaveLength(1);
    expect((await loadRefreshToken(h.db))?.refreshToken).toBe("tok-3");
  });
});
```

- [ ] **Step 10: Run it and watch it fail**

Run: `pnpm test src/lib/fantasy-client/credentials.test.ts`
Expected: FAIL — cannot resolve `./credentials`.

- [ ] **Step 11: Implement the credential store**

`src/lib/fantasy-client/credentials.ts`:

```ts
import { eq } from "drizzle-orm";
import { leagueCredentials } from "@/lib/db/schema";
import { open, seal } from "@/lib/crypto";

/** The single row's key. There is one league, so there is one credential. */
const ROW_ID = "league";

type Db = { select: (...args: never[]) => unknown } & Record<string, unknown>;

export async function loadRefreshToken(
  db: typeof import("@/lib/db").db,
): Promise<{ refreshToken: string; clientId: string } | null> {
  const rows = await db.select().from(leagueCredentials).where(eq(leagueCredentials.id, ROW_ID));
  const row = rows[0];
  if (!row) return null;
  return { refreshToken: open(row.refreshTokenSealed), clientId: row.clientId };
}

export async function saveRefreshToken(
  db: typeof import("@/lib/db").db,
  args: { refreshToken: string; clientId: string; updatedBy: string },
): Promise<void> {
  const values = {
    id: ROW_ID,
    refreshTokenSealed: seal(args.refreshToken),
    clientId: args.clientId,
    rotatedAt: new Date(),
    updatedBy: args.updatedBy,
  };
  await db.insert(leagueCredentials).values(values).onConflictDoUpdate({
    target: leagueCredentials.id,
    set: values,
  });
}
```

If the `Db` type above causes friction, type both functions' first parameter as the exported `Database` type from `@/lib/db` and delete the local alias — the tests pass a PGlite instance, so use whichever typing compiles against both without `any`.

- [ ] **Step 12: Run the tests and watch them pass**

Run: `pnpm test src/lib/fantasy-client/credentials.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 13: Run everything and commit**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`
Expected: all green, zero lint warnings.

```bash
git add -A
git commit -m "feat: encrypted store for the rotating LaLiga refresh token

AES-256-GCM sealing with a key from the environment, and a single-row table
rather than a config value, because the refresh token rotates on every use
and has to be written back at runtime."
```

---

### Task 2: Response schemas and token exchange

**Files:**
- Create: `src/lib/fantasy-client/schemas.ts`, `src/lib/fantasy-client/schemas.test.ts`
- Create: `src/lib/fantasy-client/__fixtures__/` (moved from `spike/fixtures/`)
- Create: `src/lib/fantasy-client/index.ts`, `src/lib/fantasy-client/index.test.ts`

**Interfaces:**
- Consumes: `loadRefreshToken`, `saveRefreshToken` from Task 1.
- Produces:
  - `standingEntrySchema`, `standingSchema`, `currentWeekSchema`, `leaguesSchema` — Zod schemas.
  - Types `StandingEntry`, `CurrentWeek`, `League` inferred from them.
  - `getAccessToken(db): Promise<string>` — exchanges the stored refresh token, **persists the rotation before returning**, throws `CredentialError` when the credential is missing or rejected.
  - `class CredentialError extends Error` — the named state the admin page reacts to.

- [ ] **Step 1: Move the fixtures into the module that owns them**

```bash
mkdir -p src/lib/fantasy-client/__fixtures__
git mv spike/fixtures/standing.json src/lib/fantasy-client/__fixtures__/standing-live.json
git mv spike/fixtures/standing-week-3.json src/lib/fantasy-client/__fixtures__/standing-settled.json
git mv spike/fixtures/week-current.json src/lib/fantasy-client/__fixtures__/week-current.json
git mv spike/fixtures/leagues.json src/lib/fantasy-client/__fixtures__/leagues.json
git mv spike/fixtures/user-me.json src/lib/fantasy-client/__fixtures__/user-me.json
```

They are anonymised real responses. They belong beside the code whose shape they pin.

- [ ] **Step 2: Write the failing schema test**

`src/lib/fantasy-client/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import live from "./__fixtures__/standing-live.json";
import settled from "./__fixtures__/standing-settled.json";
import week from "./__fixtures__/week-current.json";
import leagues from "./__fixtures__/leagues.json";
import { currentWeekSchema, leaguesSchema, standingSchema } from "./schemas";

describe("schemas parse the real captured responses", () => {
  it("parses a live gameweek standing", () => {
    const parsed = standingSchema.parse(live);
    expect(parsed).toHaveLength(13);
    expect(parsed[0].livePoints).toEqual(expect.any(Number));
    expect(parsed[0].previousPosition).toEqual(expect.any(Number));
  });

  it("parses a settled gameweek standing, which carries neither live points nor a previous position", () => {
    const parsed = standingSchema.parse(settled);
    expect(parsed).toHaveLength(13);
    expect(parsed[0].livePoints).toBeUndefined();
    expect(parsed[0].previousPosition).toBeUndefined();
  });

  it("parses the current week", () => {
    const parsed = currentWeekSchema.parse(week);
    expect(parsed.weekNumber).toEqual(expect.any(Number));
    expect(parsed.isLive).toEqual(expect.any(Boolean));
    expect(parsed.openingWeekDate).toBeInstanceOf(Date);
  });

  it("parses the league list", () => {
    const parsed = leaguesSchema.parse(leagues);
    expect(parsed[0].id).toEqual(expect.any(String));
    expect(parsed[0].name).toEqual(expect.any(String));
  });

  it("rejects a standing entry that lost its points field", () => {
    const broken = structuredClone(live) as unknown[];
    delete (broken[0] as Record<string, unknown>).points;
    expect(() => standingSchema.parse(broken)).toThrowError();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test src/lib/fantasy-client/schemas.test.ts`
Expected: FAIL — cannot resolve `./schemas`.

- [ ] **Step 4: Write the schemas**

`src/lib/fantasy-client/schemas.ts`:

```ts
import { z } from "zod";

/**
 * A team as the standing endpoint reports it.
 *
 * `teamValue`, `teamPoints` and `teamMoney` are CURRENT state even inside a past
 * gameweek's response — verified across all 13 teams, identical between the week-3
 * response and today's. Only the entry's `points` and `position` are week-specific.
 */
const standingTeamSchema = z.object({
  id: z.string(),
  managerId: z.number(),
  teamValue: z.number(),
  teamPoints: z.number(),
  teamMoney: z.number().nullable(),
  isAdmin: z.boolean(),
  manager: z.object({
    id: z.string(),
    managerName: z.string(),
  }),
});

/**
 * A live gameweek carries `livePoints` and `previousPosition`; a settled one does
 * not. Both are optional for that reason, and their absence is meaningful.
 */
export const standingEntrySchema = z.object({
  position: z.number(),
  previousPosition: z.number().optional(),
  points: z.number(),
  livePoints: z.number().optional(),
  team: standingTeamSchema,
});

export const standingSchema = z.array(standingEntrySchema);

export const currentWeekSchema = z.object({
  weekNumber: z.number(),
  isLive: z.boolean(),
  nextWeek: z.number().nullable().optional(),
  previousWeek: z.number().nullable().optional(),
  openingWeekDate: z.coerce.date(),
  closingWeekDate: z.coerce.date(),
});

export const leaguesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    managersNumber: z.number(),
  }),
);

export type StandingEntry = z.infer<typeof standingEntrySchema>;
export type CurrentWeek = z.infer<typeof currentWeekSchema>;
export type League = z.infer<typeof leaguesSchema>[number];
```

Add `"resolveJsonModule": true` to `tsconfig.json`'s `compilerOptions` if importing the fixtures does not typecheck.

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm test src/lib/fantasy-client/schemas.test.ts`
Expected: PASS, 5 tests. If a schema rejects a fixture, **fix the schema, not the fixture** — the fixture is a real response and it is right.

- [ ] **Step 6: Write the failing token-exchange test**

`src/lib/fantasy-client/index.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { loadRefreshToken, saveRefreshToken } from "./credentials";
import { CredentialError, getAccessToken } from "./index";

process.env.CREDENTIALS_KEY = Buffer.alloc(32, 5).toString("base64");

describe("getAccessToken", () => {
  let h: TestDatabase;
  beforeAll(async () => { h = await createTestDatabase(); });
  afterAll(async () => { await h.close(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("throws a CredentialError when nothing is stored", async () => {
    await expect(getAccessToken(h.db)).rejects.toBeInstanceOf(CredentialError);
  });

  it("exchanges the stored token and persists the rotation", async () => {
    await saveRefreshToken(h.db, { refreshToken: "old", clientId: "cid", updatedBy: "u" });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "at", refresh_token: "new", expires_in: 86400 }), {
        status: 200, headers: { "content-type": "application/json" },
      })));

    expect(await getAccessToken(h.db)).toBe("at");
    expect((await loadRefreshToken(h.db))?.refreshToken).toBe("new");
  });

  it("keeps the previous token when the response omits a new one", async () => {
    await saveRefreshToken(h.db, { refreshToken: "keep-me", clientId: "cid", updatedBy: "u" });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "at", expires_in: 86400 }), {
        status: 200, headers: { "content-type": "application/json" },
      })));

    await getAccessToken(h.db);
    expect((await loadRefreshToken(h.db))?.refreshToken).toBe("keep-me");
  });

  it("throws a CredentialError when the provider rejects the token", async () => {
    await saveRefreshToken(h.db, { refreshToken: "expired", clientId: "cid", updatedBy: "u" });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));

    await expect(getAccessToken(h.db)).rejects.toBeInstanceOf(CredentialError);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm test src/lib/fantasy-client/index.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 8: Implement the token exchange**

`src/lib/fantasy-client/index.ts`:

```ts
import type { db as productionDb } from "@/lib/db";
import { loadRefreshToken, saveRefreshToken } from "./credentials";

type Db = typeof productionDb;

const TOKEN_URL =
  "https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token" +
  "?p=B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN";

/**
 * The credential is missing, or the provider refused it. This is a distinct state
 * from a transport failure: recovering needs a person and a browser, so the admin
 * page names it rather than showing a generic error.
 */
export class CredentialError extends Error {}

/**
 * Exchanges the stored refresh token for a 24-hour access token.
 *
 * The rotated refresh token is persisted BEFORE the access token is returned.
 * Losing a rotation costs a manual browser bootstrap, so the write comes first.
 */
export async function getAccessToken(db: Db): Promise<string> {
  const stored = await loadRefreshToken(db);
  if (!stored) throw new CredentialError("No LaLiga credential has been stored yet");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: stored.clientId,
      scope: `openid ${stored.clientId} offline_access`,
      refresh_token: stored.refreshToken,
    }),
  });

  if (!res.ok) {
    throw new CredentialError(`The identity provider refused the refresh token (${res.status})`);
  }

  const body = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!body.access_token) throw new CredentialError("The token response carried no access token");

  if (body.refresh_token) {
    await saveRefreshToken(db, {
      refreshToken: body.refresh_token,
      clientId: stored.clientId,
      updatedBy: "sync",
    });
  }

  return body.access_token;
}
```

- [ ] **Step 9: Run it and watch it pass**

Run: `pnpm test src/lib/fantasy-client/index.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 10: Run everything and commit**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: response schemas and token exchange for the LaLiga client

Schemas are pinned against the anonymised real responses, which move out of
the throwaway spike directory to sit beside the code whose shape they
describe. They encode the difference the capture revealed: a live gameweek
carries live points and a previous position, a settled one carries neither.

The rotated refresh token is written before the access token is returned,
because losing a rotation costs a manual browser bootstrap."
```

---

### Task 3: The slice's tables

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/db/schema.test.ts`
- Create: `drizzle/0003_*.sql` (generated)

**Interfaces:**
- Consumes: `createTestDatabase()`.
- Produces: the Drizzle tables `teams`, `gameweeks`, `teamGameweekStats`, `syncRuns`, `rawSyncPayloads`, and the removal of `user.fantasyTeamId`.

- [ ] **Step 1: Write the failing schema test**

`src/lib/db/schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./testing";
import { gameweeks, syncRuns, teamGameweekStats, teams } from "./schema";

describe("the standings schema", () => {
  let h: TestDatabase;
  beforeAll(async () => { h = await createTestDatabase(); });
  afterAll(async () => { await h.close(); });

  it("stores a team keyed by the id the API gives it", async () => {
    await h.db.insert(teams).values({ id: "38128693", managerId: 9878336, managerName: "Manager A" });
    const [row] = await h.db.select().from(teams);
    expect(row).toMatchObject({ id: "38128693", managerName: "Manager A" });
    expect(row.userId).toBeNull();
  });

  it("stores a gameweek", async () => {
    await h.db.insert(gameweeks).values({
      number: 4,
      opensAt: new Date("2026-09-04T21:00:00Z"),
      closesAt: new Date("2026-09-08T03:00:00Z"),
      isLive: true,
    });
    const [row] = await h.db.select().from(gameweeks);
    expect(row.number).toBe(4);
    expect(row.isLive).toBe(true);
  });

  it("stores a snapshot with team value left unknown, as a backfilled week has it", async () => {
    await h.db.insert(teamGameweekStats).values({
      teamId: "38128693", gameweek: 3, points: 36, roundPosition: 9, isProvisional: false,
    });
    const [row] = await h.db.select().from(teamGameweekStats);
    expect(row).toMatchObject({ gameweek: 3, points: 36, roundPosition: 9 });
    expect(row.teamValue).toBeNull();
    expect(row.livePoints).toBeNull();
  });

  it("keeps one snapshot per team and gameweek", async () => {
    await h.db.insert(teamGameweekStats).values({
      teamId: "38128693", gameweek: 4, points: 43, roundPosition: 1, isProvisional: true, livePoints: 43,
    });
    await h.db.insert(teamGameweekStats).values({
      teamId: "38128693", gameweek: 4, points: 51, roundPosition: 1, isProvisional: false,
    }).onConflictDoUpdate({
      target: [teamGameweekStats.teamId, teamGameweekStats.gameweek],
      set: { points: 51, isProvisional: false, livePoints: null },
    });
    const rows = await h.db.select().from(teamGameweekStats);
    const week4 = rows.filter((r) => r.gameweek === 4);
    expect(week4).toHaveLength(1);
    expect(week4[0]).toMatchObject({ points: 51, isProvisional: false });
  });

  it("records a sync run", async () => {
    await h.db.insert(syncRuns).values({ id: "run-1", trigger: "manual", status: "running" });
    const [row] = await h.db.select().from(syncRuns);
    expect(row).toMatchObject({ trigger: "manual", status: "running" });
    expect(row.finishedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test src/lib/db/schema.test.ts`
Expected: FAIL — `gameweeks` and the rest are not exported.

- [ ] **Step 3: Reshape `teams` and drop the column pointing the other way**

Replace the existing `teams` table in `src/lib/db/schema.ts` with:

```ts
/**
 * A team as LaLiga Fantasy models it. The API gives teams no name — they are
 * identified by their manager — so the display identity is `managerName`.
 */
export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  managerId: integer("manager_id").notNull(),
  managerName: text("manager_name").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Delete the line `fantasyTeamId: text("fantasy_team_id"),` from the `user` table, and delete the matching `fantasyTeamId` entry from `user.additionalFields` in `src/lib/auth/auth.ts`. The link between a portal account and a team now lives in one place, `teams.userId`, with a foreign key.

Add `integer` to the existing import from `drizzle-orm/pg-core`.

- [ ] **Step 4: Add the new tables**

Append to `src/lib/db/schema.ts`:

```ts
export const gameweeks = pgTable("gameweeks", {
  number: integer("number").primaryKey(),
  opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
  isLive: boolean("is_live").notNull().default(false),
});

/**
 * One row per team per gameweek, holding only what the API states for that week.
 *
 * Cumulative points and table position are NOT stored: they are a pure function of
 * this series, and keeping both would let them drift. `roundPosition` is the rank
 * WITHIN the week, which is what the API's `position` means here — it is not the
 * table position after that week.
 *
 * `teamValue` and `teamPoints` are nullable because a backfilled week cannot know
 * them: the API reports current state, not the state at that week.
 */
export const teamGameweekStats = pgTable(
  "team_gameweek_stats",
  {
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    gameweek: integer("gameweek").notNull().references(() => gameweeks.number),
    points: integer("points").notNull(),
    roundPosition: integer("round_position").notNull(),
    livePoints: integer("live_points"),
    isProvisional: boolean("is_provisional").notNull().default(false),
    teamValue: bigint("team_value", { mode: "number" }),
    teamPoints: integer("team_points"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.gameweek] })],
);

export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  weeksSynced: integer("weeks_synced"),
  error: text("error"),
});

export const rawSyncPayloads = pgTable("raw_sync_payloads", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").notNull(),
});
```

Add `bigint`, `jsonb` and `primaryKey` to the import from `drizzle-orm/pg-core`. `teamValue` is `bigint` because team values run into the hundreds of millions and will keep growing.

- [ ] **Step 5: Generate the migration and check what it does to `teams`**

Run: `pnpm drizzle-kit generate`

Open the generated SQL. It will drop `teams.name` and `user.fantasy_team_id`. That is intended — `teams` has no production data and no consumer, and the column never matched the source. Confirm it does **not** drop the `teams` table itself.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pnpm test src/lib/db`
Expected: PASS. The harness applies every migration, so a broken one fails here.

- [ ] **Step 7: Commit**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: tables for gameweek snapshots, sync runs and raw payloads

teams loses its name column, which never existed in the API — teams are
identified by their manager — and gains a foreign key to the portal account,
settling the direction the skeleton review left open. user.fantasy_team_id
goes, so the link lives in one place.

Snapshots store only what the API states for a week. Team value is nullable
because a backfilled week cannot know it: the API reports current state."
```

---

### Task 4: The pure logic

**Files:**
- Create: `src/lib/domain/standings.ts`, `src/lib/domain/standings.test.ts`

**Interfaces:**
- Consumes: nothing. This module has no imports outside its own types — that is the point.
- Produces:
  - `type Snapshot = { teamId: string; gameweek: number; points: number; roundPosition: number; livePoints: number | null; isProvisional: boolean; teamValue: number | null }`
  - `type TeamRef = { id: string; managerName: string }`
  - `buildTable(snapshots, teams): TableRow[]` — the current table, sorted, with cumulative points, table position and movement.
  - `type TableRow = { teamId: string; managerName: string; position: number; previousPosition: number | null; cumulativePoints: number; livePoints: number | null; teamValue: number | null; isProvisional: boolean }`
  - `buildSeries(snapshots, teams): Series` where `Series = { pointsPerWeek: Point[]; cumulativePoints: Point[]; tablePosition: Point[]; teamValue: Point[] }` and `Point = { teamId: string; gameweek: number; value: number | null }`

- [ ] **Step 1: Write the failing test**

`src/lib/domain/standings.test.ts`. The fixture below is deliberately built so that the round winner is not the table leader — that is the trap this module exists to avoid.

```ts
import { describe, expect, it } from "vitest";
import { buildSeries, buildTable, type Snapshot, type TeamRef } from "./standings";

const teams: TeamRef[] = [
  { id: "a", managerName: "Manager A" },
  { id: "b", managerName: "Manager B" },
];

const snap = (
  teamId: string, gameweek: number, points: number, roundPosition: number,
  extra: Partial<Snapshot> = {},
): Snapshot => ({
  teamId, gameweek, points, roundPosition,
  livePoints: null, isProvisional: false, teamValue: null, ...extra,
});

//  gw1: A 50 (1st in round), B 10 (2nd)
//  gw2: A 10 (2nd in round), B 40 (1st)
//  cumulative after gw2: A 60, B 50 — A leads the table although B won round 2.
const season: Snapshot[] = [
  snap("a", 1, 50, 1), snap("b", 1, 10, 2),
  snap("a", 2, 10, 2), snap("b", 2, 40, 1),
];

describe("buildTable", () => {
  it("ranks by cumulative points, not by the last round's position", () => {
    const table = buildTable(season, teams);
    expect(table.map((r) => r.teamId)).toEqual(["a", "b"]);
    expect(table[0]).toMatchObject({ position: 1, cumulativePoints: 60 });
    expect(table[1]).toMatchObject({ position: 2, cumulativePoints: 50 });
  });

  it("reports movement against the previous gameweek's table", () => {
    // After gw1 the table was A 1st, B 2nd; after gw2 it is unchanged.
    const table = buildTable(season, teams);
    expect(table[0].previousPosition).toBe(1);
    expect(table[1].previousPosition).toBe(2);
  });

  it("has no previous position when only one gameweek has been played", () => {
    const table = buildTable([snap("a", 1, 50, 1), snap("b", 1, 10, 2)], teams);
    expect(table[0].previousPosition).toBeNull();
  });

  it("marks the table provisional while the latest gameweek is live", () => {
    const live = [...season, snap("a", 3, 5, 2, { isProvisional: true, livePoints: 5 })];
    const table = buildTable(live, teams);
    expect(table.find((r) => r.teamId === "a")?.isProvisional).toBe(true);
    expect(table.find((r) => r.teamId === "a")?.livePoints).toBe(5);
  });

  it("includes a team with no snapshots at all, on zero", () => {
    const table = buildTable([snap("a", 1, 50, 1)], teams);
    expect(table.find((r) => r.teamId === "b")).toMatchObject({ cumulativePoints: 0 });
  });

  it("breaks ties by manager name so the order is stable", () => {
    const tied = [snap("a", 1, 10, 1), snap("b", 1, 10, 1)];
    expect(buildTable(tied, teams).map((r) => r.teamId)).toEqual(["a", "b"]);
  });
});

describe("buildSeries", () => {
  it("returns points scored in each gameweek", () => {
    const { pointsPerWeek } = buildSeries(season, teams);
    expect(pointsPerWeek).toContainEqual({ teamId: "a", gameweek: 2, value: 10 });
  });

  it("accumulates points across gameweeks", () => {
    const { cumulativePoints } = buildSeries(season, teams);
    expect(cumulativePoints).toContainEqual({ teamId: "a", gameweek: 2, value: 60 });
    expect(cumulativePoints).toContainEqual({ teamId: "b", gameweek: 2, value: 50 });
  });

  it("computes table position per gameweek from the cumulative totals", () => {
    const { tablePosition } = buildSeries(season, teams);
    // B won round 2 but is still 2nd in the table.
    expect(tablePosition).toContainEqual({ teamId: "b", gameweek: 2, value: 2 });
    expect(tablePosition).toContainEqual({ teamId: "a", gameweek: 2, value: 1 });
  });

  it("leaves team value null for gameweeks that never recorded one", () => {
    const withValue = [...season, snap("a", 3, 20, 1, { teamValue: 250_000_000 })];
    const { teamValue } = buildSeries(withValue, teams);
    expect(teamValue).toContainEqual({ teamId: "a", gameweek: 1, value: null });
    expect(teamValue).toContainEqual({ teamId: "a", gameweek: 3, value: 250_000_000 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test src/lib/domain`
Expected: FAIL — cannot resolve `./standings`.

- [ ] **Step 3: Implement it**

`src/lib/domain/standings.ts`:

```ts
export type Snapshot = {
  teamId: string;
  gameweek: number;
  points: number;
  roundPosition: number;
  livePoints: number | null;
  isProvisional: boolean;
  teamValue: number | null;
};

export type TeamRef = { id: string; managerName: string };

export type TableRow = {
  teamId: string;
  managerName: string;
  position: number;
  previousPosition: number | null;
  cumulativePoints: number;
  livePoints: number | null;
  teamValue: number | null;
  isProvisional: boolean;
};

export type Point = { teamId: string; gameweek: number; value: number | null };

export type Series = {
  pointsPerWeek: Point[];
  cumulativePoints: Point[];
  tablePosition: Point[];
  teamValue: Point[];
};

const weeksIn = (snapshots: Snapshot[]): number[] =>
  [...new Set(snapshots.map((s) => s.gameweek))].sort((a, b) => a - b);

/**
 * Ranks teams by cumulative points up to and including `upTo`.
 *
 * This is the whole reason the module exists: the API's `position` inside a
 * gameweek is the rank WITHIN that round, so the table has to be recomputed from
 * the totals. Ties break on manager name, so the order never wobbles between
 * renders.
 */
function rankAt(snapshots: Snapshot[], teams: TeamRef[], upTo: number): Map<string, number> {
  const totals = new Map(teams.map((t) => [t.id, 0]));
  for (const s of snapshots) {
    if (s.gameweek <= upTo) totals.set(s.teamId, (totals.get(s.teamId) ?? 0) + s.points);
  }
  const names = new Map(teams.map((t) => [t.id, t.managerName]));
  const ordered = [...totals.entries()].sort(
    (a, b) => b[1] - a[1] || (names.get(a[0]) ?? "").localeCompare(names.get(b[0]) ?? ""),
  );
  return new Map(ordered.map(([teamId], i) => [teamId, i + 1]));
}

export function buildTable(snapshots: Snapshot[], teams: TeamRef[]): TableRow[] {
  const weeks = weeksIn(snapshots);
  const latest = weeks.at(-1) ?? 0;
  const previous = weeks.length > 1 ? weeks[weeks.length - 2] : null;

  const current = rankAt(snapshots, teams, latest);
  const before = previous === null ? null : rankAt(snapshots, teams, previous);

  return teams
    .map((team): TableRow => {
      const mine = snapshots.filter((s) => s.teamId === team.id);
      const latestSnapshot = mine.find((s) => s.gameweek === latest) ?? null;
      const withValue = [...mine].reverse().find((s) => s.teamValue !== null) ?? null;
      return {
        teamId: team.id,
        managerName: team.managerName,
        position: current.get(team.id) ?? teams.length,
        previousPosition: before?.get(team.id) ?? null,
        cumulativePoints: mine.reduce((sum, s) => sum + s.points, 0),
        livePoints: latestSnapshot?.livePoints ?? null,
        teamValue: withValue?.teamValue ?? null,
        isProvisional: latestSnapshot?.isProvisional ?? false,
      };
    })
    .sort((a, b) => a.position - b.position);
}

export function buildSeries(snapshots: Snapshot[], teams: TeamRef[]): Series {
  const weeks = weeksIn(snapshots);
  const at = new Map(snapshots.map((s) => [`${s.teamId}:${s.gameweek}`, s]));

  const pointsPerWeek: Point[] = [];
  const cumulativePoints: Point[] = [];
  const tablePosition: Point[] = [];
  const teamValue: Point[] = [];

  const running = new Map(teams.map((t) => [t.id, 0]));
  for (const gameweek of weeks) {
    const ranks = rankAt(snapshots, teams, gameweek);
    for (const team of teams) {
      const s = at.get(`${team.id}:${gameweek}`);
      running.set(team.id, (running.get(team.id) ?? 0) + (s?.points ?? 0));
      pointsPerWeek.push({ teamId: team.id, gameweek, value: s?.points ?? null });
      cumulativePoints.push({ teamId: team.id, gameweek, value: running.get(team.id) ?? 0 });
      tablePosition.push({ teamId: team.id, gameweek, value: ranks.get(team.id) ?? null });
      teamValue.push({ teamId: team.id, gameweek, value: s?.teamValue ?? null });
    }
  }

  return { pointsPerWeek, cumulativePoints, tablePosition, teamValue };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test src/lib/domain`
Expected: PASS, 10 tests.

- [ ] **Step 5: Confirm the module is genuinely pure**

Run: `grep -nE '^import' src/lib/domain/standings.ts`
Expected: **no output**. If anything is imported, the module has picked up a dependency and the whole point is lost.

- [ ] **Step 6: Commit**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: pure logic turning gameweek snapshots into a table and four series

The module imports nothing, so the whole computation is testable without a
network or a database. Its reason to exist is the trap the capture revealed:
the API's position inside a gameweek is the rank within that round, not the
table position after it, so the table is recomputed from cumulative totals."
```

---

### Task 5: The client's data calls

**Files:**
- Modify: `src/lib/fantasy-client/index.ts`
- Modify: `src/lib/fantasy-client/index.test.ts`
- Modify: `src/lib/env.ts`, `src/lib/env.test.ts`, `.env.example`, `playwright.config.ts`

**Interfaces:**
- Consumes: `getAccessToken`, the schemas from Task 2.
- Produces:
  - `getCurrentWeek(accessToken): Promise<CurrentWeek>`
  - `getStanding(accessToken, leagueId, week?): Promise<StandingEntry[]>` — omit `week` for the live table.
  - `getLeagues(accessToken): Promise<League[]>`
  - `type FantasyClient` — the interface Task 6 injects a fake for:
    ```ts
    export type FantasyClient = {
      getCurrentWeek(): Promise<CurrentWeek>;
      getStanding(week?: number): Promise<StandingEntry[]>;
    };
    ```
  - `createClient(db, leagueId): Promise<FantasyClient>` — resolves an access token once and binds it, so a sync run exchanges the credential a single time.

- [ ] **Step 1: Add the league id to the environment**

In `src/lib/env.ts`, add `LALIGA_LEAGUE_ID: z.string().min(1),`.

In `.env.example`:

```bash
# The private league's id, as the LaLiga Fantasy API reports it.
# Find it with: GET /v1/competition/1/leagues (see spike/README.md)
LALIGA_LEAGUE_ID=""
```

Add `LALIGA_LEAGUE_ID: valid.LALIGA_LEAGUE_ID` to the test fixture in
`src/lib/env.test.ts` by adding `LALIGA_LEAGUE_ID: "018012894"` to the `valid` object,
and add `LALIGA_LEAGUE_ID: "test-league"` to the `env` block in `playwright.config.ts`.

Run: `pnpm test src/lib/env.test.ts`
Expected: PASS — the existing tests still hold with the extra field.

- [ ] **Step 2: Write the failing test for the data calls**

Append to `src/lib/fantasy-client/index.test.ts`:

```ts
import live from "./__fixtures__/standing-live.json";
import weekFixture from "./__fixtures__/week-current.json";
import { getCurrentWeek, getStanding } from "./index";

describe("data calls", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("parses the current week", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(weekFixture), { status: 200 })));
    const week = await getCurrentWeek("at");
    expect(week.weekNumber).toBe(4);
    expect(week.isLive).toBe(true);
  });

  it("sends the access token as a bearer credential", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(live), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await getStanding("my-token", "018012894");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer my-token");
  });

  it("asks for a specific gameweek when one is given", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(live), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await getStanding("at", "018012894", 3);
    expect(fetchMock.mock.calls[0][0]).toContain("/standing/3");
  });

  it("asks for the live table when no gameweek is given", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(live), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await getStanding("at", "018012894");
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/standing$/);
  });

  it("throws when the API answers with an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ code: 404, message: "Not Found" }), { status: 404 })));
    await expect(getStanding("at", "nope")).rejects.toThrowError(/404/);
  });

  it("throws when the response no longer matches the schema", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify([{ unexpected: true }]), { status: 200 })));
    await expect(getStanding("at", "018012894")).rejects.toThrowError();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test src/lib/fantasy-client/index.test.ts`
Expected: FAIL — `getCurrentWeek` and `getStanding` are not exported.

- [ ] **Step 4: Implement the data calls**

Append to `src/lib/fantasy-client/index.ts`:

```ts
import {
  currentWeekSchema, leaguesSchema, standingSchema,
  type CurrentWeek, type League, type StandingEntry,
} from "./schemas";

const API_BASE = "https://fantasy-api.llt-services.com/api";
const COMPETITION = "1"; // LaLiga EA Sports

async function apiGet<T>(accessToken: string, path: string, schema: { parse: (v: unknown) => T }) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`LaLiga API answered ${res.status} for ${path}`);
  }
  return schema.parse(await res.json());
}

export function getCurrentWeek(accessToken: string): Promise<CurrentWeek> {
  return apiGet(accessToken, `/v1/competition/${COMPETITION}/week/current`, currentWeekSchema);
}

export function getLeagues(accessToken: string): Promise<League[]> {
  return apiGet(accessToken, `/v1/competition/${COMPETITION}/leagues?x-lang=es`, leaguesSchema);
}

/** Omit `week` for the live table; pass one to read a settled gameweek. */
export function getStanding(
  accessToken: string, leagueId: string, week?: number,
): Promise<StandingEntry[]> {
  const suffix = week === undefined ? "" : `/${week}`;
  return apiGet(
    accessToken,
    `/v1/competition/${COMPETITION}/leagues/${leagueId}/standing${suffix}`,
    standingSchema,
  );
}

/** The narrow surface a sync run needs. Task 6 injects a fake shaped like this. */
export type FantasyClient = {
  getCurrentWeek(): Promise<CurrentWeek>;
  getStanding(week?: number): Promise<StandingEntry[]>;
};

/** Exchanges the credential once and binds it, so one run means one token exchange. */
export async function createClient(db: Db, leagueId: string): Promise<FantasyClient> {
  const accessToken = await getAccessToken(db);
  return {
    getCurrentWeek: () => getCurrentWeek(accessToken),
    getStanding: (week) => getStanding(accessToken, leagueId, week),
  };
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm test src/lib/fantasy-client`
Expected: PASS, 15 tests across the three files.

- [ ] **Step 6: Commit**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: the client's data calls, behind Zod on every response

createClient exchanges the credential once and binds it, so a sync run costs
one token exchange rather than one per call, and it exposes only the narrow
surface the sync needs so a fake can stand in for it."
```

---

### Task 6: The sync engine

**Files:**
- Create: `src/lib/sync/index.ts`, `src/lib/sync/index.test.ts`
- Create: `src/lib/sync/next-run.ts`, `src/lib/sync/next-run.test.ts`

**Interfaces:**
- Consumes: `FantasyClient` from Task 5; the tables from Task 3.
- Produces:
  - `decideNextRun(week: CurrentWeek, now: Date): Date` — pure.
  - `runSync(deps: { db; client: FantasyClient; now: Date; runId: string }): Promise<SyncResult>` where `SyncResult = { weeksSynced: number[]; nextRunAt: Date }`.

- [ ] **Step 1: Write the failing test for the schedule decision**

`src/lib/sync/next-run.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideNextRun, LIVE_INTERVAL_MS, MAX_INTERVAL_MS } from "./next-run";

const week = (over: Partial<Parameters<typeof decideNextRun>[0]> = {}) => ({
  weekNumber: 4,
  isLive: false,
  openingWeekDate: new Date("2026-09-11T19:00:00Z"),
  closingWeekDate: new Date("2026-09-15T01:00:00Z"),
  ...over,
});

const now = new Date("2026-09-08T12:00:00Z");

describe("decideNextRun", () => {
  it("comes back in ten minutes while the gameweek is live", () => {
    const next = decideNextRun(week({ isLive: true }), now);
    expect(next.getTime() - now.getTime()).toBe(LIVE_INTERVAL_MS);
  });

  it("waits for the next gameweek to open when nothing is live", () => {
    const next = decideNextRun(week(), now);
    expect(next.toISOString()).toBe("2026-09-11T19:00:00.000Z");
  });

  it("never waits longer than the heartbeat, so a missed schedule cannot strand the chain", () => {
    const faraway = week({ openingWeekDate: new Date("2026-12-01T19:00:00Z") });
    const next = decideNextRun(faraway, now);
    expect(next.getTime() - now.getTime()).toBe(MAX_INTERVAL_MS);
  });

  it("falls back to the live interval when the opening date is already past", () => {
    const stale = week({ openingWeekDate: new Date("2026-09-01T19:00:00Z") });
    const next = decideNextRun(stale, now);
    expect(next.getTime() - now.getTime()).toBe(LIVE_INTERVAL_MS);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test src/lib/sync/next-run.test.ts`
Expected: FAIL — cannot resolve `./next-run`.

- [ ] **Step 3: Implement the schedule decision**

`src/lib/sync/next-run.ts`:

```ts
import type { CurrentWeek } from "@/lib/fantasy-client/schemas";

export const LIVE_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Decides when the next sync should run, from data the run already fetched.
 *
 * While a gameweek is live the table moves, so we come back quickly. Otherwise we
 * wait for the next gameweek to open — but never longer than a day, so a schedule
 * lost by QStash or a deploy cannot strand the chain forever.
 */
export function decideNextRun(week: CurrentWeek, now: Date): Date {
  if (week.isLive) return new Date(now.getTime() + LIVE_INTERVAL_MS);

  const opening = week.openingWeekDate.getTime();
  const delay = opening - now.getTime();

  if (delay <= 0) return new Date(now.getTime() + LIVE_INTERVAL_MS);
  return new Date(now.getTime() + Math.min(delay, MAX_INTERVAL_MS));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test src/lib/sync/next-run.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for the run itself**

`src/lib/sync/index.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { gameweeks, syncRuns, teamGameweekStats, teams } from "@/lib/db/schema";
import type { FantasyClient } from "@/lib/fantasy-client";
import type { CurrentWeek, StandingEntry } from "@/lib/fantasy-client/schemas";
import { runSync } from "./index";

const entry = (teamId: string, managerName: string, points: number, position: number,
               over: Partial<StandingEntry> = {}): StandingEntry => ({
  position, points, team: {
    id: teamId, managerId: Number(teamId), teamValue: 250_000_000, teamPoints: 100,
    teamMoney: null, isAdmin: false, manager: { id: teamId, managerName },
  }, ...over,
});

function fakeClient(week: Partial<CurrentWeek>, byWeek: Record<string, StandingEntry[]>): FantasyClient {
  return {
    getCurrentWeek: async () => ({
      weekNumber: 3, isLive: false,
      openingWeekDate: new Date("2026-09-11T19:00:00Z"),
      closingWeekDate: new Date("2026-09-15T01:00:00Z"),
      ...week,
    }),
    getStanding: async (w) => byWeek[w === undefined ? "live" : String(w)] ?? [],
  };
}

const now = new Date("2026-09-08T12:00:00Z");

describe("runSync", () => {
  let h: TestDatabase;
  beforeAll(async () => { h = await createTestDatabase(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => {
    await h.db.delete(teamGameweekStats);
    await h.db.delete(gameweeks);
    await h.db.delete(teams);
    await h.db.delete(syncRuns);
  });

  it("backfills every gameweek from an empty database", async () => {
    const client = fakeClient({ weekNumber: 3, isLive: false }, {
      "1": [entry("1", "Manager A", 50, 1)],
      "2": [entry("1", "Manager A", 10, 1)],
      "3": [entry("1", "Manager A", 36, 1)],
    });

    const result = await runSync({ db: h.db, client, now, runId: "r1" });

    expect(result.weeksSynced).toEqual([1, 2, 3]);
    const rows = await h.db.select().from(teamGameweekStats);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.points).sort((a, b) => a - b)).toEqual([10, 36, 50]);
  });

  it("registers the team once, from the manager the API reports", async () => {
    const client = fakeClient({ weekNumber: 1 }, { "1": [entry("7", "Manager G", 5, 1)] });
    await runSync({ db: h.db, client, now, runId: "r1" });
    await runSync({ db: h.db, client, now, runId: "r2" });
    const rows = await h.db.select().from(teams);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "7", managerName: "Manager G" });
  });

  it("stores a live gameweek as provisional, with its live points", async () => {
    const client = fakeClient({ weekNumber: 1, isLive: true }, {
      live: [entry("1", "Manager A", 43, 1, { livePoints: 43, previousPosition: 2 })],
    });
    await runSync({ db: h.db, client, now, runId: "r1" });
    const [row] = await h.db.select().from(teamGameweekStats);
    expect(row).toMatchObject({ gameweek: 1, isProvisional: true, livePoints: 43 });
  });

  it("overwrites a provisional gameweek once it settles", async () => {
    const liveClient = fakeClient({ weekNumber: 1, isLive: true }, {
      live: [entry("1", "Manager A", 43, 1, { livePoints: 43 })],
    });
    await runSync({ db: h.db, client: liveClient, now, runId: "r1" });

    const settledClient = fakeClient({ weekNumber: 1, isLive: false }, {
      "1": [entry("1", "Manager A", 61, 1)],
    });
    await runSync({ db: h.db, client: settledClient, now, runId: "r2" });

    const rows = await h.db.select().from(teamGameweekStats);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ points: 61, isProvisional: false, livePoints: null });
  });

  it("leaves settled gameweeks alone on a later run", async () => {
    const client = fakeClient({ weekNumber: 2 }, {
      "1": [entry("1", "Manager A", 50, 1)],
      "2": [entry("1", "Manager A", 10, 1)],
    });
    await runSync({ db: h.db, client, now, runId: "r1" });
    const second = await runSync({ db: h.db, client, now, runId: "r2" });
    expect(second.weeksSynced).toEqual([]);
  });

  it("records the run and what it did", async () => {
    const client = fakeClient({ weekNumber: 1 }, { "1": [entry("1", "Manager A", 5, 1)] });
    await runSync({ db: h.db, client, now, runId: "r1" });
    const [run] = await h.db.select().from(syncRuns);
    expect(run).toMatchObject({ id: "r1", status: "succeeded", weeksSynced: 1 });
    expect(run.finishedAt).not.toBeNull();
  });

  it("records a failure and rethrows, leaving earlier snapshots in place", async () => {
    const good = fakeClient({ weekNumber: 1 }, { "1": [entry("1", "Manager A", 5, 1)] });
    await runSync({ db: h.db, client: good, now, runId: "r1" });

    const broken: FantasyClient = {
      getCurrentWeek: async () => { throw new Error("upstream is down"); },
      getStanding: async () => [],
    };
    await expect(runSync({ db: h.db, client: broken, now, runId: "r2" })).rejects.toThrowError(/upstream/);

    const [run] = await h.db.select().from(syncRuns).where(eq(syncRuns.id, "r2"));
    expect(run).toMatchObject({ status: "failed" });
    expect(run.error).toContain("upstream is down");
    expect(await h.db.select().from(teamGameweekStats)).toHaveLength(1);
  });
});
```

Add `import { eq } from "drizzle-orm";` at the top of the test file.

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm test src/lib/sync/index.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 7: Implement the run**

`src/lib/sync/index.ts`:

```ts
import { eq, lt } from "drizzle-orm";
import type { db as productionDb } from "@/lib/db";
import { gameweeks, rawSyncPayloads, syncRuns, teamGameweekStats, teams } from "@/lib/db/schema";
import type { FantasyClient } from "@/lib/fantasy-client";
import type { StandingEntry } from "@/lib/fantasy-client/schemas";
import { decideNextRun } from "./next-run";

type Db = typeof productionDb;

export type SyncResult = { weeksSynced: number[]; nextRunAt: Date };

const PAYLOAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One sync run.
 *
 * Writes are grouped with `db.batch()`, never `db.transaction()`: the production
 * driver is neon-http, which has no transaction support, while the PGlite used in
 * tests does — so a transaction would pass every test and throw in production.
 */
export async function runSync(deps: {
  db: Db; client: FantasyClient; now: Date; runId: string;
}): Promise<SyncResult> {
  const { db, client, now, runId } = deps;

  await db.insert(syncRuns).values({ id: runId, trigger: "schedule", status: "running" });

  try {
    const week = await client.getCurrentWeek();

    const existing = await db.select().from(teamGameweekStats);
    const settled = new Set(
      existing.filter((r) => !r.isProvisional).map((r) => r.gameweek),
    );

    // Every week up to the current one that we do not already hold as settled.
    const wanted: number[] = [];
    for (let w = 1; w <= week.weekNumber; w += 1) if (!settled.has(w)) wanted.push(w);

    const weeksSynced: number[] = [];
    for (const w of wanted) {
      const isCurrent = w === week.weekNumber;
      const provisional = isCurrent && week.isLive;
      const entries = await client.getStanding(provisional ? undefined : w);
      if (entries.length === 0) continue;

      await db
        .insert(gameweeks)
        .values({
          number: w,
          opensAt: isCurrent ? week.openingWeekDate : now,
          closesAt: isCurrent ? week.closingWeekDate : now,
          isLive: provisional,
        })
        .onConflictDoUpdate({ target: gameweeks.number, set: { isLive: provisional } });

      await db.batch([
        ...upsertTeams(db, entries),
        ...upsertStats(db, entries, w, provisional),
        db.insert(rawSyncPayloads).values({
          id: `${runId}-${w}`,
          endpoint: `standing/${provisional ? "live" : w}`,
          payload: entries,
        }),
      ]);

      weeksSynced.push(w);
    }

    await prunePayloads(db, now);

    const nextRunAt = decideNextRun(week, now);
    await db.update(syncRuns).set({
      status: "succeeded", finishedAt: new Date(), weeksSynced: weeksSynced.length,
    }).where(eq(syncRuns.id, runId));

    return { weeksSynced, nextRunAt };
  } catch (error) {
    await db.update(syncRuns).set({
      status: "failed",
      finishedAt: new Date(),
      error: error instanceof Error ? error.message : String(error),
    }).where(eq(syncRuns.id, runId));
    throw error;
  }
}

function upsertTeams(db: Db, entries: StandingEntry[]) {
  return entries.map((e) =>
    db.insert(teams).values({
      id: e.team.id,
      managerId: e.team.managerId,
      managerName: e.team.manager.managerName,
    }).onConflictDoUpdate({
      target: teams.id,
      set: { managerName: e.team.manager.managerName },
    }),
  );
}

/**
 * `teamValue` and `teamPoints` describe CURRENT state — verified identical between a
 * past gameweek's response and today's — so they are only truthful for the week we
 * are observing live. A backfilled week writes null for both.
 *
 * When a live week later settles, the update deliberately does NOT touch those two
 * columns: the value we recorded while the week was live is the only reading we will
 * ever have for it, and overwriting it with null would destroy the very history this
 * slice exists to build.
 */
function upsertStats(db: Db, entries: StandingEntry[], gameweek: number, live: boolean) {
  return entries.map((e) => {
    const measured = {
      teamId: e.team.id,
      gameweek,
      points: e.points,
      roundPosition: e.position,
      livePoints: e.livePoints ?? null,
      isProvisional: live,
      syncedAt: new Date(),
    };

    return db
      .insert(teamGameweekStats)
      .values({
        ...measured,
        teamValue: live ? e.team.teamValue : null,
        teamPoints: live ? e.team.teamPoints : null,
      })
      .onConflictDoUpdate({
        target: [teamGameweekStats.teamId, teamGameweekStats.gameweek],
        set: live
          ? { ...measured, teamValue: e.team.teamValue, teamPoints: e.team.teamPoints }
          : measured,
      });
  });
}

/** Drops raw payloads past the retention window. They exist to debug a shape change, not to accumulate. */
async function prunePayloads(db: Db, now: Date) {
  const cutoff = new Date(now.getTime() - PAYLOAD_RETENTION_MS);
  await db.delete(rawSyncPayloads).where(lt(rawSyncPayloads.fetchedAt, cutoff));
}
```

Note what the `set` clause above achieves, because it is the subtle part: a settled
update carries only the measured columns, so an existing `teamValue` recorded while
the week was live **survives the overwrite**. Task 4's series builder depends on this;
without it, every week's team value would be nulled the moment the week closed.

- [ ] **Step 8: Add the test that pins the value-survives-settling rule**

This behaviour is easy to break and silent when broken, so it gets its own test.
Append to `src/lib/sync/index.test.ts`, inside the `runSync` describe:

```ts
  it("keeps the team value recorded while live when the gameweek settles", async () => {
    const liveClient = fakeClient({ weekNumber: 1, isLive: true }, {
      live: [entry("1", "Manager A", 43, 1, { livePoints: 43 })],
    });
    await runSync({ db: h.db, client: liveClient, now, runId: "r1" });

    const settledClient = fakeClient({ weekNumber: 1, isLive: false }, {
      "1": [entry("1", "Manager A", 61, 1)],
    });
    await runSync({ db: h.db, client: settledClient, now, runId: "r2" });

    const [row] = await h.db.select().from(teamGameweekStats);
    expect(row.points).toBe(61);
    expect(row.isProvisional).toBe(false);
    // The only reading we will ever have for this week's value.
    expect(row.teamValue).toBe(250_000_000);
  });

  it("leaves team value null for a week that was only ever backfilled", async () => {
    const client = fakeClient({ weekNumber: 2 }, {
      "1": [entry("1", "Manager A", 50, 1)],
      "2": [entry("1", "Manager A", 10, 1)],
    });
    await runSync({ db: h.db, client, now, runId: "r1" });
    const rows = await h.db.select().from(teamGameweekStats);
    expect(rows.every((r) => r.teamValue === null)).toBe(true);
  });
```

- [ ] **Step 9: Run the tests and watch them pass**

Run: `pnpm test src/lib/sync`
Expected: PASS, 13 tests across the two files.

- [ ] **Step 10: Confirm no transaction crept in**

Run: `grep -rn 'db.transaction' src/`
Expected: **no output.**

- [ ] **Step 11: Commit**

Run: `pnpm test && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: the sync engine, with a self-scheduling next run

A run backfills every gameweek it does not already hold as settled, writes
the live one as provisional, and overwrites it when it settles. It ends by
deciding when to come back — ten minutes while live, otherwise the next
gameweek's opening, capped at a day so a lost schedule cannot strand the
chain.

Writes group with db.batch(). neon-http has no transactions and PGlite does,
so a transaction would pass every test and fail only in production."
```

---

### Task 7: Scheduler, sync endpoint and the admin page

**Files:**
- Create: `src/lib/scheduler/index.ts`, `src/lib/scheduler/index.test.ts`
- Create: `src/app/api/sync/route.ts`
- Modify: `src/app/admin/sync/page.tsx`
- Create: `src/app/admin/sync/actions.ts`
- Modify: `src/lib/env.ts`, `.env.example`, `playwright.config.ts`
- Modify: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `runSync`, `createClient`, `CredentialError`, `requirePermission`.
- Produces:
  - `scheduleNextRun(at: Date): Promise<void>` — publishes a delayed call to `/api/sync` on QStash.
  - `verifyQStashSignature(req: Request, body: string): Promise<boolean>`
  - Server actions `bootstrapCredential(formData)` and `triggerSyncNow()`.

- [ ] **Step 1: Install QStash and add its variables**

```bash
pnpm add -E @upstash/qstash@2.11.3
```

In `src/lib/env.ts` add:

```ts
  QSTASH_TOKEN: z.string().min(1),
  QSTASH_CURRENT_SIGNING_KEY: z.string().min(1),
  QSTASH_NEXT_SIGNING_KEY: z.string().min(1),
```

Add all three to `.env.example` with a comment saying they come from the Upstash
console, and to the `env` block in `playwright.config.ts` with dummy values
(`"qstash-dummy-token"`, `"sig-current"`, `"sig-next"`), so the E2E suite still builds
with no `.env.local`.

- [ ] **Step 2: Write the failing scheduler test**

`src/lib/scheduler/index.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { delaySecondsUntil } from "./index";

describe("delaySecondsUntil", () => {
  const now = new Date("2026-09-08T12:00:00Z");

  it("converts a future instant into whole seconds of delay", () => {
    expect(delaySecondsUntil(new Date("2026-09-08T12:10:00Z"), now)).toBe(600);
  });

  it("never asks for a negative delay", () => {
    expect(delaySecondsUntil(new Date("2026-09-08T11:00:00Z"), now)).toBe(0);
  });

  it("rounds a sub-second delay up to zero rather than a fraction", () => {
    expect(delaySecondsUntil(new Date("2026-09-08T12:00:00.400Z"), now)).toBe(0);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test src/lib/scheduler`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 4: Implement the scheduler**

`src/lib/scheduler/index.ts`:

```ts
import { Client, Receiver } from "@upstash/qstash";
import { getEnv } from "@/lib/env";

/** QStash takes a delay in whole seconds, and refuses a negative one. */
export function delaySecondsUntil(at: Date, now: Date): number {
  return Math.max(0, Math.floor((at.getTime() - now.getTime()) / 1000));
}

/**
 * Publishes the next sync to QStash.
 *
 * The chain is self-scheduling: each run books its own successor, so there is no
 * fixed cron making calls while nothing is happening.
 */
export async function scheduleNextRun(at: Date, now: Date = new Date()): Promise<void> {
  const client = new Client({ token: getEnv().QSTASH_TOKEN });
  await client.publishJSON({
    url: `${getEnv().BETTER_AUTH_URL}/api/sync`,
    delay: delaySecondsUntil(at, now),
    body: { trigger: "schedule" },
  });
}

export async function verifyQStashSignature(signature: string, body: string): Promise<boolean> {
  const receiver = new Receiver({
    currentSigningKey: getEnv().QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: getEnv().QSTASH_NEXT_SIGNING_KEY,
  });
  try {
    return await receiver.verify({ signature, body });
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm test src/lib/scheduler`
Expected: PASS, 3 tests.

- [ ] **Step 6: Write the sync endpoint**

`src/app/api/sync/route.ts`:

```ts
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { scheduleNextRun, verifyQStashSignature } from "@/lib/scheduler";
import { runSync } from "@/lib/sync";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("upstash-signature") ?? "";

  if (!(await verifyQStashSignature(signature, body))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
  const result = await runSync({ db, client, now: new Date(), runId: randomUUID() });
  await scheduleNextRun(result.nextRunAt);

  return Response.json({
    weeksSynced: result.weeksSynced,
    nextRunAt: result.nextRunAt.toISOString(),
  });
}
```

The endpoint rejects anything QStash did not sign, so the sync cannot be triggered by
a stranger with the URL. It deliberately does not catch the sync's errors: a failure is
already recorded in `sync_runs` by `runSync`, and letting it surface as a 500 makes
QStash retry.

- [ ] **Step 7: Write the admin server actions**

`src/app/admin/sync/actions.ts`:

```ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { saveRefreshToken } from "@/lib/fantasy-client/credentials";
import { CredentialError, createClient } from "@/lib/fantasy-client";
import { getEnv } from "@/lib/env";
import { requirePermission } from "@/lib/auth/guards";
import { scheduleNextRun } from "@/lib/scheduler";
import { runSync } from "@/lib/sync";

/** The public client id of the LaLiga web app, which is what issues the token. */
const CLIENT_ID = "6457fa17-1224-416a-b21a-ee6ce76e9bc0";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export async function bootstrapCredential(formData: FormData): Promise<ActionResult> {
  const session = await requirePermission({ sync: ["trigger"] });
  const token = String(formData.get("refreshToken") ?? "").trim();

  if (token.length < 100) {
    return { ok: false, message: "That does not look like a refresh token." };
  }

  await saveRefreshToken(db, {
    refreshToken: token,
    clientId: CLIENT_ID,
    updatedBy: session.user.id,
  });
  revalidatePath("/admin/sync");
  return { ok: true, message: "Credential stored. Run a sync to check it works." };
}

export async function triggerSyncNow(): Promise<ActionResult> {
  await requirePermission({ sync: ["trigger"] });

  try {
    const client = await createClient(db, getEnv().LALIGA_LEAGUE_ID);
    const result = await runSync({ db, client, now: new Date(), runId: randomUUID() });
    await scheduleNextRun(result.nextRunAt);
    revalidatePath("/standings");
    revalidatePath("/progress");
    revalidatePath("/admin/sync");
    return {
      ok: true,
      message: `Synced ${result.weeksSynced.length} gameweek(s). Next run at ${result.nextRunAt.toISOString()}.`,
    };
  } catch (error) {
    if (error instanceof CredentialError) {
      return {
        ok: false,
        message:
          "The stored credential no longer works. Sign in at miliga.laliga.com, capture a new " +
          "refresh token from the network tab, and paste it above. See spike/README.md.",
      };
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
```

A dead credential gets its own message naming the recovery, because the fix is a person
in a browser and a generic failure would send whoever hits it digging.

- [ ] **Step 8: Rebuild the admin page**

Replace `src/app/admin/sync/page.tsx`:

```tsx
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncRuns } from "@/lib/db/schema";
import { loadRefreshToken } from "@/lib/fantasy-client/credentials";
import { requirePermission } from "@/lib/auth/guards";
import { SyncControls } from "./sync-controls";

export default async function SyncPage() {
  await requirePermission({ sync: ["trigger"] });

  const [credential, runs] = await Promise.all([
    loadRefreshToken(db),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(10),
  ]);

  return (
    <section className="max-w-3xl">
      <h1 className="text-xl font-semibold">Sync</h1>
      <p className="mt-2 text-neutral-600">
        {credential
          ? "A LaLiga credential is stored. Syncs run on their own; trigger one here to check."
          : "No LaLiga credential is stored yet, so nothing can sync. Paste a bootstrap refresh token below."}
      </p>

      <SyncControls hasCredential={credential !== null} />

      <h2 className="mt-10 text-lg font-semibold">Recent runs</h2>
      {runs.length === 0 ? (
        <p className="mt-2 text-neutral-600">No sync has run yet.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Started</th><th>Trigger</th><th>Status</th>
              <th>Gameweeks</th><th>Error</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b">
                <td className="py-2">{run.startedAt.toISOString()}</td>
                <td>{run.trigger}</td>
                <td>{run.status}</td>
                <td>{run.weeksSynced ?? "—"}</td>
                <td className="text-neutral-600">{run.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

Create `src/app/admin/sync/sync-controls.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { bootstrapCredential, triggerSyncNow, type ActionResult } from "./actions";

export function SyncControls({ hasCredential }: { hasCredential: boolean }) {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-6 space-y-6">
      <form
        action={(formData) =>
          startTransition(async () => setResult(await bootstrapCredential(formData)))
        }
        className="space-y-2"
      >
        <label htmlFor="refreshToken" className="block text-sm font-medium">
          Bootstrap refresh token
        </label>
        <textarea
          id="refreshToken"
          name="refreshToken"
          rows={3}
          className="w-full rounded-md border px-3 py-2 font-mono text-xs"
          placeholder="Paste the refresh_token captured at miliga.laliga.com"
        />
        <button type="submit" disabled={pending} className="rounded-md border px-4 py-2 text-sm">
          Store credential
        </button>
      </form>

      <button
        type="button"
        disabled={pending || !hasCredential}
        onClick={() => startTransition(async () => setResult(await triggerSyncNow()))}
        className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-40"
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>

      {result && (
        <p role="status" className={result.ok ? "text-sm" : "text-sm text-red-700"}>
          {result.message}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Extend the E2E test for the renamed heading**

The page's heading is still "Sync", so `e2e/auth.spec.ts` keeps passing unchanged. Add
one test to it confirming the admin route is still gated, which is the property this
task could break:

```ts
test("the sync endpoint refuses an unsigned request", async ({ request }) => {
  const res = await request.post("/api/sync", { data: { trigger: "manual" } });
  expect(res.status()).toBe(401);
});
```

- [ ] **Step 10: Run everything**

Run: `pnpm test && pnpm test:e2e && pnpm lint && npx tsc --noEmit`
Expected: unit tests green, 6 E2E tests green, zero lint warnings.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: QStash scheduling, the sync endpoint and a working admin page

The endpoint rejects anything QStash did not sign, so nobody with the URL can
trigger a sync. It does not swallow sync errors either: the failure is already
recorded, and a 500 is what makes QStash retry.

A dead credential gets its own named message with the recovery steps, because
fixing it needs a person in a browser and a generic error would send whoever
hits it digging."
```

---

### Task 8: The two views

**Files:**
- Create: `src/app/(portal)/standings/page.tsx`
- Create: `src/app/(portal)/progress/page.tsx`
- Create: `src/components/standings-table.tsx`
- Create: `src/components/progress-charts.tsx`
- Create: `src/lib/db/queries.ts`, `src/lib/db/queries.test.ts`
- Modify: `src/app/layout.tsx`, `src/app/globals.css`, `src/components/app-nav.tsx`
- Modify: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `buildTable`, `buildSeries` from Task 4; the tables from Task 3.
- Produces:
  - `loadSnapshots(db): Promise<{ snapshots: Snapshot[]; teams: TeamRef[]; lastSync: Date | null; currentGameweek: number | null; isLive: boolean }>`
  - The two routes, linked from the navigation.

#### The design, already decided

The direction is **matchday board**, chosen from three mockups. It is committed to a
single dark treatment on purpose: this is read on a phone, in the evening, during a
round — there is no light-mode variant to maintain.

| Token | Value | Role |
|---|---|---|
| `--board-bg` | `#10120f` | The page. Near-black, very slightly green, so it is not a flat grey |
| `--board-line` | `#26291f` | Row rules |
| `--board-ink` | `#f4f4ef` | Primary text |
| `--board-ink-dim` | `#8b8f82` | Movement, labels, secondary figures |
| `--board-gain` | `#4ade80` | Points gained in a live round. **The only colour in the table** |
| `--board-form` | `#4a5040` / `#86917a` | Form bars; the lighter step marks that manager's own best |

Type: **Barlow Condensed** for the position numbers and totals, **Barlow** for
everything else. One family, two widths — a width contrast rather than a style
contrast, which is how scoreboards and athletics results have always been set, and
Barlow has the thin weights and tabular figures the design leans on. Load both from
Google Fonts via `next/font/google`, weights 200 and 400 for condensed, 400 and 500
for regular.

Rules that come from the mockup and are not negotiable while implementing:

- Position numbers are **thin and oversized** (`font-weight: 200`), at 42% opacity for
  everyone except the leader, who is at full. The eye finds first place without a badge.
- Movement is **spelled out** — "up from 3rd", "no change" — never an arrow or a
  triangle. It reads at a glance and needs no legend.
- **Green appears only on live points.** If a round is not in play there is no green
  anywhere on the page.
- The default right-hand column is **recent form**: three bars, the last three
  gameweeks, the tallest being that manager's own best. Between rounds this is what
  replaces the live column, so the page is never a list of zeros.
- Every page shows **when the data was last synced**. Stale data is visibly stale.

#### The charts

Four line charts over gameweeks: points per gameweek, cumulative points, table
position (inverted axis — first place at the top), and team value.

**Thirteen series is far past any categorical palette, so the charts do not try.** All
thirteen lines are drawn in `--board-ink-dim` at low opacity as context; a manager
pinned from the table gets one of three colours. Three is the cap because the first
three slots of the palette are the ones that clear the colourblind separation checks
against every other pair, verified against this exact background:

| Slot | Hex | Validated |
|---|---|---|
| 1 | `#3987e5` | worst all-pairs deutan ΔE 9.4, normal-vision 20.9, contrast ≥ 3:1 on `#10120f` |
| 2 | `#d95926` | same set |
| 3 | `#199e70` | same set |

**Pinned lines must carry a direct label at their right-hand end.** This is not
decoration: the tritan separation between slots 2 and 3 is low, and the direct label is
the secondary encoding that makes the palette legal. A legend alone is not enough.

Also required, and each of them is a rule rather than a preference:

- **One axis per chart.** Never two y-scales. Team value and points are different
  measures and live in different charts for that reason.
- **A table view.** A `<details>` element below each chart holding the same numbers,
  so the data is reachable without colour or hover.
- **Hover gives a crosshair and a tooltip** naming the gameweek and every pinned team's
  value at it.
- Colour follows the manager, not their rank: pinning and unpinning must not repaint
  the survivors. Assign by pin order and keep it.
- Grid and axes are recessive — `--board-line`, hairline, no chart border.

Use **Recharts** (`pnpm add -E recharts@2.15.4`), which renders SVG and takes the
tokens above as plain props. Do not reach for a canvas library; thirteen thin lines
over 38 gameweeks is nothing.

- [ ] **Step 1: Write the failing query test**

`src/lib/db/queries.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./testing";
import { gameweeks, syncRuns, teamGameweekStats, teams } from "./schema";
import { loadSnapshots } from "./queries";

describe("loadSnapshots", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(teams).values([
      { id: "t1", managerId: 1, managerName: "Manager A" },
      { id: "t2", managerId: 2, managerName: "Manager B" },
    ]);
    await h.db.insert(gameweeks).values([
      { number: 1, opensAt: new Date("2026-08-15T17:00:00Z"), closesAt: new Date("2026-08-18T01:00:00Z"), isLive: false },
      { number: 2, opensAt: new Date("2026-08-22T17:00:00Z"), closesAt: new Date("2026-08-25T01:00:00Z"), isLive: true },
    ]);
    await h.db.insert(teamGameweekStats).values([
      { teamId: "t1", gameweek: 1, points: 50, roundPosition: 1, isProvisional: false },
      { teamId: "t2", gameweek: 1, points: 10, roundPosition: 2, isProvisional: false },
      { teamId: "t1", gameweek: 2, points: 12, roundPosition: 2, isProvisional: true, livePoints: 12, teamValue: 250_000_000 },
      { teamId: "t2", gameweek: 2, points: 30, roundPosition: 1, isProvisional: true, livePoints: 30, teamValue: 210_000_000 },
    ]);
    await h.db.insert(syncRuns).values({
      id: "r1", trigger: "schedule", status: "succeeded",
      startedAt: new Date("2026-08-23T10:00:00Z"), finishedAt: new Date("2026-08-23T10:00:05Z"), weeksSynced: 1,
    });
  });
  afterAll(async () => { await h.close(); });

  it("returns every snapshot with its team", async () => {
    const { snapshots, teams: refs } = await loadSnapshots(h.db);
    expect(snapshots).toHaveLength(4);
    expect(refs.map((t) => t.managerName).sort()).toEqual(["Manager A", "Manager B"]);
  });

  it("reports the current gameweek and whether it is live", async () => {
    const { currentGameweek, isLive } = await loadSnapshots(h.db);
    expect(currentGameweek).toBe(2);
    expect(isLive).toBe(true);
  });

  it("reports when the last successful sync finished", async () => {
    const { lastSync } = await loadSnapshots(h.db);
    expect(lastSync?.toISOString()).toBe("2026-08-23T10:00:05.000Z");
  });

  it("ignores failed runs when reporting the last sync", async () => {
    await h.db.insert(syncRuns).values({
      id: "r2", trigger: "schedule", status: "failed",
      startedAt: new Date("2026-08-24T10:00:00Z"), finishedAt: new Date("2026-08-24T10:00:01Z"),
      error: "boom",
    });
    const { lastSync } = await loadSnapshots(h.db);
    expect(lastSync?.toISOString()).toBe("2026-08-23T10:00:05.000Z");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm test src/lib/db/queries.test.ts`
Expected: FAIL — cannot resolve `./queries`.

- [ ] **Step 3: Implement the query**

`src/lib/db/queries.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import type { db as productionDb } from "@/lib/db";
import type { Snapshot, TeamRef } from "@/lib/domain/standings";
import { gameweeks, syncRuns, teamGameweekStats, teams } from "./schema";

type Db = typeof productionDb;

export type PortalData = {
  snapshots: Snapshot[];
  teams: TeamRef[];
  lastSync: Date | null;
  currentGameweek: number | null;
  isLive: boolean;
};

/** Everything both views need, in one read. */
export async function loadSnapshots(db: Db): Promise<PortalData> {
  const [stats, teamRows, weeks, runs] = await Promise.all([
    db.select().from(teamGameweekStats),
    db.select().from(teams),
    db.select().from(gameweeks).orderBy(desc(gameweeks.number)).limit(1),
    db
      .select()
      .from(syncRuns)
      .where(and(eq(syncRuns.status, "succeeded")))
      .orderBy(desc(syncRuns.finishedAt))
      .limit(1),
  ]);

  return {
    snapshots: stats.map((r) => ({
      teamId: r.teamId,
      gameweek: r.gameweek,
      points: r.points,
      roundPosition: r.roundPosition,
      livePoints: r.livePoints,
      isProvisional: r.isProvisional,
      teamValue: r.teamValue,
    })),
    teams: teamRows.map((t) => ({ id: t.id, managerName: t.managerName })),
    lastSync: runs[0]?.finishedAt ?? null,
    currentGameweek: weeks[0]?.number ?? null,
    isLive: weeks[0]?.isLive ?? false,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm test src/lib/db/queries.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Set the type and the board tokens**

Install the fonts through `next/font/google` in `src/app/layout.tsx`, replacing the
Geist pair that `create-next-app` left behind — nothing uses them, and `globals.css`
currently overrides them with Arial anyway:

```tsx
import { Barlow, Barlow_Condensed } from "next/font/google";

const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500"] });
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed", subsets: ["latin"], weight: ["200", "400"],
});
```

Apply both variables on `<html>` in place of the Geist ones, and in
`src/app/globals.css` replace the `body { font-family: Arial… }` rule with the board
tokens and the real family:

```css
:root {
  --board-bg: #10120f;
  --board-line: #26291f;
  --board-ink: #f4f4ef;
  --board-ink-dim: #8b8f82;
  --board-gain: #4ade80;
  --board-form: #4a5040;
  --board-form-best: #86917a;
  --series-1: #3987e5;
  --series-2: #d95926;
  --series-3: #199e70;
}

body {
  background: var(--board-bg);
  color: var(--board-ink);
  font-family: var(--font-barlow), ui-sans-serif, system-ui, sans-serif;
}
```

The design commits to this single dark treatment, so there is no
`prefers-color-scheme` block. Set `color-scheme: dark` on `:root` so form controls and
scrollbars follow.

- [ ] **Step 6: Write the failing E2E tests for the two views**

Append to `e2e/auth.spec.ts`:

```ts
test("the standings page is reachable and names the league", async ({ page }) => {
  await page.goto("/standings");
  await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
});

test("the standings page says when it last synced", async ({ page }) => {
  await page.goto("/standings");
  await expect(page.getByText(/Last synced|Never synced/)).toBeVisible();
});

test("the progress page offers all four charts", async ({ page }) => {
  await page.goto("/progress");
  for (const name of ["Points per gameweek", "Cumulative points", "Table position", "Team value"]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
});

test("each chart carries a table view of the same numbers", async ({ page }) => {
  await page.goto("/progress");
  await expect(page.getByRole("group", { name: /Show the numbers/ }).first()).toBeVisible();
});
```

- [ ] **Step 7: Run them and watch them fail**

Run: `pnpm test:e2e`
Expected: FAIL — both routes 404.

- [ ] **Step 8: Build the standings table**

`src/components/standings-table.tsx` — a **server** component, so nothing about the
league ships to a browser that has not signed in:

```tsx
import type { TableRow } from "@/lib/domain/standings";

const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
};

/** Movement in words. An arrow needs a legend; "up from 3rd" does not. */
function movement(row: TableRow): string {
  if (row.previousPosition === null) return "";
  if (row.previousPosition === row.position) return "no change";
  return row.previousPosition > row.position
    ? `up from ${ordinal(row.previousPosition)}`
    : `down from ${ordinal(row.previousPosition)}`;
}

/** Three bars, the last three gameweeks, tallest is this manager's own best. */
function Form({ points }: { points: number[] }) {
  const best = Math.max(...points, 1);
  return (
    <div className="flex h-5 items-end justify-end gap-[3px]" aria-hidden>
      {points.map((p, i) => (
        <div
          key={i}
          className="w-[7px] rounded-[1px]"
          style={{
            height: `${Math.max(3, Math.round((p / best) * 20))}px`,
            background: p === best ? "var(--board-form-best)" : "var(--board-form)",
          }}
        />
      ))}
    </div>
  );
}

export function StandingsTable({
  rows, formByTeam, isLive,
}: {
  rows: TableRow[];
  formByTeam: Record<string, number[]>;
  isLive: boolean;
}) {
  return (
    <ol className="mt-4">
      {rows.map((row) => (
        <li
          key={row.teamId}
          className="grid grid-cols-[46px_1fr_auto_88px] items-center gap-3 border-b py-[11px]"
          style={{ borderColor: "var(--board-line)" }}
        >
          <span
            className="font-[var(--font-barlow-condensed)] text-[27px] font-extralight leading-none tabular-nums"
            style={{ opacity: row.position === 1 ? 1 : 0.42 }}
          >
            {row.position}
          </span>
          <span>
            <span className="block text-[14.5px]">{row.managerName}</span>
            <span className="block text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
              {movement(row)}
            </span>
          </span>
          <span className="font-[var(--font-barlow-condensed)] text-[20px] font-normal tabular-nums">
            {row.cumulativePoints}
          </span>
          {isLive && row.livePoints !== null ? (
            <span
              className="text-right text-[12px] tabular-nums"
              style={{ color: "var(--board-gain)" }}
            >
              +{row.livePoints}
            </span>
          ) : (
            <Form points={formByTeam[row.teamId] ?? []} />
          )}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 9: Build the standings page**

`src/app/(portal)/standings/page.tsx`:

```tsx
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { buildTable } from "@/lib/domain/standings";
import { requireSession } from "@/lib/auth/guards";
import { StandingsTable } from "@/components/standings-table";

export default async function StandingsPage() {
  await requireSession();
  const { snapshots, teams, lastSync, currentGameweek, isLive } = await loadSnapshots(db);
  const rows = buildTable(snapshots, teams);

  const formByTeam: Record<string, number[]> = {};
  const weeks = [...new Set(snapshots.map((s) => s.gameweek))].sort((a, b) => a - b).slice(-3);
  for (const team of teams) {
    formByTeam[team.id] = weeks.map(
      (w) => snapshots.find((s) => s.teamId === team.id && s.gameweek === w)?.points ?? 0,
    );
  }

  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-xl font-medium">Standings</h1>
      <p className="mt-1 text-[11.5px] tracking-[0.1em]" style={{ color: "var(--board-ink-dim)" }}>
        {currentGameweek === null
          ? "NO GAMEWEEK SYNCED YET"
          : isLive
            ? `GAMEWEEK ${currentGameweek} · IN PLAY`
            : `GAMEWEEK ${currentGameweek} · FINAL`}
      </p>

      {rows.length === 0 ? (
        <p className="mt-6" style={{ color: "var(--board-ink-dim)" }}>
          Nothing has synced yet. An admin can run the first sync from the Sync page.
        </p>
      ) : (
        <StandingsTable rows={rows} formByTeam={formByTeam} isLive={isLive} />
      )}

      <p className="mt-6 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastSync ? `Last synced ${lastSync.toISOString()}` : "Never synced"}
      </p>
    </section>
  );
}
```

The empty state names the action rather than apologising, and the last-sync line is
always present so stale data is visibly stale.

- [ ] **Step 10: Build the charts**

```bash
pnpm add -E recharts@2.15.4
```

`src/components/progress-charts.tsx` is a client component — it owns the pinning state
and the hover layer. Build it to this shape:

```tsx
"use client";

import { useState } from "react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Series, TeamRef } from "@/lib/domain/standings";

const PINNED_COLOURS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const MAX_PINNED = 3;

type ChartSpec = { key: keyof Series; title: string; invert?: boolean; format?: (v: number) => string };

const CHARTS: ChartSpec[] = [
  { key: "pointsPerWeek", title: "Points per gameweek" },
  { key: "cumulativePoints", title: "Cumulative points" },
  { key: "tablePosition", title: "Table position", invert: true },
  {
    key: "teamValue",
    title: "Team value",
    format: (v) => `${(v / 1_000_000).toFixed(1)}M`,
  },
];

export function ProgressCharts({ series, teams }: { series: Series; teams: TeamRef[] }) {
  const [pinned, setPinned] = useState<string[]>([]);

  const toggle = (teamId: string) =>
    setPinned((current) =>
      current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : current.length >= MAX_PINNED
          ? current
          : [...current, teamId],
    );

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap gap-2">
        {teams.map((team) => {
          const index = pinned.indexOf(team.id);
          return (
            <button
              key={team.id}
              type="button"
              onClick={() => toggle(team.id)}
              aria-pressed={index !== -1}
              className="rounded-full border px-3 py-1 text-[12px]"
              style={{
                borderColor: index === -1 ? "var(--board-line)" : PINNED_COLOURS[index],
                color: index === -1 ? "var(--board-ink-dim)" : "var(--board-ink)",
              }}
            >
              {team.managerName}
            </button>
          );
        })}
      </div>
      {pinned.length >= MAX_PINNED && (
        <p className="text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
          Three at a time. Unpin one to compare someone else.
        </p>
      )}

      {CHARTS.map((spec) => (
        <ChartBlock key={spec.key} spec={spec} points={series[spec.key]} teams={teams} pinned={pinned} />
      ))}
    </div>
  );
}
```

And `ChartBlock`, in the same file:

```tsx
type Row = { gameweek: number } & Record<string, number | null>;

/** Recharts wants one row per x value with a column per series. */
function toRows(points: { teamId: string; gameweek: number; value: number | null }[]): Row[] {
  const byWeek = new Map<number, Row>();
  for (const p of points) {
    const row = byWeek.get(p.gameweek) ?? ({ gameweek: p.gameweek } as Row);
    row[p.teamId] = p.value;
    byWeek.set(p.gameweek, row);
  }
  return [...byWeek.values()].sort((a, b) => a.gameweek - b.gameweek);
}

/**
 * Labels a pinned line at its right-hand end only.
 *
 * This is required, not decorative: the tritan separation between two of the three
 * pinned colours is low, so the label is the secondary encoding that makes the
 * palette legal. Colour alone must never carry identity.
 */
function EndLabel({ name, colour, lastGameweek }: { name: string; colour: string; lastGameweek: number }) {
  return function Label(props: { x?: number; y?: number; index?: number; payload?: Row }) {
    if (props.payload?.gameweek !== lastGameweek) return null;
    if (props.x === undefined || props.y === undefined) return null;
    return (
      <text x={props.x + 8} y={props.y + 4} fill={colour} fontSize={11}>
        {name}
      </text>
    );
  };
}

function ChartBlock({
  spec, points, teams, pinned,
}: {
  spec: ChartSpec;
  points: { teamId: string; gameweek: number; value: number | null }[];
  teams: TeamRef[];
  pinned: string[];
}) {
  const rows = toRows(points);
  const nameOf = (teamId: string) =>
    teams.find((t) => t.id === teamId)?.managerName ?? teamId;
  const format = spec.format ?? ((v: number) => String(v));

  if (rows.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-medium">{spec.title}</h2>
        <p className="mt-2 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
          {spec.key === "teamValue"
            ? "Team value only accumulates from the first sync onward — the API reports it as current state, so past gameweeks have none. This fills in one gameweek at a time."
            : "Nothing has synced yet."}
        </p>
      </div>
    );
  }

  const lastGameweek = rows[rows.length - 1].gameweek;
  const unpinned = teams.filter((t) => !pinned.includes(t.id));

  return (
    <div>
      <h2 className="text-lg font-medium">{spec.title}</h2>
      <div className="mt-3 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 96, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--board-line)" vertical={false} />
            <XAxis
              dataKey="gameweek"
              stroke="var(--board-line)"
              tick={{ fill: "var(--board-ink-dim)", fontSize: 11 }}
            />
            <YAxis
              reversed={spec.invert}
              domain={spec.invert ? [1, teams.length] : undefined}
              stroke="var(--board-line)"
              tick={{ fill: "var(--board-ink-dim)", fontSize: 11 }}
              tickFormatter={(v: number) => format(v)}
            />
            <Tooltip
              contentStyle={{
                background: "var(--board-bg)",
                border: "1px solid var(--board-line)",
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--board-ink-dim)" }}
              labelFormatter={(gw) => `Gameweek ${gw}`}
              // Thirteen rows of tooltip is unreadable, so only pinned managers appear.
              filterNull={false}
              itemSorter={(item) => -Number(item.value ?? 0)}
              formatter={(value: number, teamId: string) => [format(value), nameOf(teamId)]}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              {...({} as any)}
            />

            {/* Context first, so pinned lines draw on top of it. */}
            {unpinned.map((team) => (
              <Line
                key={team.id}
                type="monotone"
                dataKey={team.id}
                stroke="var(--board-ink-dim)"
                strokeOpacity={0.22}
                strokeWidth={1}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}

            {pinned.map((teamId, index) => {
              const colour = PINNED_COLOURS[index];
              return (
                <Line
                  key={teamId}
                  type="monotone"
                  dataKey={teamId}
                  stroke={colour}
                  strokeWidth={2}
                  dot={{ r: 4, fill: colour, stroke: "var(--board-bg)", strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                  label={EndLabel({ name: nameOf(teamId), colour, lastGameweek })}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="mt-2" aria-label={`Show the numbers for ${spec.title}`}>
        <summary className="cursor-pointer text-[12px]" style={{ color: "var(--board-ink-dim)" }}>
          Show the numbers
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="text-[12px] tabular-nums">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-medium">Manager</th>
                {rows.map((r) => (
                  <th key={r.gameweek} className="px-2 py-1 text-right font-medium">
                    {r.gameweek}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id}>
                  <td className="px-2 py-1">{team.managerName}</td>
                  {rows.map((r) => {
                    const v = r[team.id];
                    return (
                      <td key={r.gameweek} className="px-2 py-1 text-right">
                        {v === null || v === undefined ? "—" : format(Number(v))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
```

Two notes on the code above, because both are easy to undo by accident:

- **Unpinned lines are rendered before pinned ones.** SVG paints in document order, so
  reversing this buries the coloured lines under thirteen grey ones.
- The `Tooltip` props above are the shape Recharts 2.15 accepts, but its types for
  `formatter` and `itemSorter` are loose. If the `as any` escape hatch is needed to
  compile, keep it confined to that one prop spread and never widen it — the
  no-explicit-any rule holds everywhere else. If it typechecks without it, delete the
  spread and the eslint comment.

- [ ] **Step 11: Build the progress page**

`src/app/(portal)/progress/page.tsx`:

```tsx
import { db } from "@/lib/db";
import { loadSnapshots } from "@/lib/db/queries";
import { buildSeries } from "@/lib/domain/standings";
import { requireSession } from "@/lib/auth/guards";
import { ProgressCharts } from "@/components/progress-charts";

export default async function ProgressPage() {
  await requireSession();
  const { snapshots, teams, lastSync } = await loadSnapshots(db);
  const series = buildSeries(snapshots, teams);

  return (
    <section className="mx-auto max-w-4xl">
      <h1 className="text-xl font-medium">Progress</h1>
      <p className="mt-1 text-[13px]" style={{ color: "var(--board-ink-dim)" }}>
        Pin up to three managers to compare them. Everyone else stays as context.
      </p>
      <div className="mt-8">
        <ProgressCharts series={series} teams={teams} />
      </div>
      <p className="mt-10 text-[11px]" style={{ color: "var(--board-ink-dim)" }}>
        {lastSync ? `Last synced ${lastSync.toISOString()}` : "Never synced"}
      </p>
    </section>
  );
}
```

- [ ] **Step 12: Link both from the navigation**

In `src/components/app-nav.tsx`, add the two links between the brand and the admin
entry. They need a session, not a permission, so they render whenever `session` is set:

```tsx
      {session && <Link href="/standings">Standings</Link>}
      {session && <Link href="/progress">Progress</Link>}
```

- [ ] **Step 13: Run the E2E tests and watch them pass**

Run: `pnpm test:e2e`
Expected: the four new tests pass. They exercise the empty state, since the E2E database
is empty — which is exactly the state that is easiest to ship broken.

- [ ] **Step 14: Look at it**

Run `pnpm dev` and open `/standings` and `/progress` with real data in the database.
The validator checks colour, not layout. Check by eye: no label collisions on the
charts, the position numbers do not crowd long manager names on a narrow screen, the
form bars are legible, and the page does not scroll horizontally at 375px wide.

Fix what you see before calling this done.

- [ ] **Step 15: Commit**

Run: `pnpm test && pnpm test:e2e && pnpm lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat: the standings and progress views

The matchday-board direction, chosen from three mockups: oversized thin
position numbers, movement spelled out in words rather than arrows, and green
reserved for live points alone. Between rounds the live column becomes three
form bars, so the page is never a list of zeros for the four days a week when
nothing is in play.

Thirteen series is past any categorical palette, so the charts do not try:
every line is muted context and up to three pinned managers get colour. Three
is the cap because those slots clear the colourblind separation checks against
this background, and pinned lines carry direct labels because the label is the
secondary encoding that makes the palette legal."
```
