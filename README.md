# TebasFury

TebasFury is the management portal for a group of friends' private LaLiga Fantasy
league. It covers what the official app doesn't: standings and progress with historical
depth, a market log that remembers what every signing made or lost, the league's own
fair-play rules made visible (no selling a player within 5 days of buying them, and
14 days of clause protection after a purchase), the best eleven a squad can field, and
the weekly Necroporra, where every manager votes for the two rival teams most likely to
finish the round last.

Live at **https://tebasfury.vercel.app**

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

The integration tests each bring up their own PGlite database, and one worker per core
gets some of them SIGKILLed on a machine without much spare memory. `maxWorkers: 2` in
`vitest.config.ts` caps that, so plain `pnpm test` is reliable — and watch mode, an IDE
runner and any future CI inherit the cap.

`src/app/portal-pages.test.tsx` is the regression net for the signed-in path: it renders
every portal and admin page against PGlite with the real queries, faking only the
database handle and the session. The Playwright suite never signs in, by design, so what
that file covers is covered nowhere else.

There is no CI: `pnpm test`, `npx tsc --noEmit`, `pnpm lint` and `pnpm build` run when
somebody runs them. `pnpm test` does NOT typecheck — Vitest strips the types — so a type
error passes a green suite and is caught only by the other two.

## What is built

The portal is **live and in use by the league**: every manager has signed in and all but
two of the thirteen teams are claimed. Behind Google sign-in, gated by an allowlist an
admin edits on `/admin/sync`:

- **`/standings`** — the table, plus a per-gameweek round table at `/standings?round=N`.
- **`/progress`** — points and team value over the season, with your own line already
  pinned when you arrive.
- **`/players`** — the whole catalogue: points, value, points per million, who holds each
  player, and clause state on every name (locked, shielded, takeable). **`/players/[id]`**
  is one player's own page, led by what they scored.
- **`/market`** — every signing, sale and clause the league has made since 11 August,
  with what each one made or lost, and a board of who can be taken by clause right now
  and who frees up next.
- **`/teams/[id]`** — one manager's squad, money and market history, and
  **`/teams/[id]/lineup`**, the best eleven their squad can field with every legal
  formation ranked beside it.
- **`/fair-play`** — every sale the league made inside its own five-day rule, each one
  naming who sold whom, how long they held them and how far short that fell — minutes or
  days, because three of the four so far missed the rule by minutes.
- **`/necroporra`** — the weekly poll for the two teams you think finish the round last,
  with every ballot visible, past rounds browsable and a season table of who guesses best.
- **`/constitution`** — the Constitution of the Fantasy Comité: the five articles the
  league agreed among themselves, from the 15 € entry and its 65/25/10 split to the
  breakfast shield, the apology, the denigration and the five-day holding rule. Each
  article links to the page that applies it, and the stake is shown as the money it comes
  to rather than as a percentage.
- **`/admin/sync`** — the LaLiga credential, both sync buttons, the run history, and the
  list of who may sign in and who has claimed a team.

Underneath, two self-scheduling QStash chains keep it fed: standings every ten minutes
while a gameweek is live (and asleep until the next one opens, with a 24-hour heartbeat),
and a player-and-market sweep every six hours. Each run books its own successor, so both
endpoints carry a collapse guard that ends a duplicate chain without ending the last one
— and, since a booking that is rejected would otherwise end a chain for good, a QStash
schedule pokes `/api/sync/wake` every half hour to revive one that has stopped.

## What is not built

**Step 5 of the roadmap, "scheduled operations"** — linking each manager's own LaLiga
account so the portal can execute market operations for them. It is a possible future,
not a backlog item: it has never been specced, it would mean holding other people's
credentials, and whether it is worth building at all is undecided. Nobody should start
it without being asked to.

One gap worth knowing about:

- **A team with fewer than three rounds played has never existed**, so the branch of the
  metrics that explains why a figure is unavailable has never met real data.

## Documentation

Every slice was designed before it was built, and both halves are in the repo:
`docs/superpowers/specs/` holds the design of each one, `docs/superpowers/plans/` the
implementation plan it was executed from. The ones to start with:

- [Portal design spec](docs/superpowers/specs/2026-09-06-tebasfury-portal-design.md) —
  the whole shape of the thing, and the roadmap whose step 5 is what remains
- [Deploying to Vercel](docs/deployment.md) — including how to recover the LaLiga
  credential when it expires, which is the one operational task this portal has
