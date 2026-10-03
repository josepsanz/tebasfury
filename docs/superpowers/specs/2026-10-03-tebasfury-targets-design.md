# Targets: who is worth buying

Design, 2026-10-03.

## What it is for

A page that answers **"which players are worth buying right now?"** through two lenses on
the same set of players:

- **Investment**: buy cheap, sell dear. Driven by how fast a player's value is rising
  relative to what he would cost you today.
- **Performance**: buy to score. Driven by recent points relative to what he would cost
  you today.

It is a **league-wide ranking**, the same for every reader, with one personal touch: **the
reader's own players never appear**. Budgets are out of scope, and they could not be in
scope: the market endpoint returns `teamMoney: null`, so no manager's money is readable.

Each row carries **both a score and the tags that explain it**. A score alone hides why a
player is there, and tags alone give no order to start from.

## Who is a target

A player is a target if he can be bought, now or soon, through one of three routes:

| Route | Who | Cost counted |
|---|---|---|
| **Auction** | A free agent in today's league auction (`marketPlayerLeague`) | Market value (the minimum bid; the winning price is unknowable) |
| **Listed** | A player a manager has put up for sale (`marketPlayerTeam`) | **Market value × 1.10** |
| **Clause** | Any owned player whose clause is not locked | `buyout_clause` |

A free agent who is not in today's auction cannot be bought today and is not a target.

**A listed player who is also clausable costs the cheaper of the two routes.** That is the
route shown on his row, and the one the Route filter matches.

**A clause route is open only when the clause is neither locked nor shielded.** That is
`clauseStatus` in `domain/market.ts`. `isShielded` has no expiry in the API, so a
shielded player is treated like a locked one with an unknown end, shown as "Shielded".

**An owned player whose clause is locked and who is not listed has no open route.** He is
still a target, but he sits in a collapsed "Locked" group at the foot of the page with
"Locked until …", has no score, and is counted rather than ranked. About half the league is
in this state on any given day (77 of 155 squad players on 2026-10-03).

### Why ×1.10 and not the asking price

Settled with the owner on 2026-10-03:

- **The asking price (`salePrice`) on a manager's listing is the game's default**, not a
  price the seller chose. It often sits a few percent under value (C. Soler at 0.948 on
  the probed day), and that is **not a bargain signal**. The page never shows it.
- **The single offer nearly every listing shows (`numberOfOffers: 1`) is the league's
  automatic offer**, not a rival bidder. It is noise and is not stored.
- **The managers' own house rule says a sale between managers needs an offer above market
  value + 10%**, because +10% is the most the league's automatic offer can pay. This is the
  friends' rule, not the app's. The page labels the cost "1.10× (house rule)" so nobody
  mistakes it for something LaLiga enforces.

The multiplier is one constant, `HOUSE_RULE_PREMIUM = 1.10`, pinned by a test.

## The market endpoint, as measured

`GET /v1/competition/1/league/{leagueId}/market` was probed against production on
2026-10-03. Note **`league`, singular**, unlike every other league path the client uses.

It returned 34 entries, discriminated by `discr`:

- **`marketPlayerLeague` (13)**: `playerMaster`, `salePrice` (equal to `marketValue` in
  all 13), `expirationDate`, `status: "on_sale"`, `numberOfBids`. **All 13 expired at the
  same instant**, 19:00 local the next day. That instant is the daily auction close.
- **`marketPlayerTeam` (21)**: `playerMaster`, `playerTeam` (`buyoutClause`,
  `buyoutClauseLockedEndTime`, `isShielded`, `manager`), `sellerTeam`, `salePrice`,
  `numberOfOffers`, `directOffer`, `expirationDate`. Each listing expires at its own
  instant.

`playerMaster.id` is the same id as `players.id`: all 34 probed ids exist in `players`. The clause fields duplicate what
`squad_members` already holds, so they are not stored twice.

## Data

### `market_listings`

This table holds current state and is **replaced wholesale on every successful market
read**, the same pattern as `squad_members`. It is not an event log. Market history is out
of scope.

| Column | Type | Notes |
|---|---|---|
| `player_id` | text, PK, FK `players.id` cascade | One listing per player at a time |
| `kind` | text | `league` or `team` |
| `seller_team_id` | text, nullable | Set only when `kind = 'team'` |
| `expires_at` | timestamptz | From `expirationDate` |
| `bids` | integer, nullable | `numberOfBids`, for `league` only. Listing offers are not stored (see above) |
| `read_at` | timestamptz | When this read happened. Every row carries the same value, and the page's "Market read at" comes from it |

If a listed player is not yet in `players` (he has not been seen by a catalogue sweep), his
row is dropped and counted, the same tolerance the squad sweep shows a dropped squad
player.

### Value growth

Growth is read from `player_value_snapshots`, which holds one row per player per day and
starts on 2026-09-07. `growth7` is `value(today) / value(today − 7 days) − 1`, and
`growth14` is the same over fourteen days. **A player with no snapshot on the comparison
day has no growth figure.** That is `null`, never zero, and he gets no Investment score.
The comparison uses the exact calendar day, with no "nearest earlier snapshot" fallback,
because a stale baseline would invent momentum.

### Form

`form` is the mean of a player's points over **the last 3 gameweeks in which he has a
`player_gameweek_points` row**. That is the same three-round cut the per-manager metrics
use. A player with fewer than three such rows has `form: null` and no Performance score.

## Reading the market

### The client

`getMarket(accessToken, leagueId)` is added to `src/lib/fantasy-client`. It has a zod
schema, a discriminated union on `discr`, and returns
`{ kind, playerId, sellerTeamId, expiresAt, bids }[]`. Its fixture is captured by a
`scripts/capture-market-fixture.mts` in the style of the other capture scripts, trimmed to
one entry of each `discr`.

Running TypeScript scripts needs `node --experimental-transform-types --import
./scripts/register-alias.mjs …`. `errors.ts` uses parameter properties, which Node's
default strip-only mode rejects. The capture scripts' doc comments say otherwise and are
updated to match.

### In the sweep

The player sweep reads the market once per run, after the squads. **A failed market read
does not fail the sweep**: it is noted in the run's result and the previous
`market_listings` stays in place, the same tolerance `captureLineups` gets. The page's
staleness rule (below) is what keeps an old read from misleading anyone.

### When the sweep runs

Today the sweep books its successor a flat 6 hours ahead, so its hour drifts and never
reliably lands just after the auction closes. The new rule:

> **next run = the earlier of `now + 6 h` and `auction close + 30 min`**, where *auction
> close* is the soonest `expires_at` among `kind = 'league'` listings that is still in the
> future at `now + 30 min`.

The close is **read from the data, not hard-coded at 19:00**. If the league closes at
another hour, the chain follows it. With no league listings, the rule falls back to the
flat 6 hours.

### The chain must not kill itself

**This is the part that can fail silently, and the spec fixes it explicitly.**
`isRedundantSweep` stands a firing down, booking no successor, when any sweep succeeded in
the last 5 hours (`SWEEP_COLLAPSE_WINDOW_MS`). That is safe only while every booking is 6
hours out. A booking for close + 30 min can land 30 minutes after the previous sweep, and
the window would then end the only chain there is.

The fix: **each booking names the run that made it.** `publish` sends
`{ trigger, bookedBy: runId }` (the run id it already receives for the deduplication id).
A firing is redundant **only if a sweep succeeded inside the window AND that sweep is not
the one that booked this firing**. In other words, it stands down only when another chain
has already done the work.

- Duplicate chains still collapse. The older chain's message finds the newer chain's run
  as the latest success, and that run did not book it.
- The surviving chain's own successor is never suppressed, however soon it is booked.
- A message published before this deploy carries no `bookedBy` and keeps today's rule.

`sync_runs.id` **is** that `runId`: `runPlayerSweep` inserts its row with `id: runId`,
checked 2026-10-03. So `loadLastPlayerSweep` only has to return the id alongside
`finished_at` for the comparison with `bookedBy`. A test books a successor at close + 30 min, 30 minutes after a success, and
asserts that it is **not** redundant. A second test asserts that a foreign chain's firing
inside the window still is.

## The calculation

All of this lives in `src/lib/domain/targets.ts`. It is pure, with no database, and every
threshold is a named constant.

**Cost:** the cheapest open route from the table above, or `null` when no route is open.
An auction listing whose `expires_at` has passed is **not** an open route (see staleness).

**Cost multiple:** `cost / value`, shown as "1.00×", "1.10×", "1.37×".

**Investment score:** `value × (1 + growth7) / cost − 1`, as a percentage. It reads "if the
last seven days repeat, what would you make on what you paid?" It folds the route in, so a
+20% riser bought at 1.10× ranks below a +12% riser bought at 1.00×. It is `null` when
`growth7` or `cost` is `null`.

**Performance score:** `form / (cost in millions)`, as points per million of real cost. It
is `null` when `form` or `cost` is `null`. Season average is shown beside it as context and
is not part of the score.

**Ranking:** descending by the active lens's score. Rows with a `null` score sink to the
end of the ranked list, after every scored row, and keep their tags. The locked group is
separate and is not ranked.

### Tags

Thresholds were set from the live distribution on 2026-10-03 (7-day growth among owned
players: p25 −8.7%, median −1.8%, p75 +8.5%, p90 +18%; clause ÷ value: p10 1.00, p25
1.10, median 1.37).

| Tag | Condition | Kind |
|---|---|---|
| Rising fast | `growth7 ≥ 0.18` | positive |
| Steady climb | `growth7 > 0` and `growth14 > 0` | positive |
| Falling | `growth7 ≤ −0.09` | warning |
| Cheap clause | route is Clause and `clause ≤ 1.10 × value` | positive |
| Takeable in 24h | locked, and the lock ends within 24 h | info |
| In form | `form ≥ season average + 2` | positive |
| No bids yet | route is Auction and `bids = 0` | info |
| Injured / Doubtful / Suspended | `players.status` is one of these | warning |

"Takeable in 24h" is the same concept and the same word as the `/players` filter, and it
reuses `clauseStatus` from `domain/market.ts` rather than re-deriving the lock.

## The page

`/targets`, labelled **"Targets"** in `nav-links.tsx`.

**One table with a lens switch**, layout A from the 2026-10-03 mockups:

- **Controls:** a lens switch (Investment, the default, or Performance), Route (All /
  Auction / Listed / Clause), Position, and "Show injured" (off by default: injured and
  suspended players are hidden, doubtful players are shown with their tag). All of them
  live in the query string and are written through `urlWithParam`
  (`components/picker-url.ts`), so no control drops another's parameter.
- **Header line:** "Market read HH:MM · auction closes <day> HH:MM".
- **Each row:** rank; player name linking to `/players/[id]`; position and owner (or
  "Free"); tags; route badge and cost with its multiple; 7-day growth; the active lens's
  score.
- **Foot:** "Locked — no route open (N)", collapsed, expanding to the locked players with
  "Locked until …".
- **The reader's own players are excluded.** If the reader has not claimed a team, nobody
  is excluded.

**Staleness.** If `read_at` is more than 24 hours old, the header says so in alert colour,
and auction listings whose `expires_at` has passed stop counting as an open route.
Listed and clause routes stay, but are marked as read at that time. With no read at all,
the page says the market has not been read yet and ranks clause routes only.

Every visible string is English, following the project's rule.

## Testing

- **`domain/targets.ts`:** each formula; each tag at, just inside and just outside its
  threshold; cheaper-route selection for a listed and clausable player; `null` growth and
  `null` form; expired auction routes; ranking with `null` scores.
- **`getMarket` schema:** parses the captured fixture. One fixture entry of each `discr`
  maps to the expected row.
- **Scheduling:** `nextPlayerSweep` picks close + 30 min when it is sooner than 6 h, and 6 h
  otherwise; the two redundancy tests above.
- **The sweep:** a market read failure leaves the previous `market_listings` intact and the
  sweep succeeds.
- **The page:** `/targets` is added to `src/app/portal-pages.test.tsx`, with
  `seed-league.ts` extended with a few market listings. It asserts that the reader's own
  players are absent and the locked group is counted.
- Then `npx tsc --noEmit` and `next build`, since green tests are not a typecheck here.

## Out of scope

- Budgets and affordability. They cannot be read from the API.
- Market history. `market_listings` is current state only.
- Projections beyond one week, and any statistical model.
- The asking price of manager listings, and any "below value" signal.
- Alerts or notifications.
- Writing the +10% house rule into `/constitution`. It is a separate, small change if
  wanted.
