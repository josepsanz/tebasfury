# TebasFury Step 6 — Fair play and the market log

## Context

The group has one internal rule: **players are not sold before five days**. Nobody can
enforce it technically — the official app knows nothing about it — and the portal's
brief from the beginning has been that having it logged and visible is what changes
behaviour.

Every slice so far has deferred it. The master plan proposed detecting violations by
**diffing rosters**: compare each daily squad sweep against the last and infer arrivals
and departures. That approach has two holes nobody could close, and this slice was
designed expecting to accept them:

- Day resolution at best, from a once-a-day sweep, against a rule measured in days.
- **Total blindness to a player bought and sold between two sweeps** — which is the most
  flagrant version of the very thing the rule exists to discourage.

There is also a clock running. `squad_members` is rewritten wholesale on every sweep and
carries no `acquired_at`: today the portal keeps no history from which any of this could
be computed, and every day that passes is a day of the rule that can never be recovered.

**Goal:** the league's market is visible in one place — who bought whom, from whom, for
how much, and when — with sales inside five days marked as what they are.

## What the probe settled

A throwaway spike ran against the live API on 2026-09-08, in three passes, and it
changed the design rather than confirming it. **The API exposes the operations
directly.** Roster diffing is not needed and is not used.

`GET /v1/competition/1/leagues/{leagueId}/activity`

```json
{"activityTypeId":1,"id":"44515638","user1Id":11577824,"user2Id":9890566,
 "playerMasterId":1730,"amount":1758321,"createdAt":"2026-09-07T21:32:04+02:00"}
```

| Observation | Value |
|---|---|
| Entries returned | **94** |
| Time covered | 2026-09-01T04:34 to 2026-09-07T22:17 — **7 days** |
| Timestamp precision | To the second, with offset (`+02:00`) |
| Paging | **Ignored.** `?limit=500`, `?offset=94`, `?page=2`, `?size=500`, `?from=2026-08-01` all return the identical 94 entries |
| `user1Id`/`user2Id` against `teams.managerId` | **13 of 13 match. Zero unmatched** |
| `playerMasterId` against `players.id` | **76 of 76 match. Zero unmatched** |

Four consequences shape everything below.

1. **The five-day rule becomes exact rather than approximate.** Both ends of a holding
   period are timestamped to the second. Neither of the diffing holes survives: a player
   bought and sold within one hour is two rows in this feed.
2. ~~**It is a rolling window, not a history.**~~ **Wrong — corrected 2026-09-09.** The
   probe behind this point tried `?limit`, `?offset`, `?page`, `?size` and `?from`, got the
   same entries five times, and concluded there was no paging. The paging is a **path
   segment**: `/activity/0` is the recent window, `/activity/1` everything before it. On
   2026-09-08 the two held 105 and 318 entries, no id in both, reaching back to 11 August.
   So there IS a history, the backfill this slice called impossible is a page walk, and an
   outage longer than the window heals itself on the next sweep. What survives of this
   point: the window alone is about seven days, so a capture that only asks for page zero
   would still have lost everything older.
3. **The identifiers join with nothing in between.** No mapping table, no fuzzy matching,
   no name comparison. The feed's ids are our ids.
4. **The operation types are learnable from evidence, and three of six now are.**

### Which type is which, established by evidence rather than by name

The feed labels operations with an opaque `activityTypeId`. The spike settled the
direction of each by asking a question the data can answer: **is the player now in the
acting manager's squad?** A type that lands players in your squad is an acquisition; one
whose players are gone from it is a release.

| Type | Entries | Carries | user1 holds the player now | Reading |
|---|---|---|---|---|
| 31 | 32 | player, amount | **27 of 32** | **Bought from the market** |
| 33 | 30 | player, amount | 7 of 30 — *not* held in 23 | **Sold to the market** |
| 1 | 12 | player, amount, `user2Id` | 8 of 12 (user2 holds 3) | **Transfer between managers; user1 receives** |
| 4 | 7 | player, **no amount** | 5 of 7 | **Unknown — deliberately not classified** |
| 6 | 12 | amount, `weekNumber`, no player | — | Weekly, not a market movement |
| 7 | 1 | `weekNumber` only | — | Weekly, not a market movement |

Type 4 is left unnamed on purpose. It carries no amount and its players are usually
still held, so calling it a release would be a guess — and a guess here does not produce
a wrong number, it accuses a person. Ruling 8 says what happens to it.

### The rule, measured on real data before a line was written

Applying only the three types whose direction the evidence settled, over the seven
days the window held:

> **cristian1206 · Marcos Llorente — held 4.00 days.** Bought 2026-09-03T17:02, sold
> 2026-09-07T16:59. Type 31 → 33.

One other complete pair existed in the window (La rataneta · Mangala, 6.08 days) and sits
above the line. This is a measurement from a one-off probe, not a published verdict, and
it is recorded here as the evidence that the design computes what it claims to. It also
says something the design must respect: the rule is broken in practice, so the log will
not be an empty page, and it will name people the first week it ships.

## Decisions

| Decision | Value |
|---|---|
| Source | The league activity feed. **Roster diffing is not used** — see Ruling 1 |
| Extra API calls | **One per daily sweep** |
| What is stored | Every operation, raw, including types nobody has identified — see Ruling 2 |
| Violations | **Derived, never stored** — see Ruling 2 |
| A clause raid, for the manager who loses the player | **Not a sale** — see Ruling 3 |
| A clause raid, for the manager who receives the player | Starts the five-day clock — see Ruling 3 |
| The threshold | Elapsed time, strictly under **120 hours** — see Ruling 4 |
| A holding period that predates the log | **Unknown** — never compliant, never a breach — see Ruling 5 |
| Cadence | Rides the daily players sweep; a failed capture **fails the sweep** — see Ruling 6 |
| Foreign keys on `market_operations` | **None** — see Ruling 7 |
| Unknown operation types | Stored, not rendered — see Ruling 8 |
| The page | `/market`, sixth nav link, and the nav is redesigned here — see Ruling 9 |

## Rulings

### Ruling 1 — the activity feed replaces roster diffing entirely

The master plan's `roster_entries` table, and the whole idea of inferring arrivals and
departures by comparing consecutive squad sweeps, are superseded. The API states the
operations; inferring them from their after-effects would be strictly worse data,
obtained with more code.

`squad_members` keeps doing exactly what it does today. Nothing about the existing sweep's
squad handling changes, and no `acquired_at` column appears anywhere.

The consequence worth naming: this slice's data begins the day it deploys. Roster diffing
would have had the same property, so nothing is lost by the change — but neither approach
can answer a question about August.

### Ruling 2 — everything is stored raw, and violations are computed

`market_operations` receives every entry the feed returns, including types 4, 6 and 7
that nobody has identified. Storing an uninterpreted row costs one insert; not storing it
loses it in seven days, permanently, and the questions it could have answered with it.

Violations are **not** a table. The master plan proposed `fairplay_violations` with a
`detected_at` and a unique key for idempotent detection; this slice does not build it,
because Step 3 already settled the principle it would breach: *store what is measured,
derive what is computed*. An operation is measured. A violation is arithmetic over two
operations and a threshold — and a stored one can disagree with the rule that produced it.

The practical gain: the day the group argues about whether five days should be three,
changing `HOLD_HOURS` re-derives the entire history correctly. A stored table would need
a migration and would carry verdicts computed under a rule nobody uses any more.

### Ruling 3 — a clause raid is not a sale by the manager who loses the player

A type-1 transfer is one row describing two things: the actor receives a player, and the
counterparty loses one. In this game that is normally a clause being paid, and the
manager who loses the player did not choose to.

So the two sides are read differently, and this asymmetry is the heart of the domain:

- **For the actor:** an acquisition. The five-day clock starts.
- **For the counterparty:** a loss, and **never a violation**. They did not sell.

Counting it would point the public log at the person who was raided, which is precisely
backwards from what the rule exists to discourage. Only a type-33 sale — a manager
choosing to sell to the market — can end a holding period in a violation.

### Ruling 4 — the threshold is elapsed time, strictly under 120 hours

Bought at 17:02 on Wednesday, sellable from 17:02 on Monday. Not calendar days, which
would need a timezone to cut the day on and would give a purchase at 23:50 a first "day"
of ten minutes.

The comparison is strict: exactly 120 hours is not a violation. No grace margin below it
either — a second threshold to soften the first is a second number to explain every time
somebody asks, and the rule's whole value is that it is simple enough to be quoted.

### Ruling 5 — a holding period that predates the log is unknown, and says so

A sale whose matching acquisition is not in the store cannot be judged. The player may
have been held for a month or for an hour; the log began after the acquisition and there
is no way to find out, because the feed's window has already rolled past it.

Such a sale renders as a movement with an **unknown** holding period. Never as compliant
— that would be a claim the data cannot support — and never as a breach.

This is not an edge case to file away: in the first week after deployment, most sales
will be exactly this, and the page has to be honest about it without looking broken. It
is the same distinction the portal already draws between "nobody owns this player" and
"no squad has been read yet".

### Ruling 6 — the capture rides the daily sweep, and its failure fails the sweep

One call, added to the players sweep that already runs daily. The window is seven days,
so a daily cadence carries six days of margin, and a second QStash chain for a single
call is machinery this project already regrets once — pressing "Sweep players" twice
forks a permanent second chain, and that debt argues against adding chains lightly.

**A failed activity fetch fails the whole sweep**, which is deliberately unlike the rest
of the sweep's tolerant handling. Everywhere else a failed part can be retried tomorrow
against the same data. Here the data is gone tomorrow: the window rolls. Failing loudly
puts QStash's retries — the fast recovery this project already relies on — behind the one
call whose input expires. Every write in a sweep is idempotent, so a retry costs nothing.

### Ruling 7 — no foreign keys from `market_operations`

Neither `player_id` nor the two manager columns get a foreign key, for the reason
`real_teams` already established from the other side: an operation can name a player the
catalogue has not swept yet, or a manager who joined between standings syncs. A foreign
key would turn that into a failed sweep, and every retry after it, for ever.

The join happens at read time and a missing name renders as the raw id rather than
vanishing.

### Ruling 8 — unknown operation types are stored and not rendered

Types 4, 6 and 7 land in the table exactly as they arrive, and the feed does not draw
them. Types 6 and 7 carry no player and are weekly bookkeeping, not market movements.
Type 4 is unidentified, and a row reading "unknown operation" is noise that teaches
nobody anything.

They are stored so that the day somebody identifies type 4 — by watching one happen — the
history is already there to reinterpret. Rendering it before then would either mislabel
it or clutter the page.

### Ruling 9 — the page is `/market`, and the nav is redesigned in this slice

The content is a feed, so it needs a page of its own; there is no folding it into an
existing one as the opportunity boards were folded into the home page.

It is named **Market** rather than "Fair play". The violations are what the page
highlights, but movements are what it holds every day, and a page named after the
sanction gets visited less than one named after the content — which for a rule whose only
power is visibility is the difference between working and not.

That makes six nav links, and `AppNav` is a flat flex row that Step 3's visual check 16
already found tight at 375px with five, and that the opportunity view slice made worse by
one pill elsewhere. Two slices have deferred it. **This one fixes it**, because six is
where the row stops working, and because a fair-play log nobody can reach on a phone is a
fair-play log nobody reads.

## Architecture

### Capture

The client gains one method:

```ts
getActivity(leagueId: string): Promise<MarketOperationRow[]>
```

with Zod at the boundary as everywhere else, and — importantly — a schema tolerant of
unknown `activityTypeId` values and of absent `user2Id`, `playerMasterId`, `amount` and
`weekNumber`, all of which vary by type. An unrecognised type must parse, not throw:
the whole point of Ruling 2 is that tomorrow's new type is stored rather than dropped.

The sweep upserts every row by the API's own `id`. Re-capturing the same day is therefore
free, and so is the seven-day overlap between consecutive daily runs.

### Data model

```
market_operations
  id                       text primary key   -- the API's own operation id
  activity_type            integer not null
  actor_manager_id         integer not null   -- user1Id
  counterparty_manager_id  integer            -- user2Id, only on transfers
  player_id                text               -- playerMasterId, absent on weekly types
  amount                   bigint             -- absent on some types
  week_number              integer            -- only on the weekly types
  occurred_at              timestamptz not null
  first_seen_at            timestamptz not null default now()
```

`amount` is `bigint({ mode: "number" })`, which is what `player_value_snapshots.value`
already uses — checked, not assumed, because a second money type in one schema is how two
columns end up disagreeing about what a euro is. The largest amount the probe saw was
10,686,536.

`occurred_at` keeps the offset the API sends. `first_seen_at` is when the sweep captured
it, and exists to answer "how far back does our log actually reach", which Ruling 5 needs.

**Parameter budget.** 94 rows × 8 columns ≈ 750 bound parameters per sweep against
Postgres's 65,535 cap — comfortable, and unchunked for the same reason `real_teams` is.
A week of unusual activity would have to be seventy times heavier to matter, but the
figure to re-check against is `65,535 / columns`.

### Modules

| Module | Change |
|---|---|
| `src/lib/fantasy-client/schemas.ts` | The activity schema, tolerant of unknown types |
| `src/lib/fantasy-client/index.ts` | `getActivity`, and `MarketOperationRow` crossing the boundary |
| `src/lib/db/schema.ts` | `market_operations` |
| `src/lib/sync/players.ts` | One call, one upsert, one counter in the result |
| `src/lib/domain/market.ts` | **New.** Kinds, pairing, the rule |
| `src/lib/db/queries.ts` | One read for the feed |
| `src/app/(portal)/market/page.tsx` | **New.** The page |
| `src/components/market-feed.tsx` | **New.** The feed |
| `src/components/app-nav.tsx` | Redesigned for six links |

The domain gets its own module rather than joining `domain/players.ts`. That file is
already the largest in the domain and this is a different subject: operations over time,
not a catalogue of players.

### The domain

```ts
export type OperationKind = "bought" | "sold" | "transfer" | "other";

/** 31, 33 and 1 are established by evidence; everything else is deliberately "other". */
export function operationKind(activityType: number): OperationKind;

/** Strictly under this many hours between acquisition and voluntary sale. */
export const HOLD_HOURS = 120;

export type Holding = {
  managerId: number;
  playerId: string;
  acquiredAt: Date | null;   // null when the acquisition predates the log — Ruling 5
  releasedAt: Date;
  hours: number | null;      // null whenever acquiredAt is
  breach: boolean;           // false when hours is null: unknown is not a breach
};

export function holdings(operations: MarketOperation[]): Holding[];
```

Pairing rule: each **voluntary sale** (type 33) is matched to that manager's most recent
prior acquisition of that player — a purchase (31) or a received transfer (1). A
manager who buys, sells and re-buys the same player produces two independent holdings.
A type-1 row is an acquisition for its actor and, for its counterparty, nothing the rule
looks at (Ruling 3).

## Views

### `/market`

The rule, stated once at the top in the group's own words, then the movements newest
first:

```
Market
Players are not sold before five days. Sales inside that window are marked.

  cristian1206 bought Marcos Llorente                          €4.20M
  Wed 3 Sep, 17:02

  cristian1206 sold Marcos Llorente                            €5.10M
  Sun 7 Sep, 16:59 · held 4 days — inside five days

  La rataneta received Mangala from Sisco                      €1.76M
  Tue 1 Sep, 10:47

  Sisco sold Iñaki Williams                                    €8.30M
  Mon 6 Sep, 09:14 · held since before this log began
```

The first two rows above are the probe's real measurement; the rest of the sketch, and
every amount in it, is illustrative. Three states a row can carry, and only one of them
is a judgement: a holding period that
breaks the rule, one that does not, and one that cannot be known (Ruling 5). The third is
the majority in week one and must not read as an error.

A movement whose kind is `other` is not drawn at all (Ruling 8). A player or manager the
portal cannot name renders as the raw id (Ruling 7).

### The nav

Six links do not fit a flat row on a phone. The redesign is deliberately left open here —
it is a layout question that deserves the design skill and the visual companion at the
time, not a decision made in prose weeks earlier. What is fixed is the requirement: six
destinations reachable at 375px without horizontal scrolling and without the sign-out
control being crowded.

## Error handling

The activity fetch is the one part of the sweep that fails loudly (Ruling 6). Everything
else is unchanged: a credential error still surfaces as a credential error, and QStash's
retries are still the fast recovery.

An empty feed is not an error — a quiet week is a quiet week. An empty **table**, before
the first capture, renders the page's own honest line rather than a broken feed.

## Testing

Pure domain, no database:

- Pairing a sale with the most recent prior acquisition, including buy-sell-rebuy.
- The clause asymmetry, both directions: receiving starts the clock; being raided is
  never a breach, even at one hour.
- Exactly 120 hours is not a breach; 119:59 is (Ruling 4's strictness, pinned).
- A sale with no prior acquisition yields `hours: null` and `breach: false` — the
  assertion that stops "unknown" from silently becoming "compliant".

Client, against a committed fixture trimmed to one entry of each observed type:

- An unknown `activityTypeId` parses rather than throwing.
- Absent `user2Id`, `playerMasterId`, `amount` and `weekNumber` all map to null.

Sweep, against PGlite:

- Capturing the same feed twice writes each operation once.
- An operation naming an unknown player is stored, not dropped or failed on.
- A failing activity fetch fails the sweep (Ruling 6, pinned by a test rather than by
  prose).

View:

- All three holding states render distinguishably.
- An `other` operation is absent from the feed.

## Out of scope

- **Scheduled operations and polls.** Steps of their own.
- **A per-manager tally.** Considered and not chosen; a scoreboard of shame is a harsher
  instrument than a log, and the log is what the group asked for.
- **Identifying type 4.** It is stored, and somebody watching a real one happen will
  settle it in a minute. Guessing costs more than waiting.
- ~~**Any backfill.** Impossible, not deferred.~~ **Wrong, and done.** Reaching the whole
  season is one path segment; `getActivity` walks pages until one comes back empty, so
  every sweep is the backfill.
- **Notifications when a rule is broken.** The page is the instrument.

## Practical notes for whoever implements this

- Capture the fixture with a script modelled on `scripts/capture-players-fixture.mts`,
  which goes through `getAccessToken` so the rotated refresh token is persisted. Trim to
  one entry per observed type — the shape matters, ninety-four rows do not.
- ~~The probe's endpoint takes no parameters that do anything. Do not add paging.~~
  Superseded: paging exists as a path segment and is now implemented. The lesson worth
  keeping is the shape of the mistake — five query parameters answered identically, which
  was read as "no paging" when it only ruled out paging by query parameter.
- `activityTypeId` is a number in the response. Do not turn it into a TypeScript enum:
  the set is open, and an enum invites a `default: throw`.
- Vitest does not typecheck. Run `npx tsc --noEmit` before committing anything that
  widens a shared type.
- The nav change touches every page. Load `frontend-design` before the first line of it.

## Follow-ups this slice is expected to leave behind

- ~~**A sweep outage longer than seven days is permanent data loss.**~~ Resolved
  2026-09-09: the page walk re-reads the whole history every sweep, so an outage costs
  nothing but the days it lasts. Nothing still watches for one, and `/admin/sync`'s last
  successful sweep line remains the diagnostic.
- **Type 4 is unidentified**, and types 6 and 7 are stored but unread. All three are one
  observation away from being useful.
- **Amounts are stored and only rendered per row.** A season of them answers questions
  nobody has asked yet — who spends, who hoards, what a position costs — and the data
  will be there when somebody does.
- **The tally remains available.** If the log turns out not to change behaviour by itself,
  the cumulative count per manager is the next lever, and it needs no new data.
- **The `/market` page renders every operation ever captured, unpaginated.** That is fine now
  and fine at the ~4,000-row season the spec projects, but the feed has no bound: by May the
  page renders the whole season rather than a recent window. Nothing is wrong today; the point
  is that the day it does become slow, a bound on the feed is the answer, and the read already
  returns rows newest-first so the cheapest version is a limit rather than a redesign.

## The visual checks — not yet performed

On `/market`:

27. A row at 320px whose manager name, verb, player name and counterparty all appear at
    once ("La rataneta received Mangala from cristian1206") — does the amount keep its
    own column, or does the sentence push it off?
28. The three holding states in one screen — inside five days, kept, and unknown. Do
    they read as three different kinds of statement, or does the unknown one look like
    a failure?
29. A week-one feed, where almost every sale says "before this log began". Does the page
    look informative or broken?
30. Is the breach marker legible in `--board-alert` at 11px, and does it read as a fact
    rather than an accusation?

On the nav, every page:

31. Two tiers at 375px with Sync visible (an admin): do the five destinations fit one
    line, and does the second tier wrap cleanly if they do not?
32. Does the active-section marker survive on `/players/{id}` and on `/admin/sync`,
    which are deeper than their nav entries?
33. The 32 vertical pixels the second tier costs — on the standings table and the
    progress charts, does anything important now sit below the fold that did not?
34. Signed out: the second tier is absent entirely. Does the single line still look
    deliberate rather than unfinished?
