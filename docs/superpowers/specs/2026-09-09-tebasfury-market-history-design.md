# TebasFury Step 10 — The market, seen three ways

## Context

Asked for three times across 2026-09-08 and 2026-09-09, in three shapes: which teams a
player has passed through, one manager's transfer history, and the market log itself.
They are one capability seen from three angles, and the spec that matters is the one that
stops them becoming three feeds.

`market_operations` holds 426 rows back to 11 August, keyed by `player_id`,
`actor_manager_id` and `counterparty_manager_id`. `MarketFeed` already renders the log and
already computes holding periods from the whole operation list.

## Rulings

### Ruling 1 — one component, narrowed; never three feeds and never three queries

`MarketFeed` gains a `focus` prop: a player, a manager, or nothing. `/market` passes
nothing and is unchanged. `/players/[id]` passes the player. `/teams/[id]` passes the
manager.

### Ruling 2 — the focus narrows what is DRAWN, never what is computed

**This is the whole reason the capability is specified rather than just built.**

A sale's holding period is measured against the purchase that started it, and that
purchase may be weeks earlier and — for a per-manager view — attached to a different row
than the sale. If a caller filtered the operations before handing them over, the feed
would find no purchase, fall back to "held since before this log began", and report a
broken five-day rule as unknowable. It would look like caution. It would be a false
negative on the one rule the league actually enforces.

So every caller passes the **whole** list and the component filters afterwards. The
component's docstring says so, and a test proves it: a sale is drawn with its breach
intact while the purchase that dates it sits outside the focus.

### Ruling 3 — a manager's history includes what was taken from them

The per-manager filter matches `actorManagerId` **or** `counterpartyManagerId`. A player
lost to a clause is part of that manager's story, and arguably the part they would most
want to point at. Matching only the actor would quietly drop it.

This does not disturb the fair-play arithmetic, which is unchanged: `holdings()` still
ends a holding only at a voluntary sale, so being raided still never counts against the
manager who was raided.

### Ruling 4 — an empty focused feed says something different from an empty market

"No market movements yet" is true of a portal that has never swept. On a player nobody
has traded it would be a lie about the market rather than about the player. The focused
empty state names the log's reach instead, which is the actual reason a player has no
rows.

## Architecture

- `MarketFeed` gains `focus?: MarketFocus` — `{ playerId }` | `{ managerId }` | `null`.
- `MarketData` gains `managerIdByTeamId`. The market keys everything by the API's
  `managerId`; every page that links to a manager holds `teams.id`. The translation is a
  column on a query already being run, not a new one.
- Both pages call the existing `loadMarket(db)`.

## Testing

Covered: each focus drawing only its own rows; a manager's raided player appearing;
**a holding still dated from a purchase outside the focus**; the focused empty state.

## Known cost, accepted for now

`/players/[id]` and `/teams/[id]` now read the whole market — 426 operations and 840
player names today, a few thousand operations by May. Ruling 2 forces the operation list
to be whole, so that part is inherent; the name maps are not, and could be narrowed to
the drawn rows if these pages ever feel slow. Not done now, because a second read path
would be a second thing to keep correct for a page that is fast today.

## Out of scope

- The squad view on `/teams/[id]` — what a manager currently holds. Named as a follow-up
  since the metrics slice, and still unbuilt: it reads `squad_members`, not the market log.
