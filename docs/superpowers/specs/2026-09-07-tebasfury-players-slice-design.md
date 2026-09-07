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

## Follow-ups this slice leaves behind

Written at the fix wave that came after the whole-branch review, from that review and
the execution ledger, so none of it has to be rediscovered.

### Before the next deploy

- **Migrations `0003`, `0004`, `0005` and `0006` have never been applied to
  production.** Checked directly, the same way the standings slice checked `0003` and
  `0004`: `team_gameweek_stats` does not exist on the live database. Run
  `DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate` before the next deploy, or the
  first sweep 500s at runtime with `relation "players" does not exist` instead of
  failing at build. `0005` (the four player tables) and `0006` (an index on
  `player_value_snapshots`) are both additive and safe against a populated database.

### Worth watching once

- **The four-entry `weekPoints` ceiling.** In the one live capture, no player's
  `weekPoints` array ever carried more than four entries, while week numbers observed
  in it reached six. One capture cannot tell a rolling window (the API only ever
  returning the last four gameweeks) from "the season has not reached five yet" — both
  look identical this early. Watch whether it grows past four over the next few
  gameweeks. If it does not, `queries.ts`'s and this doc's claim that the endpoint
  carries the points history "for everyone in a single request" needs correcting, the
  points backfill (`src/lib/sync/players.ts`) needs a strategy for the weeks that fall
  out of the window, and the player page needs a line explaining why early gameweeks
  go sparse for everyone at once. This was mandated at Task 1 and never recorded here
  until now.
- **Pressing "Sweep players" while the chain is alive forks a second, permanent
  chain.** Nothing checks for a QStash message already in flight before scheduling
  another, so a second press doubles the cadence rather than merely restarting it.
  Harmless for correctness — every write in a sweep is idempotent — but it doubles
  load on an API the design is trying to be polite to. `docs/deployment.md` step 8 now
  says not to do this; nothing in the code prevents it.

### Known soft spots

- **Club name is recoverable for free, and the premise Ruling 1 dropped it on was
  false.** The squad response the sweep already fetches and parses carries
  `playerMaster.team = {id, name}`, keyed by the same id space as the catalogue's
  `teamId` — verified against the committed fixtures: `F. Garcés` has `teamId: "21"`
  in `players.json`, and `21` is `Deportivo Alavés` in `squad.json`. Thirteen squads
  times roughly fifteen players covers most or all twenty clubs at zero additional API
  cost. This is a cheap win for the next slice to pick up, not a defect in this one:
  restoring it would touch the schema, the client, the sweep, the domain module and
  both views, and a cross-call join belongs behind its own review rather than folded
  into an unrelated fix wave. Until then the catalogue cannot say which club a player
  plays for.
- `lastSeenAt` is written by every sweep and read by nothing. A player who leaves the
  competition keeps their last snapshot shown as a current value for ever, with no
  visible sign they are gone.
- `loanedPlayers` in the squad response is unread (`0` in the one capture, so never
  exercised); a loaned player would read as "Free agent" today. `playersNumber` is
  also unread and unverified against `players.length`, so a squad response truncated
  by the API would shrink a team silently rather than being noticed.
- `sync_runs` records no per-sweep row counts. `weeksSynced` is the standings chain's
  column, reused by nothing here (a players row always has it `null`), so the run
  history cannot distinguish a sweep that read 836 players from one that read 120. A
  generic column (or a `details` jsonb) needs a migration; this fix wave added
  `squadsSkipped` and `droppedSquadPlayers` to the in-memory result and the trigger
  message, but neither is persisted.
- The whole ~836-row catalogue crosses to the client on every `/players` load so
  search is instant — defensible for a phone during a matchday, but an unnamed
  decision that grows with the catalogue and was never weighed against, say, a
  server-side search endpoint.
- The charts are only covered through their `<details>` fallback table:
  `renderToStaticMarkup` of a Recharts `ResponsiveContainer` emits no chart markup, so
  none of the existing assertions would notice if `<BarChart>` or `<LineChart>` were
  deleted outright. The fallback table is real coverage of the data; the chart
  rendering itself is not covered by anything but eyes on a real device.

### Parked at the final review, with the reasoning

Both were raised by the scoped re-review of the fix wave, judged non-blocking, and
deliberately not fixed — there is no second fix wave by design, so they are recorded
here instead of being silently dropped.

- **A demoted low-sample average is not visually distinguishable from a genuine one.**
  Fixing "Best average" used a minimum of three recorded gameweeks, so a one-appearance
  player sinks rather than topping the sort. But the row still prints its average
  unconditionally, so once a demoted row and a null-average row both sit at the bottom,
  a reader cannot tell a 1-gameweek `12.0 avg` from a lower-scoring steady player
  without switching sorts. Nothing became less honest than before — the row text is
  unchanged and the finding explicitly allowed either mitigation — but the demotion is
  silent. The threshold of three is reasoned, not measured against a live catalogue.
- **One squad scenario is untested as a distinct case:** a team that *had* recorded
  members, whose current response carries ids that are *all* filtered out by the
  catalogue-membership check. Both guards funnel through the same
  `validIds.length === 0` gate, so inspection says it lands on the skip-the-prune
  branch and cannot wedge the sweep — but "empty from the API" and "some ids valid" are
  covered separately and their combination is not.

### The visual checks — performed 2026-09-07, all clean

Both new views sit behind `requireSession()` and the E2E suite has no authenticated
fixture, so no agent could load either page in a browser: every layout claim on them was
reasoned about in writing and never seen. The owner worked through the list below on
2026-09-07, against the deployed build with the real 836-player catalogue and 13 squads
swept, and **found nothing wrong**. Items 7 and 13 are the exception and remain open by
nature, not by omission — see the note after the list.

The list is kept rather than deleted because it is the checklist to re-run whenever these
two views change, and because it records what was verified by eye rather than by test.

On `/players`:

1. Do the twelve filter/sort pills push the first player row below the fold, and is that
   acceptable?
2. Is `--board-free` ("Free agent") legible on `#10120f`, and does it read as neutral
   rather than as a warning beside `--board-alert`?
3. Does a real long nickname collide with, or crowd, the value numeral?
4. Does the page scroll horizontally anywhere between 320px and 768px?
5. Does the search feel instant against the full ~836-row catalogue on a real phone?
6. Does "Showing 60 of X" read naturally once a filter has already narrowed the list?

On `/players/{id}`:

7. Is the bar chart's gameweek axis legible for a player with 20+ gameweeks? (Only ever
   checked at 2-4.)
8. Does the value chart's single-dot case render for a player with exactly one snapshot?
9. Does the header wrap badly for a long nickname plus a non-`ok` status?
10. Do either `<details>` table cause page-level horizontal scroll on a real device?
11. Do the two big numerals keep their labels un-wrapped under a longer owner line?
12. Does the status read identically on the catalogue and the detail view?
13. The value chart's line axis at 200+ daily ticks — the series has never been seen
    past a handful of days, so tick density at season length is unverified.

Elsewhere:

14. `/players/<a bogus id>` while signed in: the new `not-found.tsx` on the board's dark
    tokens, with no white flash.
15. `/admin/sync`: press "Sweep players" and watch the "Sync now" button — it must stay
    "Sync now". Also check the new "last successful sweep" line does not crowd the
    buttons at narrow widths, and that it does not visually compete with the run table.
16. The nav at 375px now that "Players" is a fifth link — does it wrap, scroll, or crowd
    the sign-out control?
17. The search input on real iOS Safari: `type="search"` gets platform chrome and a
    clear button, and nothing sets `::placeholder`, so its contrast on the dark ground
    is unverified.

Two of those checks could not be performed on 2026-09-07 and are not a matter of effort:
the value chart's axis at 200+ daily ticks (item 13) and the bar chart's axis at 20+
recorded gameweeks (item 7) both need data volume that did not exist yet. The value
series began on the day of the first sweep, and the points backfill only reaches as far
as the catalogue's `weekPoints` window. Both become checkable a few weeks into the
season; until then the axis density at real season length is unverified.
