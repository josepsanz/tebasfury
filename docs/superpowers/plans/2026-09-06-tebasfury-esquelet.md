# TebasFury — Pla d'implementació: spike d'API i esquelet

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verificar que l'API no oficial de LaLiga Fantasy és utilitzable i, si ho és, deixar desplegat a Vercel un esquelet de TebasFury amb login de Google i tres rols funcionals.

**Architecture:** Next.js App Router sobre Postgres a Neon amb Drizzle. L'autenticació i els rols els porta better-auth amb els plugins `admin` i `access`, de manera que els permisos són polítiques declarades i no condicionals escampats pel codi. Els tests de base de dades corren contra PGlite en procés, sense Docker.

**Tech Stack:** Next.js 16.3, React 19.2, TypeScript, Tailwind 4, Drizzle ORM 0.45, `@neondatabase/serverless` 1.1, better-auth 1.7, Zod 4, Vitest 5, PGlite 0.5, Playwright 1.63, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-09-06-tebasfury-portal-design.md`

## Global Constraints

- El portal es diu **TebasFury**, amb F majúscula. Aquest nom exacte va al `package.json`, al `<title>` i a les metadades.
- Idioma de la interfície i dels missatges d'error visibles: **català**.
- Node 24, pnpm 11. Totes les dependències es fixen a versió exacta al `package.json`.
- TypeScript en mode `strict`. Cap `any` explícit al codi de producció.
- **Cap crida a l'API de LaLiga des d'una petició web.** Aquesta regla no es trenca en cap tasca d'aquest pla.
- Els tres rols s'escriuen sempre `user`, `colaborator`, `admin` (`colaborator` amb una sola `l`, tal com el va anomenar el propietari del projecte).
- Cap secret al repositori. Tot per variables d'entorn, amb `.env.example` sempre actualitzat.

---

## Fase 0 — Spike de viabilitat de l'API *(PORTA BLOQUEJANT)*

**Això no és una tasca d'implementació i no porta cicle TDD.** La sortida és una resposta i un joc de fixtures, no codi que es conservi. Tot el que s'escrigui aquí viu a `spike/` i s'esborra en acabar.

**Si aquesta fase falla, la Fase 1 no comença.** Es torna a la decisió de font de dades de l'spec.

### Preguntes que cal respondre

- [ ] **1. Autenticació.** Obrir l'app web oficial de LaLiga Fantasy amb les DevTools del navegador a la pestanya Network, iniciar sessió i capturar la crida d'autenticació. Anotar: URL exacta, mètode, cos de la petició, forma de la resposta, on viu el token i quina caducitat té.
- [ ] **2. Refresc.** Determinar si hi ha refresh token i quin endpoint el bescanvia. Si no n'hi ha, anotar quant dura la sessió: això decideix cada quant caldrà reintroduir el token central a mà.
- [ ] **3. Capçaleres obligatòries.** Reproduir una crida autenticada amb `curl` fora del navegador. Anotar quines capçaleres són imprescindibles (típicament `Authorization`, i sovint `x-lang` o un `User-Agent` concret). Una crida que funciona al navegador i falla a `curl` sol ser una capçalera que falta.
- [ ] **4. Lliga privada.** Trobar l'endpoint que llista les lligues del compte i el que dóna la classificació de la lliga privada. Anotar-ne l'identificador.
- [ ] **5. Punts per jornada.** Trobar l'endpoint que dóna els punts d'un equip per jornada. Comprovar si dóna l'històric complet de la temporada o només la jornada en curs — **si només dóna la jornada en curs, l'històric depèn totalment que el nostre sync no es perdi cap jornada**, i això s'ha d'escriure a l'informe.
- [ ] **6. Rate limits.** Fer 30 crides seguides i mirar si apareix un 429 o capçaleres `X-RateLimit-*`. Anotar el que es trobi.

### Recollida de fixtures

- [ ] **Desar la resposta crua de cada endpoint** a `spike/fixtures/<nom-endpoint>.json`.
- [ ] **Anonimitzar-les abans de cometre-les.** Contenen noms reals de la resta de managers. Substituir noms i emails per valors ficticis, conservant l'estructura i els tipus intactes. Aquestes fixtures seran la base dels tests de `lib/fantasy-client/` a les fases posteriors.

### Informe i porta

- [ ] **Escriure `spike/README.md`** amb una resposta per pregunta, i al capdamunt un veredicte d'una línia: viable / viable amb reserves / no viable.
- [ ] **Commit** de l'informe i les fixtures anonimitzades:

```bash
git add spike/
git commit -m "spike: informe de viabilitat de l'API de LaLiga Fantasy

Codi exploratori i llençable. Les fixtures anonimitzades es conserven com a
base dels tests de la capa fantasy-client."
```

- [ ] **PORTA: aturar-se i informar el propietari del projecte** amb el veredicte abans de continuar. Si és "no viable", aquest pla acaba aquí.

---

## Fase 1 — Esquelet

### Task 1: Bastida del projecte i configuració d'entorn validada

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx` (via `create-next-app`)
- Create: `vitest.config.ts`
- Create: `src/lib/env.ts`
- Create: `.env.example`
- Test: `src/lib/env.test.ts`

**Interfaces:**
- Consumes: res
- Produces: `getEnv(): Env` — llegeix i valida `process.env`, memoïtzat. `Env` té `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, tots `string`. També `parseEnv(source: Record<string, string | undefined>): Env` per poder-lo testejar sense tocar `process.env`.

- [ ] **Step 1: Generar el projecte**

El directori ja conté `.git/` i `docs/`, que no col·lisionen amb `create-next-app`.

```bash
pnpm create next-app@16.3.4 . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm
```

- [ ] **Step 2: Comprovar que arrenca i compila**

```bash
pnpm build
```
Expected: build correcte, sense errors de TypeScript.

- [ ] **Step 3: Posar el nom del portal**

A `package.json`, camp `name`: `tebasfury`. A `src/app/layout.tsx`, l'export `metadata`:

```ts
export const metadata: Metadata = {
  title: "TebasFury",
  description: "Portal de gestió de la lliga privada de LaLiga Fantasy",
};
```

I l'atribut de llengua de l'arrel: `<html lang="ca">`.

- [ ] **Step 4: Instal·lar Vitest i crear-ne la configuració**

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

Afegir a `package.json`, dins de `scripts`: `"test": "vitest run"` i `"test:watch": "vitest"`.

- [ ] **Step 5: Escriure el test que falla**

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
  it("retorna la configuració quan totes les variables hi són", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("falla i anomena la variable que manca", () => {
    const { GOOGLE_CLIENT_SECRET, ...incomplete } = valid;
    expect(() => parseEnv(incomplete)).toThrowError(/GOOGLE_CLIENT_SECRET/);
  });

  it("rebutja un secret massa curt", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "massa-curt" })).toThrowError(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rebutja una URL de base de dades que no és una URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "no-soc-una-url" })).toThrowError(
      /DATABASE_URL/,
    );
  });
});
```

- [ ] **Step 6: Executar el test i comprovar que falla**

Run: `pnpm test src/lib/env.test.ts`
Expected: FAIL — no es pot resoldre el mòdul `./env`.

- [ ] **Step 7: Implementar `src/lib/env.ts`**

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
    const noms = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuració d'entorn invàlida: ${noms}`);
  }
  return result.data;
}

let memo: Env | undefined;

export function getEnv(): Env {
  memo ??= parseEnv(process.env);
  return memo;
}
```

`getEnv()` és memoïtzat i mandrós a propòsit: si validéssim en carregar el mòdul, qualsevol import trencaria els tests i el build.

Tot i així, `src/lib/db/index.ts` (Task 2) el crida en construir la connexió, i aquest
mòdul sí que es carrega durant `pnpm build`. Conseqüència pràctica: **`pnpm build` exigeix
un `.env.local` complet**, també quan Playwright aixeca el servidor. A Vercel no és un
problema perquè les variables hi són en temps de build.

Instal·lar Zod: `pnpm add -E zod@4.5.4`

- [ ] **Step 8: Executar el test i comprovar que passa**

Run: `pnpm test src/lib/env.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Escriure `.env.example`**

```bash
DATABASE_URL="postgres://usuari:contrasenya@host/tebasfury"
BETTER_AUTH_SECRET="genera'l amb: openssl rand -base64 32"
BETTER_AUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

Comprovar que `.gitignore` (el que genera `create-next-app`) ja ignora `.env*`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: bastida de Next.js amb configuració d'entorn validada

Next 16.3 amb App Router, Tailwind 4 i Vitest. getEnv() valida les variables
d'entorn amb Zod i és mandrós, per no trencar el build ni els tests."
```

---

### Task 2: Capa de base de dades i banc de proves amb PGlite

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/index.ts`
- Create: `src/lib/db/testing.ts`
- Test: `src/lib/db/testing.test.ts`

**Interfaces:**
- Consumes: `getEnv()` de la Task 1.
- Produces:
  - `db` — instància de Drizzle contra Neon, per a producció.
  - `createTestDatabase(): Promise<TestDatabase>` — aixeca un Postgres en procés amb PGlite, hi aplica totes les migracions i retorna `{ db, close }`. `db` té el mateix tipus de consulta que el de producció; `close()` allibera la instància.

- [ ] **Step 1: Instal·lar les dependències**

```bash
pnpm add -E drizzle-orm@0.45.2 @neondatabase/serverless@1.1.0
pnpm add -D -E drizzle-kit@0.31.10 @electric-sql/pglite@0.5.8
```

- [ ] **Step 2: Escriure `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 3: Crear un esquema mínim per validar la canonada**

`src/lib/db/schema.ts`. De moment només la taula d'equips: és real, la necessitem al slice següent, i serveix per comprovar que migracions i tests funcionen abans d'afegir-hi l'autenticació.

```ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  managerName: text("manager_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Generar la primera migració**

```bash
pnpm drizzle-kit generate
```
Expected: apareix un fitxer SQL nou a `drizzle/`. Obrir-lo i comprovar que crea `teams`.

- [ ] **Step 5: Escriure el test que falla**

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

  it("aplica les migracions i deixa la taula d'equips buida", async () => {
    expect(await harness.db.select().from(teams)).toEqual([]);
  });

  it("desa i recupera un equip", async () => {
    await harness.db.insert(teams).values({
      id: "team-1",
      name: "Els Necrofílics",
      managerName: "Josep",
    });

    const rows = await harness.db.select().from(teams);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "team-1", name: "Els Necrofílics" });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 6: Executar el test i comprovar que falla**

Run: `pnpm test src/lib/db/testing.test.ts`
Expected: FAIL — no es pot resoldre el mòdul `./testing`.

- [ ] **Step 7: Implementar la connexió de producció**

`src/lib/db/index.ts`:

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export const db = drizzle(neon(getEnv().DATABASE_URL), { schema });

export type Database = typeof db;
```

- [ ] **Step 8: Implementar el banc de proves**

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
 * Aixeca un Postgres en procés amb l'esquema ja migrat.
 *
 * PGlite corre dins del mateix procés de Node, sense Docker ni servidor extern,
 * de manera que cada fitxer de test pot tenir la seva base de dades neta.
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

- [ ] **Step 9: Executar el test i comprovar que passa**

Run: `pnpm test src/lib/db/testing.test.ts`
Expected: PASS, 2 tests.

Si `migrate` es queixa que no troba la carpeta, comprovar que Vitest corre des de l'arrel del projecte; el camí `./drizzle` és relatiu al directori de treball.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: capa de base de dades amb Drizzle i banc de proves amb PGlite

Neon per a producció i PGlite en procés per als tests, de manera que la suite
no depèn de Docker ni de cap servidor extern."
```

---

### Task 3: Autenticació i polítiques de rol

**Files:**
- Create: `src/lib/auth/permissions.ts`
- Create: `src/lib/auth/auth.ts`
- Modify: `src/lib/db/schema.ts` (hi afegeix les taules de better-auth)
- Test: `src/lib/auth/permissions.test.ts`

**Interfaces:**
- Consumes: `db` de la Task 2 (per a l'adapter de Drizzle). El test de polítiques no toca la base de dades: les polítiques són pures.
- Produces:
  - `ac` — control d'accés compartit entre servidor i client.
  - `roles` — `{ user, colaborator, admin }`.
  - `statement` — el mapa de recursos i accions.
  - `auth` — instància de better-auth. Exposa `auth.api.getSession`, `auth.api.userHasPermission` i el handler HTTP.

Aquesta és la tasca central del pla: aquí és on els rols que es van decidir al brainstorming es converteixen en polítiques executables.

- [ ] **Step 1: Instal·lar better-auth**

```bash
pnpm add -E better-auth@1.7.2
```

- [ ] **Step 2: Escriure el test que falla**

`src/lib/auth/permissions.test.ts`. Es prova la política, no la llibreria: per a cada rol es comprova què pot i què no pot fer, i aquestes asseveracions són la traducció literal de la taula de rols de l'spec.

```ts
import { describe, expect, it } from "vitest";
import { roles } from "./permissions";

describe("polítiques de rol", () => {
  describe("user", () => {
    it("pot llegir el registre de fair play", () => {
      expect(roles.user.authorize({ fairplay: ["read"] }).success).toBe(true);
    });

    it("no pot crear enquestes", () => {
      expect(roles.user.authorize({ poll: ["create"] }).success).toBe(false);
    });

    it("no pot forçar la sincronització", () => {
      expect(roles.user.authorize({ sync: ["trigger"] }).success).toBe(false);
    });

    it("no pot corregir dades de la lliga", () => {
      expect(roles.user.authorize({ leagueData: ["correct"] }).success).toBe(false);
    });
  });

  describe("colaborator", () => {
    it.each([
      ["crear enquestes", { poll: ["create"] }],
      ["resoldre enquestes", { poll: ["resolve"] }],
      ["anotar el fair play", { fairplay: ["annotate"] }],
      ["forçar la sincronització", { sync: ["trigger"] }],
      ["corregir dades de la lliga", { leagueData: ["correct"] }],
    ])("pot %s", (_nom, permis) => {
      expect(roles.colaborator.authorize(permis).success).toBe(true);
    });

    it("no pot gestionar usuaris", () => {
      expect(roles.colaborator.authorize({ user: ["set-role"] }).success).toBe(false);
    });
  });

  describe("admin", () => {
    it("pot gestionar usuaris", () => {
      expect(roles.admin.authorize({ user: ["set-role"] }).success).toBe(true);
    });

    it("pot fer tot el que fa un colaborator", () => {
      expect(roles.admin.authorize({ poll: ["create"], sync: ["trigger"] }).success).toBe(
        true,
      );
    });
  });
});
```

- [ ] **Step 3: Executar el test i comprovar que falla**

Run: `pnpm test src/lib/auth/permissions.test.ts`
Expected: FAIL — no es pot resoldre el mòdul `./permissions`.

- [ ] **Step 4: Implementar les polítiques**

`src/lib/auth/permissions.ts`:

```ts
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/** Recursos del portal i accions possibles sobre cadascun. */
export const statement = {
  ...defaultStatements,
  poll: ["create", "publish", "close", "resolve"],
  fairplay: ["read", "annotate", "delete"],
  sync: ["trigger"],
  leagueData: ["correct"],
} as const;

export const ac = createAccessControl(statement);

/** Manager de la lliga: consulta i vota, però no administra res. */
const user = ac.newRole({
  fairplay: ["read"],
});

/** Tot el que fa l'admin excepte gestionar usuaris i rols. */
const colaborator = ac.newRole({
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

export const roles = { user, colaborator, admin };

export type RoleName = keyof typeof roles;
```

- [ ] **Step 5: Executar el test i comprovar que passa**

Run: `pnpm test src/lib/auth/permissions.test.ts`
Expected: PASS.

Si `authorize` no existeix o té una altra forma de retorn, imprimir `Object.keys(roles.user)` i el resultat brut d'una crida, i ajustar **el test i la implementació** a l'API real abans de continuar. La política que s'està verificant no canvia; només com se li pregunta.

- [ ] **Step 6: Configurar better-auth**

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
    // nextCookies ha de ser sempre l'últim plugin de la llista.
    nextCookies(),
  ],
});
```

- [ ] **Step 7: Generar les taules d'autenticació i migrar**

```bash
pnpm dlx auth@latest generate --config src/lib/auth/auth.ts --output src/lib/db/schema.ts
```

Això afegeix `user`, `session`, `account` i `verification` a l'esquema. Obrir el fitxer i comprovar que la taula `user` té les columnes `role`, `banned`, `banReason` i `banExpires` (les aporta el plugin `admin`) i el nostre `fantasyTeamId`, i que la taula `teams` de la Task 2 hi segueix.

```bash
pnpm drizzle-kit generate
```

- [ ] **Step 8: Comprovar que la migració s'aplica en net**

Run: `pnpm test src/lib/db/testing.test.ts`
Expected: PASS — el banc de proves aplica totes les migracions, de manera que els seus tests fallarien si la migració nova fos invàlida.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: autenticació amb better-auth i polítiques dels tres rols

Els permisos de user, colaborator i admin es declaren com a polítiques amb el
plugin access, no com a condicionals escampats pel codi. Colaborator ho pot fer
tot excepte gestionar usuaris."
```

---

### Task 4: Rutes d'autenticació i guards de servidor

**Files:**
- Create: `src/app/api/auth/[...all]/route.ts`
- Create: `src/lib/auth/client.ts`
- Create: `src/lib/auth/guards.ts`
- Test: `src/lib/auth/guards.test.ts`

**Interfaces:**
- Consumes: `auth` i `roles` de la Task 3.
- Produces:
  - `getSession(): Promise<Session | null>`
  - `requireSession(): Promise<Session>` — redirigeix a `/login` si no hi ha sessió.
  - `requirePermission(permissions: Permissions): Promise<Session>` — redirigeix a `/` si la sessió no té el permís.
  - `decideAccess(session, permissions): AccessDecision` — funció pura que decideix
    `{ kind: "allow" }` o `{ kind: "redirect", to }`. La Task 5 la fa servir per
    amagar entrades de menú sense duplicar la regla.
  - `authClient` — client de better-auth per als components de client, amb `signIn`, `signOut` i `useSession`.

- [ ] **Step 1: Muntar el handler HTTP**

`src/app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 2: Crear el client**

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

- [ ] **Step 3: Escriure el test que falla**

`src/lib/auth/guards.test.ts`. Es comprova la decisió del guard, no Next: s'injecta una sessió i es mira si deixa passar o desvia.

```ts
import { describe, expect, it, vi } from "vitest";
import { decideAccess } from "./guards";

const sessioDe = (role: string) => ({ user: { id: "u1", role } });

describe("decideAccess", () => {
  it("envia a /login quan no hi ha sessió", () => {
    expect(decideAccess(null, { sync: ["trigger"] })).toEqual({
      kind: "redirect",
      to: "/login",
    });
  });

  it("envia a l'arrel quan el rol no té el permís", () => {
    expect(decideAccess(sessioDe("user"), { sync: ["trigger"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });

  it("deixa passar el colaborator que té el permís", () => {
    expect(decideAccess(sessioDe("colaborator"), { sync: ["trigger"] })).toEqual({
      kind: "allow",
    });
  });

  it("deixa passar l'admin", () => {
    expect(decideAccess(sessioDe("admin"), { user: ["set-role"] })).toEqual({
      kind: "allow",
    });
  });

  it("envia a l'arrel quan el rol és desconegut", () => {
    expect(decideAccess(sessioDe("intrus"), { fairplay: ["read"] })).toEqual({
      kind: "redirect",
      to: "/",
    });
  });
});
```

- [ ] **Step 4: Executar el test i comprovar que falla**

Run: `pnpm test src/lib/auth/guards.test.ts`
Expected: FAIL — `decideAccess` no està exportat.

- [ ] **Step 5: Implementar els guards**

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
 * Decideix si una sessió pot accedir a un recurs. Funció pura, sense I/O:
 * és el que fa que la regla d'accés sigui testejable sense aixecar Next.
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

- [ ] **Step 6: Executar el test i comprovar que passa**

Run: `pnpm test src/lib/auth/guards.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: rutes d'autenticació i guards de servidor

decideAccess és pura i concentra la regla d'accés, de manera que es pot
verificar sense aixecar Next ni la base de dades."
```

---

### Task 5: Esquelet de la interfície i pàgina protegida

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx` (substitueix el contingut que genera `create-next-app`)
- Create: `src/app/login/page.tsx`
- Create: `src/components/sign-in-button.tsx`
- Create: `src/components/app-nav.tsx`
- Create: `src/app/admin/sincronitzacio/page.tsx`
- Create: `playwright.config.ts`
- Test: `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `getSession`, `requirePermission` de la Task 4; `signIn`, `signOut`, `useSession` de `client.ts`.
- Produces: cap API nova. Aquesta tasca demostra que tot l'anterior funciona junt.

- [ ] **Step 1: Instal·lar Playwright**

```bash
pnpm add -D -E @playwright/test@1.63.0
pnpm exec playwright install chromium
```

- [ ] **Step 2: Escriure `playwright.config.ts`**

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

Afegir a `scripts` del `package.json`: `"test:e2e": "playwright test"`.

- [ ] **Step 3: Escriure el test E2E que falla**

`e2e/auth.spec.ts`. Comprova el que es pot comprovar sense passar per Google: que les rutes protegides desvien qui no ha entrat.

```ts
import { expect, test } from "@playwright/test";

test("la portada convida a entrar quan no hi ha sessió", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Entra" })).toBeVisible();
});

test("la pàgina d'entrada ofereix Google", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /Google/i })).toBeVisible();
});

test("una ruta d'administració desvia qui no ha entrat", async ({ page }) => {
  await page.goto("/admin/sincronitzacio");
  await expect(page).toHaveURL(/\/login$/);
});

test("el títol del portal és TebasFury", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/TebasFury/);
});
```

- [ ] **Step 4: Executar-lo i comprovar que falla**

Run: `pnpm test:e2e`
Expected: FAIL — les pàgines encara no existeixen.

- [ ] **Step 5: Escriure el botó d'entrada**

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
      Entra amb Google
    </button>
  );
}
```

- [ ] **Step 6: Escriure la navegació**

`src/components/app-nav.tsx`. La navegació és un component de servidor: així el menú d'administració no s'envia ni tan sols al navegador de qui no hi té accés.

```tsx
import Link from "next/link";
import { decideAccess, getSession } from "@/lib/auth/guards";

export async function AppNav() {
  const session = await getSession();
  const potSincronitzar =
    decideAccess(session, { sync: ["trigger"] }).kind === "allow";

  return (
    <nav className="flex items-center gap-4 border-b px-6 py-3">
      <Link href="/" className="font-semibold">
        TebasFury
      </Link>
      {potSincronitzar && <Link href="/admin/sincronitzacio">Sincronització</Link>}
      <span className="ml-auto text-sm">
        {session ? session.user.name : <Link href="/login">Entra</Link>}
      </span>
    </nav>
  );
}
```

- [ ] **Step 7: Escriure les pàgines**

`src/app/layout.tsx` — dins de `<body>`, embolcallar amb la navegació:

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
        Portal de gestió de la lliga privada de LaLiga Fantasy.
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
        Només per als managers de la lliga.
      </p>
      <SignInButton />
    </section>
  );
}
```

`src/app/admin/sincronitzacio/page.tsx` — la pàgina que prova el guard:

```tsx
import { requirePermission } from "@/lib/auth/guards";

export default async function SyncPage() {
  await requirePermission({ sync: ["trigger"] });

  return (
    <section>
      <h1 className="text-xl font-semibold">Sincronització</h1>
      <p className="mt-2 text-neutral-600">
        Encara no hi ha res a sincronitzar. Arribarà amb el slice de classificació.
      </p>
    </section>
  );
}
```

- [ ] **Step 8: Executar els tests E2E i comprovar que passen**

Run: `pnpm test:e2e`
Expected: PASS, 4 tests.

- [ ] **Step 9: Executar tota la suite**

Run: `pnpm test && pnpm build`
Expected: tots els tests unitaris en verd i build correcte.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: esquelet de la interfície amb pàgina protegida per rol

La navegació és un component de servidor, de manera que les entrades
d'administració no arriben al navegador de qui no hi té accés."
```

---

### Task 6: Desplegament a Vercel

**Files:**
- Create: `README.md`
- Modify: `.env.example` (hi afegeix les notes de producció)

**Interfaces:**
- Consumes: tot l'anterior.
- Produces: una URL pública funcionant.

- [ ] **Step 1: Crear la base de dades a Neon**

Des del panell de Vercel, pestanya Storage, crear una base de dades Neon Postgres i connectar-la al projecte. Vercel hi injecta `DATABASE_URL` automàticament.

- [ ] **Step 2: Configurar les credencials de Google**

A la Google Cloud Console, crear un client OAuth 2.0 de tipus aplicació web. Als URI de redirecció autoritzats, afegir-hi els dos:

```
http://localhost:3000/api/auth/callback/google
https://<domini-de-vercel>/api/auth/callback/google
```

- [ ] **Step 3: Posar les variables d'entorn a Vercel**

`BETTER_AUTH_SECRET` (generat amb `openssl rand -base64 32`, **diferent del de local**), `BETTER_AUTH_URL` amb la URL de producció, `GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_SECRET`.

- [ ] **Step 4: Aplicar les migracions a la base de dades de producció**

```bash
DATABASE_URL="<url-de-neon>" pnpm drizzle-kit migrate
```

- [ ] **Step 5: Desplegar i verificar**

```bash
git push origin main
```

Un cop desplegat, comprovar a la URL pública: la portada mostra TebasFury, `/login` ofereix Google, entrar-hi funciona, i `/admin/sincronitzacio` desvia a `/login` en una finestra privada.

- [ ] **Step 6: Promoure el primer administrador**

El primer usuari entra amb rol `user`, perquè és el `defaultRole`. Promoure'l a mà una sola vegada:

```bash
DATABASE_URL="<url-de-neon>" psql "$DATABASE_URL" \
  -c "update \"user\" set role = 'admin' where email = 'josep.sanz@powens.com';"
```

Comprovar tot seguit que l'entrada "Sincronització" apareix a la navegació i que la pàgina s'obre.

- [ ] **Step 7: Escriure el README**

`README.md` amb: què és TebasFury, l'stack, com arrencar en local (copiar `.env.example` a `.env.local`, `pnpm install`, `pnpm drizzle-kit migrate`, `pnpm dev`), com córrer els tests, i un enllaç a l'spec i a aquest pla.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs: README amb instruccions d'arrencada i desplegament"
```

---

## Verificació final de la Fase 1

Amb tot fet, comprovar en aquest ordre:

1. `pnpm test` — tots els tests unitaris i d'integració en verd
2. `pnpm test:e2e` — els quatre tests de Playwright en verd
3. `pnpm build` — sense errors de TypeScript
4. Sobre una base de dades neta, `pnpm drizzle-kit migrate` aixeca tot l'esquema sense error
5. A la URL de producció: entrar amb Google funciona i la sessió persisteix en recarregar
6. Amb un compte de rol `user`, `/admin/sincronitzacio` desvia i l'entrada no surt a la navegació
7. Amb el compte `admin`, la pàgina s'obre

## Què ve després

L'esquelet no té cap funcionalitat de producte, i és volgut. El següent artefacte és
l'spec i el pla del **Pas 2: slice vertical de classificació i evolució**, que aprofitarà
les fixtures capturades a la Fase 0 per construir `lib/fantasy-client/` amb tests que no
depenen de la xarxa.
