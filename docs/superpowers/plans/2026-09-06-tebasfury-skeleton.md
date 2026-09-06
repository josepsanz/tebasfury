# TebasFury — Implementation Plan: API Spike and Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify that the unofficial LaLiga Fantasy API is usable and, if so, get a TebasFury skeleton deployed on Vercel with Google login and three working roles.

**Architecture:** Next.js App Router on Postgres on Neon with Drizzle. Authentication and roles are handled by better-auth with the `admin` and `access` plugins, so permissions are declared policies rather than conditionals scattered through the code. Database tests run against in-process PGlite, no Docker.

**Tech Stack:** Next.js 16.3, React 19.2, TypeScript, Tailwind 4, Drizzle ORM 0.45, `@neondatabase/serverless` 1.1, better-auth 1.7, Zod 4, Vitest 5, PGlite 0.5, Playwright 1.63, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-09-06-tebasfury-portal-design.md`

## Global Constraints

- The portal is called **TebasFury**, with a capital F. This exact name goes in `package.json`, in the `<title>`, and in the metadata.
- Interface language and visible error messages: **English**.
- Node 24, pnpm 11. All dependencies are pinned to an exact version in `package.json`.
- TypeScript in `strict` mode. No explicit `any` in production code.
- **No calls to the LaLiga API from a web request.** This rule is not broken in any task in this plan.
- The three roles are always spelled `user`, `collaborator`, `admin`.
- No secrets in the repository. Everything through environment variables, with `.env.example` always kept up to date.

---

## Phase 0 — API Feasibility Spike *(BLOCKING GATE)*

**This is not an implementation task and doesn't follow a TDD cycle.** The output is an answer and a set of fixtures, not code that gets kept. Everything written here lives in `spike/` and gets deleted once it's done.

**If this phase fails, Phase 1 doesn't start.** We go back to the spec's data-source decision.

### Questions to answer

- [ ] **1. Authentication.** Open the official LaLiga Fantasy web app with the browser DevTools on the Network tab, log in, and capture the authentication call. Note: the exact URL, method, request body, response shape, where the token lives, and its expiry.
- [ ] **2. Refresh.** Determine whether there's a refresh token and which endpoint exchanges it. If there isn't one, note how long the session lasts: that decides how often the central token will need to be re-entered by hand.
- [ ] **3. Required headers.** Reproduce an authenticated call with `curl` outside the browser. Note which headers are mandatory (typically `Authorization`, and often `x-lang` or a specific `User-Agent`). A call that works in the browser and fails in `curl` is usually a missing header.
- [ ] **4. Private league.** Find the endpoint that lists the account's leagues and the one that gives the private league's standings. Note its identifier.
- [ ] **5. Points per gameweek.** Find the endpoint that gives a team's points per gameweek. Check whether it gives the full season history or only the current gameweek — **if it only gives the current gameweek, the history depends entirely on our sync never missing a gameweek**, and that must be written into the report.
- [ ] **6. Rate limits.** Make 30 calls in a row and check whether a 429 or `X-RateLimit-*` headers show up. Note whatever is found.

### Fixture collection

- [ ] **Save the raw response of every endpoint** to `spike/fixtures/<endpoint-name>.json`.
- [ ] **Anonymize them before committing them.** They contain the real names of the other managers. Replace names and emails with fictitious values, keeping the structure and types intact. These fixtures will be the basis for the `lib/fantasy-client/` tests in later phases.

### Report and gate

- [ ] **Write `spike/README.md`** with one answer per question, and at the top a one-line verdict: viable / viable with reservations / not viable.
- [ ] **Commit** the report and the anonymized fixtures:

```bash
git add spike/
git commit -m "spike: LaLiga Fantasy API feasibility report

Exploratory, throwaway code. The anonymized fixtures are kept as the basis
for the fantasy-client layer's tests."
```

- [ ] **GATE: stop and report to the project owner** with the verdict before continuing. If it's "not viable", this plan ends here.

---

## Phase 1 — Skeleton

### Task 1: Project scaffolding and validated environment configuration

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx` (via `create-next-app`)
- Create: `vitest.config.ts`
- Create: `src/lib/env.ts`
- Create: `.env.example`
- Test: `src/lib/env.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `getEnv(): Env` — reads and validates `process.env`, memoized. `Env` has `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, all `string`. Also `parseEnv(source: Record<string, string | undefined>): Env` so it can be tested without touching `process.env`.

- [ ] **Step 1: Generate the project**

The directory already contains `.git/` and `docs/`, which don't collide with `create-next-app`.

```bash
pnpm create next-app@16.3.4 . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm
```

- [ ] **Step 2: Check that it starts and builds**

```bash
pnpm build
```
Expected: successful build, no TypeScript errors.

- [ ] **Step 3: Set the portal's name**

In `package.json`, field `name`: `tebasfury`. In `src/app/layout.tsx`, the `metadata` export:

```ts
export const metadata: Metadata = {
  title: "TebasFury",
  description: "Management portal for our private LaLiga Fantasy league",
};
```

And the root's language attribute: `<html lang="en">`.

- [ ] **Step 4: Install Vitest and create its configuration**

```bash
pnpm add -D -E vitest@5.0.0 vite-tsconfig-paths@6.1.1
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

Add to `package.json`, inside `scripts`: `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 5: Write the failing test**

`src/lib/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:pass@host/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
};

describe("parseEnv", () => {
  it("returns the config when every variable is present", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("fails and names the missing variable", () => {
    const { GOOGLE_CLIENT_SECRET, ...incomplete } = valid;
    expect(() => parseEnv(incomplete)).toThrowError(/GOOGLE_CLIENT_SECRET/);
  });

  it("rejects a secret that's too short", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "too-short" })).toThrowError(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rejects a database URL that isn't a URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "not-a-url" })).toThrowError(
      /DATABASE_URL/,
    );
  });
});
```

- [ ] **Step 6: Run the test and check that it fails**

Run: `pnpm test src/lib/env.test.ts`
Expected: FAIL — cannot resolve the module `./env`.

- [ ] **Step 7: Implement `src/lib/env.ts`**

```ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return result.data;
}

let memo: Env | undefined;

export function getEnv(): Env {
  memo ??= parseEnv(process.env);
  return memo;
}
```

`getEnv()` is memoized and lazy on purpose: if we validated at module-load time, any import would break the tests and the build.

Even so, `src/lib/db/index.ts` (Task 2) calls it when building the connection, and
that module does get loaded during `pnpm build`. Practical consequence: **`pnpm build`
requires a complete `.env.local`**, including when Playwright spins up the server. On
Vercel this isn't a problem because the variables are present at build time.

Install Zod: `pnpm add -E zod@4.5.4`

- [ ] **Step 8: Run the test and check that it passes**

Run: `pnpm test src/lib/env.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Write `.env.example`**

```bash
DATABASE_URL="postgres://user:password@host/tebasfury"
BETTER_AUTH_SECRET="generate it with: openssl rand -base64 32"
BETTER_AUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

Check that `.gitignore` (the one `create-next-app` generates) already ignores `.env*`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: Next.js scaffolding with validated environment configuration

Next 16.3 with App Router, Tailwind 4, and Vitest. getEnv() validates
environment variables with Zod and is lazy, so it doesn't break the build
or the tests."
```

---

### Task 2: Database layer and PGlite test harness

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/index.ts`
- Create: `src/lib/db/testing.ts`
- Test: `src/lib/db/testing.test.ts`

**Interfaces:**
- Consumes: `getEnv()` from Task 1.
- Produces:
  - `db` — a Drizzle instance against Neon, for production.
  - `createTestDatabase(): Promise<TestDatabase>` — spins up an in-process Postgres with PGlite, applies every migration to it, and returns `{ db, close }`. `db` has the same query type as the production one; `close()` releases the instance.

- [ ] **Step 1: Install the dependencies**

```bash
pnpm add -E drizzle-orm@0.45.2 @neondatabase/serverless@1.1.0
pnpm add -D -E drizzle-kit@0.31.10 @electric-sql/pglite@0.5.8
```

- [ ] **Step 2: Write `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 3: Create a minimal schema to validate the pipeline**

`src/lib/db/schema.ts`. For now just the teams table: it's real, we'll need it in the next slice, and it lets us check that migrations and tests work before adding authentication.

```ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  managerName: text("manager_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Generate the first migration**

```bash
pnpm drizzle-kit generate
```
Expected: a new SQL file appears in `drizzle/`. Open it and check that it creates `teams`.

- [ ] **Step 5: Write the failing test**

`src/lib/db/testing.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { teams } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

describe("createTestDatabase", () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness.close();
  });

  it("applies the migrations and leaves the teams table empty", async () => {
    expect(await harness.db.select().from(teams)).toEqual([]);
  });

  it("saves and retrieves a team", async () => {
    await harness.db.insert(teams).values({
      id: "team-1",
      name: "The Grave Diggers",
      managerName: "Josep",
    });

    const rows = await harness.db.select().from(teams);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "team-1", name: "The Grave Diggers" });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 6: Run the test and check that it fails**

Run: `pnpm test src/lib/db/testing.test.ts`
Expected: FAIL — cannot resolve the module `./testing`.

- [ ] **Step 7: Implement the production connection**

`src/lib/db/index.ts`:

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export const db = drizzle(neon(getEnv().DATABASE_URL), { schema });

export type Database = typeof db;
```

- [ ] **Step 8: Implement the test harness**

`src/lib/db/testing.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type TestDatabase = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  close: () => Promise<void>;
};

/**
 * Spins up an in-process Postgres with the schema already migrated.
 *
 * PGlite runs inside the same Node process, with no Docker and no external
 * server, so each test file can have its own clean database.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
```

- [ ] **Step 9: Run the test and check that it passes**

Run: `pnpm test src/lib/db/testing.test.ts`
Expected: PASS, 2 tests.

If `migrate` complains that it can't find the folder, check that Vitest runs from
the project root; the `./drizzle` path is relative to the working directory.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: database layer with Drizzle and a PGlite test harness

Neon for production and in-process PGlite for tests, so the suite doesn't
depend on Docker or any external server."
```

---

### Task 3: Authentication and role policies

**Files:**
- Create: `src/lib/auth/permissions.ts`
- Create: `src/lib/auth/auth.ts`
- Modify: `src/lib/db/schema.ts` (adds better-auth's tables to it)
- Test: `src/lib/auth/permissions.test.ts`

**Interfaces:**
- Consumes: `db` from Task 2 (for the Drizzle adapter). The policy test doesn't touch the database: policies are pure.
- Produces:
  - `ac` — access control shared between server and client.
  - `roles` — `{ user, collaborator, admin }`.
  - `statement` — the map of resources and actions.
  - `auth` — a better-auth instance. Exposes `auth.api.getSession`, `auth.api.userHasPermission`, and the HTTP handler.

This is the central task of the plan: this is where the roles decided on in the brainstorming session become executable policies.

- [ ] **Step 1: Install better-auth**

```bash
pnpm add -E better-auth@1.7.2
```

- [ ] **Step 2: Write the failing test**

`src/lib/auth/permissions.test.ts`. This tests the policy, not the library: for each role it checks what it can and can't do, and these assertions are a literal translation of the role table from the spec.

```ts
import { describe, expect, it } from "vitest";
import { roles } from "./permissions";

describe("role policies", () => {
  describe("user", () => {
    it("can read the fair-play log", () => {
      expect(roles.user.authorize({ fairplay: ["read"] }).success).toBe(true);
    });

    it("cannot create polls", () => {
      expect(roles.user.authorize({ poll: ["create"] }).success).toBe(false);
    });

    it("cannot force a sync", () => {
      expect(roles.user.authorize({ sync: ["trigger"] }).success).toBe(false);
    });

    it("cannot correct league data", () => {
      expect(roles.user.authorize({ leagueData: ["correct"] }).success).toBe(false);
    });
  });

  describe("collaborator", () => {
    it.each([
      ["create polls", { poll: ["create"] }],
      ["resolve polls", { poll: ["resolve"] }],
      ["annotate fair play", { fairplay: ["annotate"] }],
      ["force a sync", { sync: ["trigger"] }],
      ["correct league data", { leagueData: ["correct"] }],
    ])("can %s", (_nom, permis) => {
      expect(roles.collaborator.authorize(permis).success).toBe(true);
    });

    it("cannot manage users", () => {
      expect(roles.collaborator.authorize({ user: ["set-role"] }).success).toBe(false);
    });
  });

  describe("admin", () => {
    it("can manage users", () => {
      expect(roles.admin.authorize({ user: ["set-role"] }).success).toBe(true);
    });

    it("can do everything a collaborator can", () => {
      expect(roles.admin.authorize({ poll: ["create"], sync: ["trigger"] }).success).toBe(
        true,
      );
    });
  });
});
```

- [ ] **Step 3: Run the test and check that it fails**

Run: `pnpm test src/lib/auth/permissions.test.ts`
Expected: FAIL — cannot resolve the module `./permissions`.

- [ ] **Step 4: Implement the policies**

`src/lib/auth/permissions.ts`:

```ts
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/** Portal resources and the possible actions on each. */
export const statement = {
  ...defaultStatements,
  poll: ["create", "publish", "close", "resolve"],
  fairplay: ["read", "annotate", "delete"],
  sync: ["trigger"],
  leagueData: ["correct"],
} as const;

export const ac = createAccessControl(statement);

/** League manager: reads and votes, but doesn't administer anything. */
const user = ac.newRole({
  fairplay: ["read"],
});

/** Everything the admin does except managing users and roles. */
const collaborator = ac.newRole({
  poll: ["create", "publish", "close", "resolve"],
  fairplay: ["read", "annotate", "delete"],
  sync: ["trigger"],
  leagueData: ["correct"],
});

const admin = ac.newRole({
  poll: ["create", "publish", "close", "resolve"],
  fairplay: ["read", "annotate", "delete"],
  sync: ["trigger"],
  leagueData: ["correct"],
  ...adminAc.statements,
});

export const roles = { user, collaborator, admin };

export type RoleName = keyof typeof roles;
```

- [ ] **Step 5: Run the test and check that it passes**

Run: `pnpm test src/lib/auth/permissions.test.ts`
Expected: PASS.

If `authorize` doesn't exist or returns something in a different shape, print
`Object.keys(roles.user)` and the raw result of a call, and adjust **both the
test and the implementation** to match the real API before continuing. The
policy being verified doesn't change; only how it's asked.

- [ ] **Step 6: Configure better-auth**

`src/lib/auth/auth.ts`:

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin as adminPlugin } from "better-auth/plugins";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { ac, roles } from "./permissions";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  socialProviders: {
    google: {
      clientId: getEnv().GOOGLE_CLIENT_ID,
      clientSecret: getEnv().GOOGLE_CLIENT_SECRET,
    },
  },
  user: {
    additionalFields: {
      fantasyTeamId: { type: "string", required: false, input: false },
    },
  },
  plugins: [
    adminPlugin({ ac, roles, adminRoles: ["admin"], defaultRole: "user" }),
    // nextCookies must always be the last plugin in the list.
    nextCookies(),
  ],
});
```

- [ ] **Step 7: Generate the authentication tables and migrate**

```bash
pnpm dlx auth@latest generate --config src/lib/auth/auth.ts --output src/lib/db/schema.ts
```

This adds `user`, `session`, `account`, and `verification` to the schema. Open the file and check that the `user` table has the `role`, `banned`, `banReason`, and `banExpires` columns (contributed by the `admin` plugin) plus our own `fantasyTeamId`, and that the `teams` table from Task 2 is still there.

```bash
pnpm drizzle-kit generate
```

- [ ] **Step 8: Check that the migration applies cleanly**

Run: `pnpm test src/lib/db/testing.test.ts`
Expected: PASS — the test harness applies every migration, so its tests would fail if the new migration were invalid.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: authentication with better-auth and three-role policies

Permissions for user, collaborator, and admin are declared as policies with
the access plugin, not as conditionals scattered through the code.
Collaborator can do everything except manage users."
```

---

### Task 4: Authentication routes and server guards

**Files:**
- Create: `src/app/api/auth/[...all]/route.ts`
- Create: `src/lib/auth/client.ts`
- Create: `src/lib/auth/guards.ts`
- Test: `src/lib/auth/guards.test.ts`

**Interfaces:**
- Consumes: `auth` and `roles` from Task 3.
- Produces:
  - `getSession(): Promise<Session | null>`
  - `requireSession(): Promise<Session>` — redirects to `/login` if there's no session.
  - `requirePermission(permissions: Permissions): Promise<Session>` — redirects to `/` if the session lacks the permission.
  - `decideAccess(session, permissions): AccessDecision` — a pure function that decides
    `{ kind: "allow" }` or `{ kind: "redirect", to }`. Task 5 uses it to hide menu
    entries without duplicating the rule.
  - `authClient` — a better-auth client for client components, with `signIn`, `signOut`, and `useSession`.

- [ ] **Step 1: Wire up the HTTP handler**

`src/app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 2: Create the client**

`src/lib/auth/client.ts`:

```ts
"use client";

import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ac, roles } from "./permissions";

export const authClient = createAuthClient({
  plugins: [adminClient({ ac, roles })],
});

export const { signIn, signOut, useSession } = authClient;
```

- [ ] **Step 3: Write the failing test**

`src/lib/auth/guards.test.ts`. This checks the guard's decision, not Next: a session is injected and we see whether it lets through or redirects.

```ts
import { describe, expect, it, vi } from "vitest";
import { decideAccess } from "./guards";

const sessioDe = (role: string) => ({ user: { id: "u1", role } });

describe("decideAccess", () => {
  it("redirects to /login when there is no session", () => {
    expect(decideAccess(null, { sync: ["trigger"] })).toEqual({
      kind: "redirect",
      to: "/login",
    });
  });

  it("redirects to the root when the role lacks the permission", () => {
    expect(decideAccess(sessioDe("user"), { sync: ["trigger"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });

  it("lets through a collaborator who has the permission", () => {
    expect(decideAccess(sessioDe("collaborator"), { sync: ["trigger"] })).toEqual({
      kind: "allow",
    });
  });

  it("lets the admin through", () => {
    expect(decideAccess(sessioDe("admin"), { user: ["set-role"] })).toEqual({
      kind: "allow",
    });
  });

  it("redirects to the root when the role is unknown", () => {
    expect(decideAccess(sessioDe("intrus"), { fairplay: ["read"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });
});
```

- [ ] **Step 4: Run the test and check that it fails**

Run: `pnpm test src/lib/auth/guards.test.ts`
Expected: FAIL — `decideAccess` isn't exported.

- [ ] **Step 5: Implement the guards**

`src/lib/auth/guards.ts`:

```ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { roles, type RoleName } from "./permissions";

type Permissions = Parameters<(typeof roles)["admin"]["authorize"]>[0];
type SessionLike = { user: { id: string; role?: string | null } } | null;

export type AccessDecision = { kind: "allow" } | { kind: "redirect"; to: string };

/**
 * Decides whether a session can access a resource. Pure function, no I/O:
 * it's what makes the access rule testable without spinning up Next.
 */
export function decideAccess(session: SessionLike, permissions: Permissions): AccessDecision {
  if (!session) return { kind: "redirect", to: "/login" };

  const role = roles[session.user.role as RoleName];
  if (!role) return { kind: "redirect", to: "/" };

  return role.authorize(permissions).success ? { kind: "allow" } : { kind: "redirect", to: "/" };
}

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePermission(permissions: Permissions) {
  const session = await getSession();
  const decision = decideAccess(session, permissions);
  if (decision.kind === "redirect") redirect(decision.to);
  return session!;
}
```

- [ ] **Step 6: Run the test and check that it passes**

Run: `pnpm test src/lib/auth/guards.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: authentication routes and server guards

decideAccess is pure and concentrates the access rule, so it can be
verified without spinning up Next or the database."
```

---

### Task 5: UI skeleton and a protected page

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx` (replaces the content `create-next-app` generates)
- Create: `src/app/login/page.tsx`
- Create: `src/components/sign-in-button.tsx`
- Create: `src/components/app-nav.tsx`
- Create: `src/app/admin/sync/page.tsx`
- Create: `playwright.config.ts`
- Test: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `getSession`, `requirePermission` from Task 4; `signIn`, `signOut`, `useSession` from `client.ts`.
- Produces: no new API. This task demonstrates that everything above works together.

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D -E @playwright/test@1.63.0
pnpm exec playwright install chromium
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

Add to `scripts` in `package.json`: `"test:e2e": "playwright test"`.

- [ ] **Step 3: Write the failing E2E test**

`e2e/auth.spec.ts`. Checks what can be checked without going through Google: that protected routes redirect whoever hasn't logged in.

```ts
import { expect, test } from "@playwright/test";

test("the home page invites you to log in when there is no session", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("the login page offers Google", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
});

test("an admin route redirects whoever hasn't logged in", async ({ page }) => {
  await page.goto("/admin/sync");
  await expect(page).toHaveURL(/\/login$/);
});

test("the portal's title is TebasFury", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/TebasFury/);
});
```

- [ ] **Step 4: Run it and check that it fails**

Run: `pnpm test:e2e`
Expected: FAIL — the pages don't exist yet.

- [ ] **Step 5: Write the sign-in button**

`src/components/sign-in-button.tsx`:

```tsx
"use client";

import { signIn } from "@/lib/auth/client";

export function SignInButton() {
  return (
    <button
      type="button"
      className="rounded-md bg-black px-4 py-2 text-white"
      onClick={() => signIn.social({ provider: "google", callbackURL: "/" })}
    >
      Sign in with Google
    </button>
  );
}
```

- [ ] **Step 6: Write the navigation**

`src/components/app-nav.tsx`. The nav is a server component: that way the admin menu isn't even sent to the browser of someone who doesn't have access to it.

```tsx
import Link from "next/link";
import { decideAccess, getSession } from "@/lib/auth/guards";

export async function AppNav() {
  const session = await getSession();
  const canTriggerSync =
    decideAccess(session, { sync: ["trigger"] }).kind === "allow";

  return (
    <nav className="flex items-center gap-4 border-b px-6 py-3">
      <Link href="/" className="font-semibold">
        TebasFury
      </Link>
      {canTriggerSync && <Link href="/admin/sync">Sync</Link>}
      <span className="ml-auto text-sm">
        {session ? session.user.name : <Link href="/login">Entra</Link>}
      </span>
    </nav>
  );
}
```

- [ ] **Step 7: Write the pages**

`src/app/layout.tsx` — inside `<body>`, wrap with the navigation:

```tsx
<body className={...}>
  <AppNav />
  <main className="px-6 py-8">{children}</main>
</body>
```

`src/app/page.tsx`:

```tsx
export default function HomePage() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">TebasFury</h1>
      <p className="mt-2 text-neutral-600">
        Management portal for our private LaLiga Fantasy league.
      </p>
    </section>
  );
}
```

`src/app/login/page.tsx`:

```tsx
import { SignInButton } from "@/components/sign-in-button";

export default function LoginPage() {
  return (
    <section className="mx-auto max-w-sm text-center">
      <h1 className="text-xl font-semibold">Entra a TebasFury</h1>
      <p className="mt-2 mb-6 text-sm text-neutral-600">
        League managers only.
      </p>
      <SignInButton />
    </section>
  );
}
```

`src/app/admin/sync/page.tsx` — the page that exercises the guard:

```tsx
import { requirePermission } from "@/lib/auth/guards";

export default async function SyncPage() {
  await requirePermission({ sync: ["trigger"] });

  return (
    <section>
      <h1 className="text-xl font-semibold">Sync</h1>
      <p className="mt-2 text-neutral-600">
        Nothing to sync yet. This arrives with the standings slice.
      </p>
    </section>
  );
}
```

- [ ] **Step 8: Run the E2E tests and check that they pass**

Run: `pnpm test:e2e`
Expected: PASS, 4 tests.

- [ ] **Step 9: Run the whole suite**

Run: `pnpm test && pnpm build`
Expected: all unit tests passing and a successful build.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: UI skeleton with a role-protected page

The nav is a server component, so admin entries never reach the browser
of anyone without access."
```

---

### Task 6: Deploy to Vercel

**Files:**
- Create: `README.md`
- Modify: `.env.example` (adds the production notes to it)

**Interfaces:**
- Consumes: everything above.
- Produces: a working public URL.

- [ ] **Step 1: Create the database on Neon**

From the Vercel dashboard, Storage tab, create a Neon Postgres database and connect it to the project. Vercel injects `DATABASE_URL` automatically.

- [ ] **Step 2: Configure the Google credentials**

In the Google Cloud Console, create a web-application OAuth 2.0 client. In the authorized redirect URIs, add both:

```
http://localhost:3000/api/auth/callback/google
https://<vercel-domain>/api/auth/callback/google
```

- [ ] **Step 3: Set the environment variables in Vercel**

`BETTER_AUTH_SECRET` (generated with `openssl rand -base64 32`, **different from the local one**), `BETTER_AUTH_URL` with the production URL, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`.

- [ ] **Step 4: Apply the migrations to the production database**

```bash
DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate
```

- [ ] **Step 5: Deploy and verify**

```bash
git push origin main
```

Once deployed, check on the public URL: the home page shows TebasFury, `/login` offers Google, logging in works, and `/admin/sync` redirects to `/login` in a private window.

- [ ] **Step 6: Promote the first admin**

The first user logs in with the `user` role, since that's the `defaultRole`. Promote them by hand, once:

```bash
DATABASE_URL="<neon-url>" psql "$DATABASE_URL" \
  -c "update \"user\" set role = 'admin' where email = '<first-admin-email>';"
```

Then check that the "Sync" entry shows up in the navigation and that the page opens.

- [ ] **Step 7: Write the README**

`README.md` with: what TebasFury is, the stack, how to start it locally (copy `.env.example` to `.env.local`, `pnpm install`, `pnpm drizzle-kit migrate`, `pnpm dev`), how to run the tests, and a link to the spec and to this plan.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: README with startup and deployment instructions"
```

---

## Final verification for Phase 1

With everything done, check in this order:

1. `pnpm test` — all unit and integration tests passing
2. `pnpm test:e2e` — all four Playwright tests passing
3. `pnpm build` — no TypeScript errors
4. On a clean database, `pnpm drizzle-kit migrate` brings up the whole schema with no errors
5. On the production URL: logging in with Google works and the session persists on reload
6. With a `user`-role account, `/admin/sync` redirects and the entry doesn't show up in the navigation
7. With the `admin` account, the page opens

## What comes next

The skeleton has no product functionality, and that's intentional. The next artifact is
the spec and plan for **Step 2: standings and evolution vertical slice**, which will
make use of the fixtures captured in Phase 0 to build `lib/fantasy-client/` with tests
that don't depend on the network.
