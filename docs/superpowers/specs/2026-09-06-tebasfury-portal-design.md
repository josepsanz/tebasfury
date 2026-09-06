# TebasFury — Private LaLiga Fantasy League Management Portal

## Context

Empty repository (`main`, no commits). New personal project.

A group of friends plays a private LaLiga Fantasy league. The official app covers the
game itself but covers none of what makes the league *theirs*: it keeps no history to
analyze how things evolve, knows nothing about the group's internal rules, and has no
polls.

The portal has to fill that gap:

- **History and evolution** — overall and per-team points across the season, and
  player value over time, none of which the official app retains.
- **Internal fair-play rule** — in the group, players aren't sold before 5 days.
  Nobody can enforce it technically, but having it logged and visible changes
  behavior.
- **Scheduled operations** — being able to schedule a bid or a sale for an exact
  time, without having to be on the phone in the middle of the night.
- **Necroporra** — a weekly poll where each manager votes for two rival teams they
  think are candidates to finish last in the gameweek. Today it's done by hand and
  the results get lost.

The portal is called **TebasFury**. It's written that way, with a capital F, and it's
the name that must appear in the UI, in `package.json`, in the page titles, and in the
metadata.

Expected result: a portal deployed on Vercel where the whole group logs in with their
own account, sees the league with historical depth, and where the Necroporra is
published, voted on, and resolves itself.

## Decisions made (brainstorming session)

| Decision | Chosen value |
|---|---|
| Data source | Unofficial LaLiga Fantasy API |
| Account model | Central read token + individual opt-in to write |
| Scheduled operations | Real execution against the API |
| Fair play | Automatic detection + public log. No case file, no justifications |
| Necroporra | Auto-resolution + season-cumulative leaderboard of correct picks |
| Collaborator role | Polls, fair-play log, force sync, correct data. Doesn't manage users |
| Scope | A single league (no multi-tenant) |
| First slice | Standings and evolution |
| Scheduler | Upstash QStash + Vercel Hobby |

## Accepted risks — written down explicitly

1. **The API is unofficial.** It can change or disappear without notice, and using it
   may go against LaLiga Fantasy's terms of service. The whole project depends on it.
   *Mitigation:* all knowledge of the API lives in a single isolated layer
   (`lib/fantasy-client/`); the rest of the system knows nothing about it. If it
   changes, one directory gets touched.
2. **Custody of third-party credentials.** Real execution forces us to store other
   people's LaLiga tokens. It's the highest-risk point in the system.
   *Mitigation:* AES-256-GCM encryption at rest with the key kept outside the DB, the
   password never stored in the clear, explicit opt-in, and a screen to revoke the
   connection at any time.
3. **Data latency.** Views read snapshots, not the live API. The UI must always show
   when the last successful sync happened.

## Architecture

### Guiding principle: snapshot store

The portal **never calls LaLiga during a web request**. A worker syncs periodically
and writes snapshots to Postgres. Every view reads only from our own DB.

This gives three things that are non-negotiable here: fast pages, a portal that stays
up when the API goes down, and **the accumulation of history that is the whole reason
the project exists**.

The **raw payload** of every sync is also kept (short retention, ~30 days). It costs
little and makes it possible to rebuild data once a parsing bug is found.

### Stack

Versions verified on 2026-09-06.

- **Next.js 16.3** (App Router, RSC) + **React 19.2** + TypeScript — native on Vercel
- **Postgres on Neon** (`@neondatabase/serverless` 1.1) via the Vercel integration
- **Drizzle ORM 0.45** + drizzle-kit 0.31 for migrations
- **better-auth 1.7** with a Google provider and a Drizzle adapter
- **Tailwind 4** + shadcn/ui
- **Zod 4** — validates *every* response from the unofficial API before it enters the system
- **Upstash QStash 2.11** — periodic sync and operations at an exact time
- **Vitest 5** + **PGlite** (in-process Postgres, no Docker) and **Playwright 1.63** (E2E)

**On authentication:** the initial draft called for Auth.js v5, but it's still in
beta (`5.0.0-beta.32`), whereas better-auth is stable at 1.7.2 and already sees more
use. It also ships the `admin` and `access` plugins, which give built-in role control
out of the box — the portal's three roles get declared as policies rather than as
custom code.

### Modules and boundaries

Every module has a purpose, an interface, and explicit dependencies.

| Module | Does | Depends on |
|---|---|---|
| `lib/fantasy-client/` | **Anti-corruption layer.** The only place that knows about LaLiga's HTTP. Exposes domain functions (`getStandings`, `getTeamRoster`, `getMarket`, `placeBid`, `sellPlayer`) and validates every response with Zod. Never leaks raw types outward. | none |
| `lib/sync/` | Orchestrates the pulls, writes idempotent snapshots per `(gameweek, entity)`, stores raw payloads, logs every run | fantasy-client, db |
| `lib/domain/` | **Pure logic, zero I/O.** Standings calculation, evolution series, evaluation of the 5-day rule, Necroporra resolution and scoring | none |
| `lib/db/` | Drizzle schema and queries | none |
| `lib/auth/` | better-auth config, role policies, and server guards | db |
| `lib/scheduler/` | Publishing to QStash and signature verification on receipt | none |
| `app/(portal)/` | Routes and views | all of the above |

`lib/domain/` having no I/O is deliberate: it's where all the logic specific to you
lives, and it's testable without a network or a database.

## Data model

Core:

- `user`, `session`, `account`, `verification` — tables generated by better-auth
- Additional field `role` on `user` (`user` | `collaborator` | `admin`) and
  `fantasy_team_id`
- `league_credentials` — **central read token**. Single row, encrypted token,
  refresh, expiry, `updated_by`. It's what feeds every sync and, therefore, every
  view of the portal for everyone
- `fantasy_credentials` — an individual manager's token, encrypted, refresh, expiry.
  *Opt-in, only needed for executing scheduled operations*
- `teams` — API id, name, manager, nullable `user_id`
- `gameweeks` — number, start, end, status
- `sync_runs` — start, end, status, error, entities touched
- `raw_sync_payloads` — endpoint, timestamp, `jsonb` payload

Standings and evolution *(slice 1)*:

- `team_gameweek_stats` — `(team_id, gameweek)`, gameweek points, cumulative points,
  position, team value

Players and market:

- `players` — id, name, position, real-life team
- `player_value_history` — `(player_id, date)`, market value, points
- `roster_entries` — `team_id`, `player_id`, `acquired_at`, `acquired_via`,
  `released_at` → **the table that makes the 5-day rule computable**
- `market_operations` — type, team, player, amount, `occurred_at`, origin
- `fairplay_violations` — team, player, `acquired_at`, `sold_at`, days held,
  `detected_at`, note. Unique key to make detection idempotent
- `scheduled_operations` — user, type, player, max amount, `execute_at`, status,
  `qstash_message_id`, result

Polls:

- `poll_templates` — name, `kind`, `config jsonb`
- `polls` — template, gameweek, title, opens, closes, status, `vote_rules jsonb`
- `poll_options` — poll, label, `ref_type`, `ref_id`
- `poll_votes` — poll, user, option. Unique on `(poll_id, user_id, option_id)`, which
  prevents voting twice for the same option. The per-person vote limit and the ban on
  voting for yourself are `vote_rules`, validated in `lib/domain/` before writing
- `poll_results` — poll, `resolved_at`, correct options
- `poll_scores` — user, poll, points

The **Necroporra is a template instance**, not a special-cased table:
`kind = 'necroporra'`, options auto-generated from the teams, voting rule "2 votes,
can't vote for your own team", and resolution "the option with the fewest points in
the gameweek". Adding another kind of poll will mean adding a template, not new code.

## Execution plan

### Step 0 — Feasibility spike *(blocking)*

Before any product line of code, verify against the real API: how the token is
obtained and refreshed, which endpoints give standings, rosters, values and market
data, whether the private league is reachable, and whether there are rate limits.

**Output:** a report and a set of real raw payloads that will serve as test fixtures.
Throwaway code, labeled as such. If this step fails, we go back to the data-source
decision before building anything.

### Step 1 — Skeleton

Next.js project, Drizzle + Neon, Auth.js with Google, a user table with roles and
server guards, a base layout, a working Vercel deployment. No product functionality.

### Step 2 — Vertical slice: standings and evolution

`fantasy-client` with authentication + `getStandings` + points per gameweek, a QStash
sync job, the `teams` / `gameweeks` / `team_gameweek_stats` tables, and two views:
current standings and points evolution (overall chart + per-team detail). A visible
"last sync" indicator.

This slice validates the whole pipeline — token → sync → DB → view — with minimal
investment.

### Later steps *(each gets its own spec, later)*

3. Players: `player_value_history`, `roster_entries`, evolution and opportunity views
4. Fair play: detection via roster diffing + public log
5. Scheduled operations: opt-in account linking, encryption, execution via QStash
6. Polls and Necroporra: template engine, vote restrictions, auto-resolution,
   leaderboard of correct picks

## Test strategy

- `lib/domain/` → pure unit tests. It's where the business logic lives; it needs
  real coverage.
- `lib/fantasy-client/` → tests against the real payloads captured in Step 0. They
  catch when the API's shape changes.
- `lib/sync/` → integration tests with an injected fake client, against a test DB.
- Main views → Playwright.

## End-to-end verification

Once Step 2 is done, it should be possible to check, in this order:

1. `pnpm test` and `pnpm test:e2e` passing
2. `pnpm drizzle-kit migrate` on a clean DB brings up the whole schema with no errors
3. Triggering the sync manually and seeing a new row in `sync_runs` with a correct
   status, and rows in `team_gameweek_stats`
4. Logging into the portal with Google and seeing the standings with the league's
   real data
5. Checking that a user with the `user` role can't access the force-sync action
6. Stopping the DB or faking an API error and confirming the portal keeps serving
   the last snapshot with a staleness notice, without crashing

## Prerequisites for Step 2, discovered while building the skeleton

These four things turned up while reviewing the skeleton branch. They didn't block
it, but all of them affect the standings-and-evolution slice and **must be decided
before writing the sync code**, not after.

1. **`neon-http` doesn't support transactions; PGlite does.** The production driver
   (`drizzle-orm/neon-http`) throws `No transactions support in neon-http driver`,
   while the test bench with PGlite implements `transaction()` correctly. A sync that
   wraps `sync_runs` + `team_gameweek_stats` + `raw_sync_payloads` in a
   `db.transaction()` — which is the natural way to write it and what "idempotent
   snapshots" implies — **would pass every test and blow up in production**. A
   choice has to be made: `db.batch()` (which `neon-http` does support, atomic in a
   single round trip) or switching to `neon-serverless` over WebSocket.

2. **An email allowlist is needed before there's real data.** Today any Google
   account can log in and gets the `user` role. Right now that only lands on an
   empty home page, but Step 2 puts the league's real standings behind that same
   role. The restriction belongs in a `user.create.before` hook.

3. **The team–user relationship has two directions and no constraint.** The schema
   has `user.fantasy_team_id` with no foreign key, and the spec called for
   `teams.user_id`. Step 2 writes to `teams`: one direction has to be chosen first.

4. **There are two authorization engines.** Pages use `decideAccess`; the
   `/api/auth/admin/*` endpoints use better-auth's `hasPermission`, which accepts
   multiple comma-separated roles. If someone assigns `"collaborator,user"`,
   better-auth authorizes it and every page redirects: the user ends up locked out
   of the portal with no error at all. It fails closed, so it isn't a security hole,
   but it's worth unifying.

## Status of this document

Spec validated in a brainstorming session on 2026-09-06. The next artifact is the
detailed implementation plan for Step 0 and Step 1.
