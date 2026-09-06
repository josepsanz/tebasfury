# TebasFury Step 3 — Players and market values

## Context

Step 2 is in production and syncing on its own: the standings and progress views run off
gameweek snapshots, and the self-scheduling chain has been observed firing. That slice
built the machinery — the anti-corruption layer, the encrypted credential, the sync
engine — and this one is the first to reuse it rather than invent it.

**Goal:** the league can look up any player, see what they cost and what they score, and
watch both move over the season.

## What a probe against the live API settled

Before designing, `GET /v1/competition/1/players` was called with a real token. One
call returns every eligible player with:

| Field | Meaning |
|---|---|
| `id`, `nickname`, `positionId`, `teamId` | Identity and where they play |
| `marketValue` | **Current** market value |
| `points`, `averagePoints`, `lastSeasonPoints` | Season aggregates |
| `weekPoints[]` | **Points for every gameweek played so far** |
| `playerStatus` | Availability (`ok`, injured, and so on) |
| `image` | Portrait URL |

Two consequences, and they shape everything below:

1. **Per-player calls are not needed.** The spike's warning about a 600-call sweep does
   not apply: `weekPoints` carries the points history for everyone in a single request.
   `GET …/player/{id}/league/{id}` stays unused in this slice.
2. **Market value history does not exist in the API.** `marketValue` is current state,
   the same trap as team value in Step 2. The series can only be accumulated forward,
   one snapshot at a time, and the design must be honest about that rather than
   inventing a past it cannot know.

## Decisions

| Decision | Value |
|---|---|
| Scope | Players and their values. Fair play stays a separate, later slice |
| Points history | Backfilled from `weekPoints` on the first sync |
| Value history | Accumulates forward from the first sync; no backfill is possible |
| Ownership | Included — see below |
| Opportunity view | **Deliberately not built yet** |

### Why ownership is in, and the opportunity view is out

The owner named three things "opportunity" might mean: players rising in value, points
per million, and unowned players scoring well. Rather than guess, the slice **builds the
data all three need and builds none of the views**. The decision gets made once there is
a real catalogue to look at, which is a better moment to make it.

Ownership is the exception, and it is in for three reasons: it costs thirteen calls, one
per team; a catalogue that cannot say who owns a player is much less useful today; and
two of the three opportunity ideas depend on it. It is also what the fair-play slice will
read.

## Architecture

### Sync: a second, slower cadence

Step 2's chain runs every ten minutes while a gameweek is live. Player data does not
move at that rate, and the API is unofficial and undocumented — sweeping it every ten
minutes would be rude and pointless.

So this slice adds a **second cadence rather than more work in the existing one**: the
player sweep runs at most once a day, and the standings sync stays as it is. A single
run does two calls plus one per team:

1. `GET …/players` — the catalogue, current values, and points history
2. `GET …/leagues/{id}/teams/{teamId}` for each of the thirteen teams — squads

Both cadences share one credential exchange and one `sync_runs` row shape. The existing
`sync_runs.trigger` gains a value; `runSync` is not overloaded with a second job.

### Store what is measured, derive what is computed

The rule from Step 2 holds, and it applies twice here:

- **Points per gameweek** are stated by the API, so they are stored per gameweek. Season
  totals and averages are derived — the API also states them, but storing both invites
  the two to disagree, and the per-gameweek series is the one that cannot be recomputed.
- **Market value** is a snapshot with a timestamp, never a "current value" column that
  gets overwritten. Overwriting is what makes a history impossible to build later.

### Modules

| Module | Responsibility |
|---|---|
| `lib/fantasy-client/` | Gains `getPlayers()` and `getSquad(leagueId, teamId)`, both Zod-validated and both returning **domain rows, not API shapes** — the rule Step 2's critical bug taught |
| `lib/sync/players.ts` | The daily sweep: upsert the catalogue, append a value snapshot, backfill points, replace squads |
| `lib/domain/players.ts` | **Pure.** Value series, points series, points-per-million, ownership lookup |
| `app/(portal)/players` | The catalogue and the per-player page |

## Data model

- `players` — `id` (the API's, PK), `nickname`, `position`, `real_team_id`, `status`,
  `image_url`, `first_seen_at`, `last_seen_at`
- `player_gameweek_points` — PK `(player_id, gameweek)`, `points`. Backfilled from
  `weekPoints`, then extended each sweep.
- `player_value_snapshots` — PK `(player_id, taken_on)` where `taken_on` is a date, not
  a timestamp: one snapshot a day is the resolution, and the primary key makes a second
  sweep on the same day idempotent rather than duplicating.
- `squad_members` — PK `(team_id, player_id)`, plus `first_seen_at`. Current state,
  replaced each sweep. **Not** an event log: the fair-play slice will read the activity
  endpoint for that, which is why `roster_entries` from the original design is dropped.

`players.status` is stored as the API's own string rather than an enum. We have seen one
value (`ok`) and guessing the rest would be inventing a vocabulary; a lookup table can
come later when the real values are known.

## Views

**`/players`** — the catalogue. Name, position, real team, current value, season points,
average, and who owns them in the league. Sortable and filterable, because with roughly
six hundred rows a plain list is unusable. Free agents are visibly free.

**`/players/{id}`** — one player. Two charts on the shared matchday-board tokens: points
per gameweek, and market value over time. The value chart starts sparse and says why,
the same honesty Step 2's team-value chart uses.

No opportunity view. That decision waits for the data.

## Error handling

A failed sweep records itself in `sync_runs` and leaves the last catalogue in place; the
views show its age. A sweep that returns an implausibly small catalogue — fewer than a
hundred players — is treated as a failure rather than written, because replacing six
hundred players with a truncated response is worse than skipping a day.

## Testing

- `lib/domain/players.ts` → pure unit tests.
- `lib/fantasy-client/` → against a captured, anonymised `/players` response, the same
  way the standing fixtures work. Capture one as part of the first task.
- `lib/sync/players.ts` → integration against PGlite with a fake client: first sweep
  backfills points, a second sweep on the same day does not duplicate a value snapshot,
  a shrunken catalogue is refused, a transferred player moves squads.
- The two views → `renderToStaticMarkup`, as Step 2 ended up doing.

The suite keeps running with no environment variables and no network.

## Rules inherited from Step 2, restated because they still bind

- **No `db.transaction()` and no `db.batch()`.** Sequential awaits; idempotent upserts.
- **Nothing outside `lib/fantasy-client/` may know the API's shape.** The client returns
  domain rows. This is not stylistic: the meaning of a field crossing that boundary
  unexamined is exactly what made Step 2's standings show the wrong leader.
- Everything in English. TypeScript strict, no `any`.

## Out of scope

Fair play, the market, scheduled operations and polls. And the opportunity view, which is
out on purpose rather than by omission.

## Practical notes for whoever implements this

Things Step 2 cost time to discover that are not obvious from reading the code.

- **Type databases as `PgDatabase<PgQueryResultHKT, typeof schema>`** from
  `drizzle-orm/pg-core`. The `Database` type exported from `@/lib/db` is a
  `NeonHttpDatabase` and does not compile against the PGlite instance the tests use.
- **`getEnv()` validates the whole schema at once**, so a new environment variable has
  to be added in six places or something breaks: the schema, `.env.example`,
  `.env.local`, `env.test.ts`'s `valid` fixture, the stub blocks in three test files,
  and `playwright.config.ts`. Step 3 should not need any new variable; if it does,
  extracting a shared test stub first is overdue.
- **The E2E suite has no authenticated fixture.** Both portal pages call
  `requireSession()`, so Playwright can only assert that an anonymous visitor is
  redirected. Rendered output is covered by `renderToStaticMarkup` tests instead — plan
  for that from the start rather than writing E2E tests that cannot pass.
- **A stale `next start` can survive `lsof -ti:3000 | xargs kill`.** Use
  `ss -ltnp | grep :3000` and `kill -9`, or Playwright fails with `EADDRINUSE` and the
  cause is not obvious.
- **The credential rotates on every use.** Any script that exchanges it must persist the
  new one, or the next real sync fails and someone has to bootstrap from a browser.
  Use `getAccessToken(db)`, which already does this, rather than calling the token
  endpoint by hand.
- **Capture the `/players` fixture through the real client**, then anonymise nothing —
  player names are public, unlike the manager nicknames the standing fixtures required
  scrubbing. Six hundred players is a large fixture; consider committing a trimmed slice
  of it with the shape intact.
