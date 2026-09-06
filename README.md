# TebasFury

TebasFury is the management portal for a group of friends' private LaLiga Fantasy
league. It covers what the official app doesn't: standings and progress with
historical depth, an internal fair-play log (the rule against selling a player within
5 days of buying them), market operations scheduled to the exact hour, and internal
polls like the weekly Necroporra, where every manager votes for the two rival teams
most likely to finish last in the round.

## Stack

- **Next.js** 16.3.4 (App Router) + **React** 19.2.8 + **TypeScript** 5.9.3
- **Postgres on Neon** (`@neondatabase/serverless` 1.1.0)
- **Drizzle ORM** 0.45.2 + **drizzle-kit** 0.31.10 for migrations
- **better-auth** 1.7.2, with a Google provider and the Drizzle adapter
- **Tailwind CSS** 4.3.3
- **Zod** 4.5.4
- **Vitest** 5.0.0 + **PGlite** 0.5.8 (in-process Postgres, no Docker) for unit and
  integration tests
- **Playwright** 1.63.0 for E2E tests
- Node ≥ 24, **pnpm** 11.4.0

## Running locally

```bash
cp .env.example .env.local
pnpm install
pnpm drizzle-kit migrate
pnpm dev
```

`.env.local` needs a `DATABASE_URL` of your own (for example, a Neon branch) and a set
of Google OAuth credentials. `BETTER_AUTH_SECRET` is generated with
`openssl rand -base64 32`.

## Tests

```bash
pnpm test
```

Runs the unit and integration tests with Vitest (the latter against PGlite). No
environment variables or `.env.local` are required: no test depends on them.

```bash
pnpm test:e2e
```

Runs the end-to-end tests with Playwright. It brings up `pnpm build` and `pnpm start`
itself with a set of dummy environment variables (see `playwright.config.ts`), so this
doesn't need `.env.local` either.

## Current status

This repository is the project's **skeleton**. Built and test-verified: Next.js, the
database layer with Drizzle, Google authentication configuration and the three roles
(`user`, `collaborator`, `admin`) with their server-side guards, and the basic UI
(sign-in, sign-out, role-conditioned navigation). `pnpm test` (38 tests) and
`pnpm test:e2e` (5 tests) pass.

Two things are **written but not yet run**: the real Google sign-in flow (the tests
deliberately avoid real OAuth and use dummy credentials instead) and the deployment to
Vercel (the steps are in `docs/deployment.md` as a checklist for the project owner,
not yet carried out). The wiring is correct by inspection, but no one has run it in a
real environment yet.

There is **no product functionality at all yet** — no standings, no fair play, no
scheduled operations, no polls.

The next step is *Step 2: standings-and-progress vertical slice*, described in the
spec. See its roadmap ("Execution plan") for the order of the steps after that.

## Documentation

- [Portal design spec](docs/superpowers/specs/2026-09-06-tebasfury-portal-design.md)
- [Skeleton implementation plan](docs/superpowers/plans/2026-09-06-tebasfury-skeleton.md)
- [Deploying to Vercel](docs/deployment.md)
