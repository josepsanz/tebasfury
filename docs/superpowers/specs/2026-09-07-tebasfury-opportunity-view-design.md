# TebasFury Step 5 — The opportunity view

## Context

Step 3 shipped the players catalogue and deliberately shipped **no** opportunity view.
Its spec says why, under "Why ownership is in, and the opportunity view is out": the
owner named three things "opportunity" might mean — players rising in value, points per
million, and unowned players scoring well — and rather than guess, the slice **built the
data all three need and none of the views**. The decision was to be made once there was a
real catalogue to look at.

That catalogue now exists and is in production: 840 players, 20 of 20 clubs named,
ownership read from 13 squads, and a value series that began accumulating on 2026-09-07.

**Goal:** the portal answers "who should I sign right now" without making anyone compose
two filters to find out.

## What the calendar settled, before any design question

One of the three lenses is not buildable today, and this is arithmetic rather than
judgement. Market value has no history anywhere in the API — Step 3 established that and
accumulates one dated snapshot per day forward. The first sweep ran on **2026-09-07**, so
the series is one point deep. A rise needs two.

| Lens | Data it needs | Available today |
|---|---|---|
| Points per million | Current value, season points | **Yes** — both stored, `pointsPerMillion` already written |
| Unowned players scoring well | Ownership, season points | **Yes** — 13 squads swept, ownership known |
| Players rising in value | Two or more dated snapshots | **No** — one snapshot exists |

So the three-way question Step 3 deferred is, in September, a two-way one. Ruling 1
records what happens to the third.

A second finding shapes the slice's value more than any of this. **"Unowned players
scoring well" is already achievable on the existing catalogue** — press "Free", then
"Highest scoring". Nothing is being computed here that the portal cannot already reach.
What the portal cannot do is *lead you to the answer*, and points per million it cannot
compute at all. The deliverable is curation and one new metric, not new arithmetic.

## Decisions

| Decision | Value |
|---|---|
| Lenses built now | Points per million, and free-and-scoring |
| Players rising in value | Deferred until the series is deep enough — see Ruling 1 |
| Where the board lives | The home page `/` — see Ruling 2 |
| Shape | Two short stacked blocks, five rows each — see Ruling 3 |
| Low-sample players | Excluded by the existing three-gameweek floor — see Ruling 4 |
| Unavailable players (injured, suspended, out) | **Shown, with their status** — see Ruling 5 |
| "Free agent" before any squad is read | Never claimed — see Ruling 6 |
| New database read | **None** — the catalogue read is reused, see Ruling 7 |
| "See all" links | Deep links; the catalogue gains the metric as a sort — see Ruling 8 |
| URL as a mirror of catalogue state | **No** — entry point only, see Ruling 8 |
| New route, new nav link | **No** |

## Rulings

### Ruling 1 — two lenses now, the third when the data exists

Points per million and free-and-scoring are built. Rising-in-value is not, because one
snapshot cannot describe a rise, and no amount of design makes it appear sooner.

It is deferred rather than dropped: `valueSeries` and the `player_value_snapshots` table
already carry everything a third block would need, and Step 3's decision to accumulate
forward is what makes the wait finite rather than permanent. A few weeks of daily sweeps
make it buildable. The follow-up at the end of this document says where it would go.

This is the same shape as Step 3's own honesty about the value chart: the data is thin at
the start of the season, and the view says so rather than inventing a trend.

### Ruling 2 — the board lives on the home page

`/` is a title and a tagline today and nothing else. It is also the first thing a signed-in
member of the league sees. "Who should I sign right now" is the best content that page
could carry, and putting it there costs **no** new navigation link.

The two alternatives both cost something real. A new `/opportunities` route needs a sixth
nav link, and `AppNav` is a flat flex row that Step 3's visual check 16 already flagged as
tight at 375px with five. Folding the lenses into `/players` as two more sort keys adds
nothing a reader could not already reach and curates nothing — the whole point is not
having to know what to combine.

The home page keeps rendering for signed-out visitors exactly as it does today: title,
tagline, and a nav offering "Sign in". This slice uses `getSession()` and renders the
blocks conditionally, the same pattern `AppNav` already uses. It does **not** use
`requireSession()`, which would redirect anonymous visitors to `/login` — a behaviour
change nobody asked for.

### Ruling 3 — two short blocks, not tabs and not one merged ranking

Five rows per block, both visible without a click. A landing page's job is to say
something at a glance; a tab strip puts half of what it has to say behind an interaction.

The merged single ranking was rejected for a specific reason worth recording, because it
is the option that reads best in a mockup. Merging "cheap for its points" with "nobody
owns them" requires a weighting between the two that nobody has argued for, and it puts
two units in one column: a row ranked on points per million and a row ranked on points
print different quantities in the same place. Two blocks with one unit each make a
weaker claim, and it is a claim the data supports.

### Ruling 4 — the three-gameweek floor is reused, and the constant is renamed

A player with one recorded gameweek, twelve lucky points and a value of €1.0M scores 12.0
points per million and tops the board over a player with thirty points across three weeks
at €3.0M. This is the same trap Step 3 fixed once for "Best average" (its Important 7),
where the answer was a floor of three recorded gameweeks.

The same floor governs this metric, for the same reason and with the same number. One
argued threshold in the project beats two, and a second number on the same question would
need data nobody has.

`MIN_GAMEWEEKS_FOR_AVERAGE_SORT` is therefore renamed to `MIN_GAMEWEEKS_FOR_RANKING`. It
is named after one sort today and governs two rankings after this slice; its doc comment,
which already argues why three, is widened to say so.

One difference from the catalogue is deliberate. There, a low-sample row **sinks**; here
it is **filtered out**. In a five-row board sinking is indistinguishable from hiding, and
a board padded to five with rows showing a dash is worse than a board that is honestly
short. Filtering is also what makes the empty state below meaningful.

To be unambiguous for whoever implements it: the new `perMillion` **sort key** behaves
exactly like the `average` one — it sinks unqualified rows and hides nobody, so a reader
arriving from the deep link still sees all 840 players. Only `bestValueForMoney` filters.

### Ruling 5 — an unavailable player stays on the board, with their status

An injured or suspended player who ranks high is shown, ranked on merit, with their status
label beside their club — the same `statusLabel` vocabulary the catalogue and the player
page already use.

**This is the owner's call, made against the alternative of excluding them.** The
recommendation on the table was to exclude non-`ok` players and say so, on the grounds
that a board which recommends signings should only list signings you could make today.
The owner chose consistency with the catalogue and no hidden rows.

The accepted cost, recorded so it is not later mistaken for an oversight: of five slots,
one or two can be occupied by a player nobody can sign this week, and the top slot — the
one people actually read — is not guaranteed to be actionable. The mitigation is that the
status is never silent; it sits on the row in `--board-alert`, exactly as it does
everywhere else in the portal.

### Ruling 6 — "free" is only sayable once a squad has been read

Inherited from Step 3 and restated because this slice is the easiest place in the portal
to break it. An absent owner row means "nobody owns them" only after at least one squad
response has been recorded; before that it means "we have not looked", and the two must
never render the same way.

So the free-and-scoring block does not render a list when `ownershipKnown` is false. It
renders one line saying no squad has been read yet. This is the same distinction
`ownerDisplay` already encodes as `free` versus `unknown`.

### Ruling 7 — no new read, and the board is a server component

The home page calls `loadPlayerCatalogue(db)` and `buildCatalogue(...)` — the same two
calls `/players` makes — and derives both blocks in the domain. No new SQL.

The alternative, two small queries with the ranking and a `LIMIT` in Postgres, is far
leaner per request and was rejected because it would duplicate the aggregation
`loadPlayerCatalogue` already encodes (the season-points sum, the `DISTINCT ON` newest
value, the ownership join) and would put the points-per-million rule in SQL *and* in the
domain. Step 3's "store what is measured, derive what is computed" exists to stop exactly
that: two places that can disagree, where one of them is the harder to test.

The cost is named rather than left implicit: **840 players and their aggregates are read
to render ten rows**, on the portal's most-visited page. Two things make that acceptable
today. It is the identical query `/players` already runs, indexed and proven in
production. And the board carries no interactivity — no search, no pills, no pagination —
so it is a plain server component and **nothing crosses to the client**. That is the
deliberate contrast with `/players`, whose whole-catalogue-to-the-browser cost is a
recorded soft spot of Step 3.

If the home page ever becomes slow, the fix is a dedicated read, and this ruling is the
record of what to weigh when that day comes.

### Ruling 8 — the links are deep links; the URL is an entry point, not a mirror

Each block links into the catalogue with its own view already applied:

- `/players?sort=perMillion`
- `/players?ownership=free&sort=points`

The second needs nothing but URL reading — both pills already exist. The first needs the
catalogue to gain points per million as a **sort key and pill**, which is the honest
destination of the link and also gives the metric something the board cannot: crossing it
with a position, so "the best midfielder for my money" becomes askable.

The cost is one more pill in a row that Step 3's visual check 1 already found long enough
to push the first player row below the fold, and the club filter is expected to land there
too. This slice makes that slightly worse and does not fix it; the follow-up says so
plainly.

State is read from the URL and **not written back**. The address is how you arrive at a
view, not a mirror of every pill you press afterwards. Making it a mirror means keeping
router state and component state in sync in a component that today has no such coupling,
which is a bigger change than the affordance justifies.

## Architecture

### The board is a composition, not new machinery

The two rankings are expressed with functions the domain already has, plus the one new
sort key:

```
bestValueForMoney(rows, limit)
  = rows filtered to (pointsPerMillion !== null AND gameweeksRecorded >= MIN_GAMEWEEKS_FOR_RANKING)
  |> sortCatalogue("perMillion")
  |> slice(0, limit)

freeAndScoring(rows, limit)
  = filterCatalogue(rows, { query: "", position: null, ownership: "free" })
  |> sortCatalogue("points")
  |> slice(0, limit)
```

Both inherit two behaviours that are already argued and tested: an unknown quantity sinks
rather than counting as zero, and ties break by name — which is what makes the tests
deterministic.

`freeAndScoring` does not take `ownershipKnown`. It stays pure and single-purpose; the
page decides whether to render a list or Ruling 6's line.

The limit is one exported constant, `BOARD_ROWS = 5`, beside the functions that take it —
not a `5` written into two components. Five is a landing page's worth of rows, not a
measured figure, and a named constant is what makes it cheap to disagree with later.

### Modules

| Module | Change |
|---|---|
| `src/lib/domain/players.ts` | Rename the constant; add the `perMillion` sort key; add `bestValueForMoney`, `freeAndScoring`, `parseCatalogueEntry` |
| `src/app/page.tsx` | Becomes a server component that reads the catalogue and renders both blocks when signed in |
| `src/components/opportunity-board.tsx` | New. A server component: one block, its heading, its honest empty state, its rows, its link |
| `src/components/player-catalogue.tsx` | One entry in `SORTS`; optional `initialSort` and `initialOwnership` props |
| `src/app/(portal)/players/page.tsx` | Awaits `searchParams`, passes the parsed entry state down |

Nothing is added to `src/lib/db/queries.ts`, and that absence is the signal that Ruling 7
picked the cheap option.

### `parseCatalogueEntry`

URL parameters are strings, arrays of strings or absent, and none of those is a `SortKey`.
A pure function in the domain maps them to `{ sort, ownership }`, with anything unknown,
missing or repeated falling back to the catalogue's current defaults (`value`, `all`).
Pure, so it is tested without a browser or a router. No Zod: in this project Zod lives
inside `lib/fantasy-client/`, and a guard over two small enumerations does not need it.

`searchParams` is a `Promise` in Next 16.3.4 and must be awaited — verified in
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`, not
assumed from an older API.

## Views

### `/` — signed in

```
TebasFury
Management portal for our private LaLiga Fantasy league.

Best value for money
Points per million of market value. Players with at least three
recorded gameweeks, the same floor the catalogue's "Best average" uses.

  A. Ferran                                              7.4
  Celta · Manager B                             pts/M€ · 3.2M
  J. Iriarte                                             6.6
  Deportivo Alavés · Injured · Manager D        pts/M€ · 4.1M
  …

  All 840 by value for money →

Free and scoring
Nobody in the league owns them. Ranked by season points.

  M. Costa                                                11
  Real Betis                                        pts · 1.8M
  …

  All free agents →
```

The counts in the sketch above come from the data — the link says how many players the
catalogue holds, and it is not a literal to hard-code. Each row reuses the portal's
existing vocabulary and adds none: `clubOrPosition` for the
club, `statusLabel` for a non-`ok` status, `ownerDisplay` for the owner, `formatMoney` for
the value. The numeral sits right, tabular, with its unit beneath — the same treatment the
catalogue gives value and points.

### The three states that must not lie

| State | What renders |
|---|---|
| No player has three recorded gameweeks | The first block's heading, then one line: no player has three recorded gameweeks yet, and this fills in as the season goes |
| `ownershipKnown` is false | The second block's heading, then one line: no squad has been read yet, so nobody can be called free |
| Signed out | Neither block. Title and tagline, exactly as today |

The first state is **reachable today, not hypothetical**: how many gameweeks a player has
recorded depends on what Step 3's `weekPoints` backfill reached, and that window is itself
an open question (Step 3's "four-entry ceiling" watch item).

## Error handling

Nothing new. The home page performs one read that `/players` already performs; a database
failure there fails the page the same way it fails the catalogue, and this slice adds no
network call, no external dependency and no write.

An empty catalogue — before the first sweep — is not an error. Both blocks render their
honest lines, and Ruling 6's line is what the free block shows.

## Testing

Pure domain, no database:

- The `perMillion` sort key: a one-gameweek player is demoted; a player with no value
  snapshot sinks rather than sorting as zero; ties break by name.
- `bestValueForMoney`: the three-gameweek floor filters rather than sinks; fewer than five
  qualified rows yield a short list, not a padded one; no qualified rows yield an empty
  one.
- `freeAndScoring`: only unowned rows, ordered by points; an owned high scorer is absent.
- `parseCatalogueEntry`: absent, unknown, and repeated parameters all fall back.

Component, through `renderToStaticMarkup`:

- Five rows at most per block.
- A non-`ok` status renders its label (Ruling 5's cost is visible in a test, not just in
  prose).
- Each honest state renders its line and no list.
- `/players` with `initialSort: "perMillion"` starts with that pill active.

Nothing is added to `queries.test.ts`: there is no new read to cover.

## Out of scope

- **Players rising in value.** Ruling 1. Deferred with a reason and a date-shaped
  condition, not dropped.
- **A club filter.** Still the obvious next ask, still landing in the same crowded pill
  row, still out.
- **Fixing the pill row's fold.** This slice adds the thirteenth pill and says so.
- **Writing catalogue state back to the URL.** Ruling 8.
- **Pagination or "show more" on the board.** The blocks are five rows; the catalogue is
  where you go for more, which is what the links are for.
- **Fair play, scheduled operations, polls.** Steps of their own.

## Practical notes for whoever implements this

- The constant rename touches three places, one of which is a comment in
  `src/lib/domain/players.test.ts`. Grep for it rather than trusting this list.
- `PlayerCatalogue`'s two new props must be **optional**, or every existing test of that
  component stops compiling.
- Vitest does not typecheck. Run `npx tsc --noEmit` before committing a task that widens a
  shared type — a green suite hid five such errors during Step 4.
- The board's rows are close enough to the catalogue's to invite sharing a component.
  Resist it for now: the catalogue row is a `<Link>` inside a client component with
  pagination, and the board's is a server-rendered row with a different right-hand unit.
  Sharing them would couple a server component to a client one for the sake of a `<span>`.
- The three-state owner label **was** extracted, to `src/components/owner-label.tsx`, and
  is imported by both `player-catalogue.tsx` and `opportunity-board.tsx`. The reason is the
  drift that `ownerDisplay`'s own doc comment says it exists to prevent: change "Owners not
  swept yet" in one file and the portal says two different things. It needed no `"use client"`
  directive — it holds no state, and the build's client-reference manifests confirmed it
  stays out of the home page's client bundle while being inlined into the catalogue's. The
  advice against sharing the *row* is unaffected; the reason is the row's shape, not a rule
  against sharing at the component level.

## Follow-ups this slice is expected to leave behind

Written before implementation, because they follow from decisions already made:

- **The pill row is now thirteen pills**, and the club filter still wants to land there.
  Step 3's visual check 1 already asked whether twelve push the first row below the fold.
  The next slice to touch that row should treat the row itself, not add to it.
- **Rising-in-value becomes buildable in a few weeks.** When it does, it is a third block
  on this page and a fourth sort key, and it will need its own floor — a rise measured
  across two days is the same trap as an average over one gameweek, wearing different
  clothes.
- **The home page is now the portal's most expensive page to render.** Ruling 7 accepts
  840 rows for ten. If the landing page ever feels slow, a dedicated read with the ranking
  in SQL is the answer, and the price is the duplicated aggregation that ruling describes.
- **Points per million is unvalidated as a signal.** It is arithmetic the API supports, but
  whether it actually identifies good signings in this league is a question only a season
  of use can answer. If it turns out to rank thin-sample cheap players all year, the floor
  is the dial to turn, and it has a name.
## The visual checks — not yet performed

On `/`:

21. The two boards on a 320px screen: does the right-hand figure keep its unit
    un-wrapped when a row carries a long club name, an "Out of the league" status and
    an owner all at once?
22. Are the two boards distinguishable at a glance, given they share a row shape and
    differ only in heading and unit? A reader must never think the second board is
    more of the first.
23. The signed-out page: unchanged from before this slice, with no flash of the boards
    during hydration.
24. A board rendering its empty note beside a board rendering rows — do the two read as
    one page, or does the empty one look broken?

On `/players`:

25. Thirteen pills. Step 3's check 1 asked whether twelve pushed the first player row
    below the fold; this slice adds one and does not fix the row.
26. Arriving from a home-page link: is it obvious which pill the URL selected, or does
    the page look like it opened on the wrong view?
