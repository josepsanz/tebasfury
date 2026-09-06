# TebasFury

TebasFury és el portal de gestió de la lliga privada de LaLiga Fantasy d'un grup
d'amics. Cobreix el que l'app oficial no ofereix: classificació i evolució amb
profunditat històrica, un registre intern de fair play (la norma de no vendre un
jugador abans de 5 dies), operacions de mercat programades a hora exacta, i enquestes
internes com la Necroporra setmanal, on cada manager vota els dos equips rivals
candidats a fer l'últim de la jornada.

## Stack

- **Next.js** 16.3.4 (App Router) + **React** 19.2.8 + **TypeScript** 5.9.3
- **Postgres a Neon** (`@neondatabase/serverless` 1.1.0)
- **Drizzle ORM** 0.45.2 + **drizzle-kit** 0.31.10 per a les migracions
- **better-auth** 1.7.2, amb proveïdor Google i adapter de Drizzle
- **Tailwind CSS** 4.3.3
- **Zod** 4.5.4
- **Vitest** 5.0.0 + **PGlite** 0.5.8 (Postgres en procés, sense Docker) per als tests
  unitaris i d'integració
- **Playwright** 1.63.0 per als tests E2E
- Node ≥ 24, **pnpm** 11.4.0

## Arrencada en local

```bash
cp .env.example .env.local
pnpm install
pnpm drizzle-kit migrate
pnpm dev
```

Cal omplir `.env.local` amb una `DATABASE_URL` pròpia (per exemple, una branca de Neon)
i unes credencials d'OAuth de Google. `BETTER_AUTH_SECRET` es genera amb
`openssl rand -base64 32`.

## Tests

```bash
pnpm test
```

Executa els tests unitaris i d'integració amb Vitest (aquests últims contra PGlite).
No requereix cap variable d'entorn ni `.env.local`: cap test hi depèn.

```bash
pnpm test:e2e
```

Executa els tests d'extrem a extrem amb Playwright. Aixeca ell mateix `pnpm build` i
`pnpm start` amb un joc de variables d'entorn fictícies (vegeu `playwright.config.ts`),
així que tampoc necessita `.env.local`.

## Estat actual

Aquest repositori és l'**esquelet** del projecte: Next.js, la capa de base de dades amb
Drizzle, l'autenticació amb Google i els tres rols (`user`, `colaborator`, `admin`) amb
els seus guards de servidor, i el desplegament a Vercel, ja funcionen. Encara **no hi ha
cap funcionalitat de producte** — ni classificació, ni fair play, ni operacions
programades, ni enquestes.

El següent pas és el *Pas 2: slice vertical de classificació i evolució*, descrit a
l'spec. Vegeu el seu roadmap ("Pla d'execució") per a l'ordre dels passos posteriors.

## Documentació

- [Spec de disseny del portal](docs/superpowers/specs/2026-09-06-tebasfury-portal-design.md)
- [Pla d'implementació de l'esquelet](docs/superpowers/plans/2026-09-06-tebasfury-esquelet.md)
- [Desplegament a Vercel](docs/desplegament.md)
