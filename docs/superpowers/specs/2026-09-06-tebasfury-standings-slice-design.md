# TebasFury Step 2 — Standings and progress vertical slice

## Context

The skeleton is deployed and working: authentication, three roles, server guards, and
a Neon database. It has no league functionality at all. This slice adds the first, and
in doing so builds the machinery every later slice depends on — the anti-corruption
layer against the unofficial API, the credential store, and the sync engine.

Phase 0 is closed and its verdict verified against the live API; see `spike/README.md`.
Several of its findings contradict assumptions in the original design
(`2026-09-06-tebasfury-portal-design.md`), and this spec supersedes them where they
differ.

**Goal:** the league can open the portal and see where everyone stands, live during a
round, and how the season got there.

## What Phase 0 changed

1. **Authentication is Azure AD B2C, and the account is a Google login.** There is no
   password to store. A one-time browser bootstrap yields a refresh token; everything
   after that is headless.
2. **The refresh token rotates on every use.** This makes the encrypted
   `league_credentials` table mandatory rather than tidy: an environment variable
   cannot be rewritten at runtime on Vercel.
3. **Per-gameweek history is retrievable**, so the season can be backfilled instead of
   accumulating one round a week.
4. **The nested `team` object in a past-gameweek response carries current state, not
   the state at that gameweek.** Verified across all 13 teams: `teamValue` and
   `teamPoints` are byte-identical between the week-3 response and today's. Only
   `points` and `position` are week-specific.
5. **The response shape differs between a live and a settled gameweek.** The live one
   carries `livePoints` and `previousPosition`; the settled one does not.

## Decisions

| Decision | Value |
|---|---|
| Live standings | Yes — the table moves during a round |
| Backfill | The whole season on first sync |
| Progress charts | Points per gameweek, cumulative points, table position, team value |
| Team value history | Included, accumulating from today; it cannot be backfilled |
| Scheduling | A self-scheduling chain on QStash |

## Architecture

### The one call that feeds everything

`GET /v1/competition/1/leagues/{leagueId}/standing[/{week}]` returns, for all 13 teams
at once: `position`, `points`, and a nested team with `teamValue`, `teamPoints`,
`teamMoney` and `isAdmin` — plus `livePoints` and `previousPosition` while the round is
live. Every one of the four charts derives from it. This slice needs no player data, no
market data, and one endpoint per gameweek.

### Store what is measured, derive what is computed

`team_gameweek_stats` stores only what the API states for that week: the points scored
in it, and the rank within it. Cumulative points and table position are **not stored**
— they are a pure function of the per-week series, and storing them would let the two
drift. The four charts are four projections of one table.

Note the trap this avoids: `position` in a past-gameweek response is the rank *within
that round*, not the table position after it. The table position must be computed by
ranking cumulative totals.

### Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `lib/crypto/` | AES-256-GCM seal and open, key from `CREDENTIALS_KEY` | nothing |
| `lib/fantasy-client/` | **The only place that knows LaLiga's HTTP.** Validates every response with Zod schemas derived from the committed fixtures. Exposes `getAccessToken`, `getCurrentWeek`, `getLeagues`, `getStanding` | crypto, db |
| `lib/sync/` | Decides which weeks are stale, writes snapshots idempotently, stores raw payloads, records runs, and returns when the next run should be | fantasy-client, db |
| `lib/domain/standings.ts` | **Pure, zero I/O.** Turns snapshots into the four series and the current table | nothing |
| `lib/scheduler/` | Publishes to QStash and verifies its signature on receipt | nothing |
| `app/api/sync/route.ts` | The endpoint QStash calls | sync, scheduler |
| `app/(portal)/standings`, `/progress` | The two views | domain, db |

`lib/domain/standings.ts` being pure is what lets the whole computation — cumulative
sums, ranking, the four series — be tested without a network or a database.

## Data model

### Changed from the skeleton

`teams` currently has a `name` column. **The API has no team name**: teams are
identified by their manager. Drop `name`, and shape the table around what the source
actually provides:

- `teams` — `id` (the API's string id, PK), `manager_id`, `manager_name`,
  `user_id` nullable (links a team to a portal account), `first_seen_at`

The skeleton's review flagged that `teams` had no production consumer and that
`user.fantasy_team_id` pointed the opposite way with no foreign key. This slice settles
the direction: **`teams.user_id` is the link**, and `user.fantasy_team_id` is dropped.

### New

- `league_credentials` — single row. `refresh_token_encrypted`, `client_id`,
  `rotated_at`, `updated_by`. Written on every refresh.
- `gameweeks` — `number` (PK), `opens_at`, `closes_at`, `is_live`
- `team_gameweek_stats` — PK `(team_id, gameweek)`. `points` (scored that week),
  `round_position` (rank within the week), `live_points` nullable,
  `is_provisional` boolean, `team_value` nullable, `team_points` nullable,
  `synced_at`
  - `team_value` and `team_points` are nullable **on purpose**: for backfilled weeks
    they are unknown, because the API only reports current state. They are populated
    from the week the portal first syncs onward.
- `sync_runs` — `id`, `started_at`, `finished_at`, `status`, `trigger`
  (`schedule` | `manual`), `weeks_synced`, `error`
- `raw_sync_payloads` — `endpoint`, `fetched_at`, `payload` jsonb. 30-day retention,
  pruned by the sync itself.

## New configuration

This slice introduces one new environment variable, and it must be added to
`.env.example`, to `.env.local` and to Vercel:

| Variable | Purpose |
|---|---|
| `CREDENTIALS_KEY` | 32-byte key, base64, for the AES-256-GCM sealing of the refresh token. Generate with `openssl rand -base64 32`. **Different per environment**, and losing it means re-bootstrapping the credential |
| `LALIGA_LEAGUE_ID` | The private league's id as the API reports it. Discoverable with `GET /v1/competition/1/leagues` |
| `QSTASH_TOKEN` | Publishes the next scheduled sync |
| `QSTASH_CURRENT_SIGNING_KEY` | Verifies that an incoming `/api/sync` call really came from QStash |
| `QSTASH_NEXT_SIGNING_KEY` | The same, during QStash's key rotation |

All five must be added to `.env.example`, to `.env.local`, to Vercel, and — with dummy
values — to `playwright.config.ts`, so the E2E suite keeps building with no `.env.local`.

The existing `LALIGA_REFRESH_TOKEN` in `.env.local` is Phase 0 scaffolding. Once the
credential lives in `league_credentials`, it is read from the database, and the
variable is removed rather than left to rot into a second source of truth.

## Sync

### The self-scheduling chain

Each run ends by deciding when the next should be and publishing that to QStash:

- While the current week `isLive`: **10 minutes**.
- Otherwise: at the next week's `openingWeekDate`, which the API already gives us, with
  a daily heartbeat as a floor so a missed schedule cannot strand the chain.

This spends no calls while nothing is happening, needs no manual tuning as fixture
times move, and uses data already being fetched. The alternative — a fixed frequent
cron — would make 144 calls a day to observe nothing.

### What a run does

1. Load and decrypt the refresh token; exchange it for an access token; **persist the
   rotated refresh token before doing anything else**. Losing a rotation costs a manual
   browser bootstrap.
2. `GET …/week/current` to learn the current week and whether it is live.
3. Determine stale weeks: any week from 1 to current with no row, plus the current week
   if it is live or was last written as provisional.
4. For each, `GET …/standing/{week}` and upsert. The current live week is written with
   `is_provisional = true` and its `live_points`; once the week closes, the next run
   overwrites it settled.
5. Store the raw payloads; prune anything older than 30 days.
6. Record the run; schedule the next.

### Transactions — the trap from the skeleton review

`neon-http` **does not support transactions**; PGlite does. A run wrapped in
`db.transaction()` would pass every test and throw in production.

The obvious replacement, `db.batch()`, has the mirror-image problem: it exists **only**
on `NeonHttpDatabase`, not on PGlite and not on the `PgDatabase` type shared by both.
It would compile and run in production and fail in every test.

So the rule for this slice is neither: **plain sequential awaits.** The writes are
idempotent upserts, so a run that dies halfway is corrected by the next one, and
nothing reads a half-written gameweek and acts on it. Atomicity buys nothing here and
would cost an abstraction that exists only to paper over the driver gap.

Hard rule for this slice and everything after it: **no `db.transaction()`, no
`db.batch()`.** If a future slice genuinely needs atomicity across statements, the
driver question gets reopened then, deliberately.

## Views

**`/standings`** — the current table: position, movement against the previous round,
points, and team value. While a round is live it shows live points and is clearly
labelled as provisional. Every page carries the time of the last successful sync, so
stale data is visibly stale rather than quietly wrong.

**`/progress`** — the four charts, all from the same snapshots: points per gameweek,
cumulative points, table position by gameweek, and team value over time. The last one
starts sparse and says why, rather than looking broken.

**`/admin/sync`** — the existing placeholder becomes real. It gains a field to paste a
bootstrap refresh token into, a manual sync trigger, and the history from `sync_runs`.
Both actions are gated by `sync:trigger`, which `collaborator` and `admin` already hold.

## Error handling

A failed sync writes its error to `sync_runs` and leaves the last good snapshots in
place. The portal keeps serving them with their age shown. A refresh token that no
longer works is a distinct, named state: the admin page must say "the credential needs
re-bootstrapping" and link the four-step procedure, not show a generic failure.

## Testing

- `lib/domain/standings.ts` → pure unit tests. This is where the real logic lives:
  cumulative sums, ranking, and the trap that round position is not table position.
- `lib/fantasy-client/` → tests against the anonymised fixtures already committed in
  `spike/fixtures/`. They pin the response shape, including the difference between a
  live and a settled week, and will fail loudly when the API changes shape again.
- `lib/sync/` → integration against PGlite with a fake client injected: backfill from
  empty, a live week overwritten when it settles, and a failed run recorded.
- The two views → Playwright.

The whole suite must keep running with no environment variables and no network, as it
does today.

## Out of scope

Players, market, fair play, scheduled operations and polls. This slice touches one
endpoint and two views, and builds the machinery the rest will reuse.


## Follow-ups this slice leaves behind

Written at merge, from the whole-branch review and the execution ledger, so none of it
has to be rediscovered.

### Before the next deploy

- **Migrations `0003` and `0004` have never been applied to production.** Checked
  directly: `team_gameweek_stats` does not exist on the live database. Run
  `DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate` before deploying, or the first
  sync fails at runtime rather than at build. `0004` only drops three NOT NULL
  constraints and is safe against a populated table.
- The credential must be bootstrapped from `/admin/sync` before any sync can run.
  `docs/deployment.md` carries the procedure.

### Worth watching once

- **The gameweek rollover is reasoned about, never observed.** The code is safe under
  every reading of what `week/current` reports between rounds — a current week is only
  written as settled once its closing date has passed and someone scored — but nobody
  has watched a real boundary. Check `sync_runs` and `gameweeks` across the next one.
  The `nextWeek` field is parsed and unused; it is the field that would settle the
  question.
- `/admin/sync`'s restyle is verified by build output and emitted CSS, not by eye. The
  E2E suite has no authenticated fixture, so no test renders that page signed in.

### Known soft spots

- `StandingEntry` and `CurrentWeek` are documented as internal to
  `lib/fantasy-client/`, but only by a doc comment. Nothing stops a future import from
  reaching past the boundary — which is exactly how the live-versus-settled `points`
  confusion crossed it once already. A lint boundary would make the rule real.
- `buildTable`'s team-value pick was rewritten to be order-independent, and
  `loadSnapshots` now orders explicitly. Neither half has a regression test.
- Every new required environment variable forces an edit in three test stub blocks,
  because `getEnv()` validates the whole schema at once. The players and market slice
  will add several; a shared test stub is worth it then.
- Four verbatim copies of the shared database type alias live in four modules. One
  exported type in `lib/db/` would do.
- `raw_sync_payloads` stores a full thirteen-team payload every ten minutes during a
  live window — roughly 470 near-identical rows a week. Retention bounds it, but the
  debugging value is in shape changes, not in 470 copies of one shape.
- `/api/sync` has no `maxDuration`, and writes are one round trip per row. A first
  backfill late in a 38-week season would be around 1,100 round trips and could hit the
  function timeout.
