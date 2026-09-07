# TebasFury Step 4 — Club affiliation

## Context

Step 3 is in production, swept and verified: the catalogue lists every eligible player,
their value series accumulates daily, and the owner walked the visual checklist against
the live build on 2026-09-07 and found nothing wrong.

It shipped with one hole its own spec names first among the soft spots: **the catalogue
cannot say which club a player plays for.** Step 3's Ruling 1 dropped club affiliation on
the premise that the API never states a club name. That premise was false, and the fix
wave that discovered it deliberately left the correction for its own slice rather than
folding a cross-call join into an unrelated fix.

**Goal:** every player says which club they play for, and searching a club name lists its
players.

## What the committed fixtures settled

No live probe was needed — the answer is in the fixtures Step 3 already committed, which
is what makes this cheap. Verified directly against
`src/lib/fantasy-client/__fixtures__/`:

| Observation | Value |
|---|---|
| `playerMaster.team` present on | **15 of 15** squad entries |
| Fields it carries | `id`, `name`, `slug`, `assets`, `badgeColor`, `badgeWhite` — all strings |
| Distinct clubs in **one** 15-player squad | **10** |
| Id space | `F. Garcés` is `teamId: "21"` in `players.json`; `21` is `Deportivo Alavés` in `squad.json` |
| Longest club name observed | `Atlético de Madrid` — 18 characters |

Three consequences shape everything below.

1. **The join is free.** The sweep already fetches and parses these squad responses for
   ownership. The club name rides along in a call that is already being made; this slice
   adds **zero** API requests.
2. **The API gives more than Step 3's follow-up recorded.** That note said `{id, name}`.
   There is also a slug and two hosted badge URLs. They are stored and not rendered —
   see Ruling 3.
3. **Coverage is high but not guaranteed.** One squad reaches 10 clubs, so 13 squads will
   very likely reach all 20. But the mapping only ever learns clubs that somebody in this
   league owns a player from, and that set changes with every transfer. A club nobody
   owns from has no name. This is not a defect to engineer away; it is the honest shape
   of the data, and Ruling 1 decides what to do about it.

## Decisions

| Decision | Value |
|---|---|
| Where the name comes from | `playerMaster.team` on the squad response already fetched |
| Extra API calls | **Zero** |
| Storage | A new `real_teams` table, accumulating only what has been observed |
| Seed list of the 20 LaLiga clubs | **No** — see Ruling 1 |
| Foreign key on `players.real_team_id` | **No** — see Ruling 2 |
| Badges and slug | Stored, not rendered — see Ruling 3 |
| Catalogue row | Club **replaces** position on the meta line — see Ruling 4 |
| When the club is unknown | The row falls back to the position — see Ruling 5 |
| Search | Nickname **and** club name |
| Club filter pill or selector | Out of scope |

### Ruling 1 — the club table accumulates what is observed; it is never seeded

A hardcoded list of the 20 clubs would give 100% coverage on day one and never lose a
name. It was rejected: it introduces knowledge the API has not stated, it needs
maintenance every season as clubs are promoted and relegated, and if the API's id space
ever shifts the mapping would lie in silence rather than fail. That is the same trap
`gameweeks.opensAt` refuses when it stays null for a backfilled week rather than being
stamped with the time of the sync.

So `real_teams` holds exactly what some squad response has said, with `firstSeenAt` and
`lastSeenAt` like `players`. A club that has never been observed has no row, and the view
says so by omission rather than by guessing.

### Ruling 2 — `players.real_team_id` gets no foreign key

Not an oversight. Inside `runPlayerSweep`, `upsertCatalogue` writes all ~836 players
**before** `replaceSquads` reads a single squad — so on the very first sweep after this
ships, every player is written at a moment when no club is known at all. A foreign key
would fail the entire sweep, and every retry after it, for ever. That is precisely the
trap `squad_members.player_id`'s own doc comment already documents from the other side.

The relationship is a read-time lookup, not a constraint — the same reasoning that keeps
`player_gameweek_points.gameweek` deliberately unlinked from `gameweeks.number`.

### Ruling 3 — the slug and badge URLs are stored and nothing renders them

`badgeColor` and `badgeWhite` arrive in a response already being parsed. Storing them
costs two nullable columns; recovering them later would cost a migration and a full
sweep. So they are stored.

Nothing renders them, because **neither player view contains a single `<img>` today** —
`players.imageUrl` has been stored since Step 3 and is painted nowhere. A club badge
would be the first image in the portal, and introducing image loading, sizing, failure
states and layout shift across an 836-row list is its own slice, not a rider on this one.

### Ruling 4 — the catalogue row trades its position for its club

The row's left column is already two lines: the nickname, then an 11px meta line reading
`position · owner · status` that **truncates with an ellipsis**. Four options were
rendered at 320px with real strings and compared:

| Variant | Outcome at 320px |
|---|---|
| Append club to the meta line | Truncates — the **owner and the injury flag** fall off the end |
| Club on the name line | Truncates the **player's own name**; worsens soft spot 3 of Step 3's checklist |
| A third line | Nothing lost, but a 60-row page grows by roughly 840px |
| **Club replaces position** | **Nothing truncates, nothing grows** |

The last was chosen. Position is the only one of the four facts that is already reachable
another way — the filter pills select it, and the player's own page still prints it — so
it is the one that can afford to leave the row. The owner and the availability status
have no second route and stay.

**This makes the two views deliberately diverge**, and that is worth stating loudly
because Step 3 went to some trouble to stop them drifting: `ownerDisplay` and
`statusLabel` are shared precisely so the catalogue and the detail page cannot say the
same thing differently. This is not that. The detail page's meta line is a 13px `<p>`
that wraps freely, so it keeps the position **and** gains the club. The divergence is a
decision about space, made once, written down here.

### Ruling 5 — an unknown club falls back to the position

Rulings 1 and 4 combine into a case that has to be answered: if a club may have no name,
and the club has taken the position's place, what does that row show?

It shows the position. `FC Barcelona · Marc` when the club is known, `Midfielder · Marc`
when it is not. The two categories are visually unmistakable, so a reader is never misled
about which they are looking at; no row is ever left with a meta line that opens on the
owner; and on the day this deploys — before the first sweep has learned a single club —
the catalogue behaves exactly as it does today and improves on its own as sweeps observe
clubs.

The rejected alternative, showing nothing, has a one-sentence rule and a uniform row, but
it makes a manual sweep a mandatory deploy step to avoid 836 rows that lost a fact and
gained none, and it leaves a never-observed club permanently poorer.

## Architecture

### The name is learned where ownership already is

`replaceSquads` loops the teams the standings cadence has recorded and calls `getSquad`
once each. Each response carries its players' clubs. The loop accumulates them into a
`Map` keyed by club id — deduplicating across all 13 squads — and after the loop a
**single** `upsertRealTeams` write persists them.

The type that crosses the anti-corruption boundary is
`RealTeamRow = { id: string; name: string; slug: string; badgeUrl: string | null }` —
`badgeColor` renamed at the boundary, `badgeWhite` and `assets` deliberately dropped
because nothing has a use for them and an unused field is an assumption travelling for
free.

Clubs are learned from **every response that parsed**, including one whose membership is
then skipped by the empty-squad guard. The skip is a protection against deleting
`firstSeenAt` on the strength of a suspicious response; it is not a verdict that the
response's contents are false, and a club name in it is a weaker claim than a membership
list, not a stronger one.

### Modules

| Module | Change |
|---|---|
| `lib/db/schema.ts` | New `realTeams` table |
| `drizzle/0007_*.sql` | Generated by `drizzle-kit generate`; additive, safe against a populated database |
| `lib/fantasy-client/schemas.ts` | `squadSchema` learns an **optional** `playerMaster.team` |
| `lib/fantasy-client/index.ts` | `SquadRow` gains `realTeams: RealTeamRow[]`, deduplicated within the response |
| `lib/sync/players.ts` | `replaceSquads` accumulates clubs; new `upsertRealTeams`; `PlayerSweepResult` gains `realTeamsKnown` |
| `lib/db/queries.ts` | `CatalogueData` gains `clubs`; `PlayerDetail` gains `club` |
| `lib/domain/players.ts` | `CatalogueRow` gains `clubName`; `buildCatalogue` merges clubs; `filterCatalogue` widens; new `clubOrPosition` |
| `app/(portal)/players/page.tsx` | Passes the new `clubs` through to `buildCatalogue` |
| `components/player-catalogue.tsx` | The meta line uses `clubOrPosition` |
| `app/(portal)/players/[id]/page.tsx` | The header meta line gains the club |
| `app/admin/sync/actions.ts`, `app/api/sync/players/route.ts` | Report `realTeamsKnown` |

## Data model

```
real_teams
  id           text primary key   -- the API's team id; same space as players.real_team_id
  name         text not null
  slug         text not null
  badge_url    text               -- badgeColor; stored, not rendered
  first_seen_at timestamptz not null default now()
  last_seen_at  timestamptz not null default now()
```

`firstSeenAt` is never in the upsert's update set; `lastSeenAt` always is — the same
contract `players` already uses. On conflict, `name`, `slug` and `badge_url` are
overwritten: a rebranded club's newest observation wins.

**Parameter budget.** Roughly 20 rows × 6 columns = ~120 bound parameters, three orders
of magnitude inside Postgres's 65,535 cap. Unlike the four writes `lib/sync/players.ts`
chunks, this one is bounded by the number of clubs in a competition and needs no chunking
— and, per the existing comment's standing instruction, that claim is what a future
column addition must be re-checked against.

### Why the club is resolved in the domain and not joined in SQL

`toRecord` in `queries.ts` maps a bare `players` row and is shared by both
`loadPlayerCatalogue` and `loadPlayer`. A `LEFT JOIN` changes Drizzle's result shape to
`{ players: …, real_teams: … }` in both, forcing that shared mapper to take a joined
shape or a second argument, for a table of about twenty rows.

Instead `loadPlayerCatalogue` reads `real_teams` whole — one trivial query added to the
`Promise.all` that is already there — and `buildCatalogue` merges it. That function
already builds three `Map`s keyed by `playerId` for totals, values and ownership; a
fourth keyed by `realTeamId` is the established pattern rather than a new one, and
`toRecord` is not touched at all.

`loadPlayer` is the exception and does a keyed single-row lookup, because one player
needs one club, not twenty.

## Views

**`/players`** — the meta line becomes `clubOrPosition(row) · owner · status`. The search
box's haystack becomes nickname **and** club name, so typing `Betis` lists the club's
players. Two honest consequences to state rather than hide: a club with no name is not
searchable, and a search for a club name matches nothing on the day of deploy until the
first sweep runs.

`filterCatalogue`'s doc comment currently cites Step 3's Ruling 1 to explain why the
haystack is the nickname alone. That comment becomes false with this change and is
rewritten — a stale claim in a comment is exactly what this project tracks.

**`/players/{id}`** — the header's 13px wrapping meta line becomes
`position · club · owner · status`, with the club omitted entirely when unknown. No
placeholder, no raw id.

**`/admin/sync`** — the sweep's trigger message reports how many clubs are known, e.g.
`Swept 836 players and 13 squads, 20 clubs named.` This is not decoration: Ruling 1
accepts that coverage may be incomplete, and this counter is the only place that gap is
visible without opening the database. It also goes in the route's JSON response
alongside the existing counts.

`realTeamsKnown` is defined precisely as **the number of rows in `real_teams` after the
sweep**, not the number of distinct clubs this particular sweep happened to observe. The
two differ whenever a club was learned earlier and not seen today, and the accumulated
total is the one that answers the question actually being asked — *how many clubs can the
catalogue name?* — because that is the table the views resolve against. It costs one
`count()` on a twenty-row table.

## Error handling

| Case | Behaviour |
|---|---|
| `team` absent from an entry | The club is not learned this sweep. Never throws — the field is optional in the schema for exactly this reason |
| A squad response fails to parse | Unchanged: it still fails the sweep. Not weakened by this slice |
| A club id observed with a new name | The upsert overwrites; the latest observation wins |
| A player whose club has no row | Catalogue falls back to the position (Ruling 5); detail page omits it |
| First sweep after deploy | No club known until `replaceSquads` runs; every view degrades to today's behaviour, not to an error |

## Testing

Client and schema:

- `playerMaster.team` parses from the committed `squad.json`, and `getSquad` returns its
  clubs deduplicated — 15 entries yield 10 distinct clubs.
- A squad entry with no `team` parses and is simply absent from `realTeams`, rather than
  throwing.
- The existing assertion that no squad entry is silently dropped still holds.

Sweep (PGlite, as Step 3's suite already does):

- Two squads naming the same club write **one** `real_teams` row.
- A second sweep updates `name` and `lastSeenAt` and leaves `firstSeenAt` alone.
- A sweep whose squads carry no `team` at all completes, against an empty `real_teams`,
  and reports `realTeamsKnown: 0`.
- A sweep that observes **no** clubs but runs after one that learned three still reports
  `realTeamsKnown: 3` — this is what pins the accumulated-total definition above, and it
  is the assertion that would fail if someone later "simplified" it to a per-sweep count.
- A club observed only in a squad that the empty-squad guard **skips** is still learned.
- The `21` → `Deportivo Alavés` mapping resolves end to end, from the fixture to a
  `CatalogueRow.clubName`.

`fakeClient(rows, squads)` currently takes `Record<string, string[]>`. It gains an
optional third argument mapping a team id to its clubs, so existing call sites are
untouched.

Domain:

- `buildCatalogue` fills `clubName` from the club map and leaves it `null` for an
  unmapped `realTeamId`.
- `filterCatalogue` matches on club name, case-insensitively, and a player with a null
  club is not matched by a club query.
- `clubOrPosition` returns the club when present and the position when not.

Views: `clubOrPosition` is a plain exported function precisely so the meta line's rule is
provable without a DOM — the same reason `paginateCatalogue` was pulled out of the
component in Step 3, and it matters because `renderToStaticMarkup` cannot drive component
state.

The visual checklist in Step 3's spec gains items: the meta line at 320px with the
longest club name and a non-`ok` status; a row whose club is unknown sitting next to one
whose club is known; and the detail header wrapping with four facts instead of three.

## Rules inherited from Step 3, restated because they still bind

- Every write in a sweep is idempotent. No transactions (Neon HTTP), no `db.batch()`
  (absent on PGlite), plain sequential awaits.
- The anti-corruption layer's raw types stay inside `lib/fantasy-client/`. `RealTeamRow`
  is a mapped type that crosses the boundary; the Zod shape is not.
- Aggregation belongs in Postgres, not in JS, whenever the row count grows with the
  season. `real_teams` is bounded by the size of a competition, which is why reading it
  whole is fine and why that is argued above rather than assumed.
- Store what is measured; derive what is computed. The club name is measured.

## Out of scope

- Rendering badges (Ruling 3).
- A club filter pill or selector. Twelve pills already raise a fold question in Step 3's
  checklist; twenty more would settle it the wrong way.
- A club page listing a squad.
- Backfilling clubs from any source other than an observed squad response (Ruling 1).
- Every other Step 3 follow-up: `lastSeenAt` for departed players, `loanedPlayers`,
  `playersNumber`, per-sweep row counts in `sync_runs`, the duplicate-chain guard, the
  low-sample average marker, and chart render coverage. They stay recorded where they are.

## Practical notes for whoever implements this

- Generate the migration with `drizzle-kit generate` rather than hand-writing it; the
  journal in `drizzle/meta/` must stay consistent, and the existing files carry
  generated names.
- `revalidatePath("/players")` already runs after a manual sweep, so club names appear
  without further cache work. The detail route is not revalidated today and is not made
  to be by this slice.
- `SquadRow.teamId` is the **fantasy** team of a manager; `realTeams` are LaLiga clubs.
  The two live one field apart in the same type and the name collision is real — the type
  gets a comment saying so.
- `players.imageUrl` remains stored and unrendered after this slice. That is unchanged,
  not overlooked.

## Also in this slice: one stale claim to correct

Step 3's spec still states, under "Before the next deploy", that migrations `0003`–`0006`
have never been applied to production. That was true when written and is not any more —
the same document's visual-check section records the checks being run on 2026-09-07
against the deployed build with 836 players and 13 squads swept, which cannot have
happened without them. The paragraph is corrected as part of this work rather than left
to mislead the next reader.

## Follow-ups this slice is expected to leave behind

Written now, before implementation, because they are consequences of decisions already
made rather than discoveries waiting to happen:

- **Club coverage may never reach 20.** Ruling 1 accepts this. `realTeamsKnown` in the
  trigger message is the instrument; if it settles below 20 for several weeks, that is
  the evidence that would reopen the seed-list question with real data behind it.
- **Badges are stored and unseen.** The first slice to introduce images to the portal
  inherits them at no fetch cost.
- **A club filter is the obvious next ask** once names are on screen, and it will land in
  a pill row that already has a fold problem. That is a layout decision, not a data one.
