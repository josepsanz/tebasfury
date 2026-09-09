# TebasFury Step 12 — The best lineup

## Context

Given the league's seven legal formations, which one does a manager's squad score most
with, and who plays? Asked on 2026-09-09.

The formations, as the owner states them — the goalkeeper is omitted because it is always
exactly one:

`5-4-1`, `5-3-2`, `4-5-1`, `4-4-2`, `4-3-3`, `3-5-2`, `3-4-3`

Every one is ten outfield players plus a keeper, so **their totals are directly
comparable**: choosing between them is choosing between two elevens, not between a bigger
and a smaller team.

## What the data settled before anything was designed

Three measurements changed this design. All were taken against production on 2026-09-09.

### It is not really a linear programming problem

It can be written as one, and the owner reasonably framed it that way. But every player
holds exactly one position and the constraints are "take exactly N from each line", so the
constraint matrix is **completely separable**: the lines never compete for a player.

The optimum is therefore reached by sorting each line once and taking the top N — a
result, not an approximation. Seven formations become four sorts and twenty-one prefix
sums. **No solver, and no dependency.**

This would stop being true if some constraint coupled the lines — a cap on players from
one real club, say. The league has no such rule today. If one appears, this file is where
the reasoning to revisit lives.

### Most squads cannot field most formations, and some cannot field any

Feasibility across the thirteen squads, counting only available players:

| Formations possible | Managers |
| --- | --- |
| all seven | 1 |
| three to five | 4 |
| exactly one | 4 |
| **none** | **4** |

`La rataneta` is the case that shaped the design: a perfectly ordinary squad of **13
players**, of whom only **1 is an eligible midfielder** — and every formation needs at
least three. "No formation possible" on a squad of thirteen reads as a broken portal. It
has to say *which line is short and by how many*.

So **the diagnosis is this feature's most common output, not the podium.** Eight of
thirteen managers have either one option or none, and for them the ranking's value is
entirely in the reasons. Exactly one manager can choose between all seven.

### The three-gameweek floor is a cure for a disease this data does not have

The catalogue applies `MIN_GAMEWEEKS_FOR_RANKING` so that one brilliant appearance cannot
top an average ranking. The owner asked whether heavy squad rotation makes that worse
here.

It does not, and the premise does not hold: **a player's history follows the player, not
the squad.** `player_gameweek_points` is keyed by player and gameweek and was backfilled
from `weekPoints` on the first sweep, so signing somebody resets nothing. What produces a
thin sample is not being bought, but not playing.

Measured: of 168 squad memberships, **160 have three or more gameweeks**. Of the eight
that do not, one is injured and so excluded anyway; the remaining seven average 4.5, 4.0,
4.0, 1.0, 0.0, 0.0 and one has no appearance at all. There is no hidden outlier for a
floor to protect against — nothing in that group would displace a regular — and it empties
on its own as the season runs.

## Rulings

### Ruling 1 — a page of its own, reached from the squad

`/teams/[id]/lineup`. The owner chose this over a section on the team page, which already
carries metrics, squad, money and market.

No new entry in the nav: it is reached from a link in the team page's squad section, and
its header links back. That matters — `nav-links.tsx` records that the destination row is
already at its width at 375px.

### Ruling 2 — both metrics, in the URL

`?by=points` (default) and `?by=average`. Season total is the plainest reading of "most
points" and cannot be argued with; the average compares players with different numbers of
appearances.

In the URL rather than in component state, for the three reasons the standings' round
picker already banks: the page stays a server component, a lineup is a link somebody can
paste into the group chat, and the back button works. A value that is not one of the two
falls back to `points` rather than erroring — a hand-edited URL is not an exceptional
condition.

`?formation=4-4-2` selects which eleven to show, defaulting to the best. Seven elevens at
once would be seventy-seven rows; one at a time, addressable, is the same information
without the wall.

### Ruling 3 — unavailable players are out, doubtful ones are in and marked

`injured`, `suspended` and `out_of_league` are excluded: an optimiser that fields a
suspended player has given a wrong answer, confidently.

`doubtful` is a judgement rather than a fact, so those players count and carry a mark. The
reader decides.

This is not free, and the cost is stated rather than discovered: applying it drops
`LILTEAM` from one possible formation to none, `Millou912` from seven to five and
`PavelmacuFC` from five to three. That is the honest answer, not a regression.

### Ruling 4 — no floor on the average, but an unknown average sinks

Per the measurement above, no `MIN_GAMEWEEKS_FOR_RANKING` here. A player with fewer than
three gameweeks is **marked** instead, so a reader knows the average rests on little.

The case that does need handling is a player with **zero** recorded gameweeks: they have
no average at all. Null, not zero — and it must sink explicitly rather than arrive at the
bottom by the accident of `0` being a low number. This is `sortCatalogue`'s existing rule:
*an unknown value sinks rather than sorting as zero.*

### Ruling 5 — ties break by name

Within a line, equal metric then alphabetical. Without it two equal players would swap
places between renders and the eleven would appear to change on its own. The same habit
`rankAt`, `buildRoundTable` and `squadByPosition` all keep.

### Ruling 6 — an impossible formation reports a shortfall per line, and names the nearest

Not a boolean. Each impossible formation says how many it is short in each line, and the
page names the formation needing the fewest additions. `La rataneta` should read "closest
is 3-4-3 — one midfielder short", which is a transfer instruction as much as a diagnosis.

## Architecture

| Piece | Holds |
| --- | --- |
| `lib/domain/lineup.ts` | pure: the formations, eligibility, the eleven, the ranking, the shortfall |
| `components/lineup-board.tsx` | the chosen eleven by line, and the ranking beside it |
| `/teams/[id]/lineup` | the page: reads the catalogue, applies the two URL parameters |

No schema change, no migration, no new query: the squad comes from `loadPlayerCatalogue`
filtered by `ownerTeamId`, exactly as `squadByPosition` already does. Ownership is joined
there and it carries the points the optimiser needs, which `squad_members` does not.

### The domain's shape

- `FORMATIONS` — the seven as `{ defenders, midfielders, forwards }`.
- `eligible(rows)` — Ruling 3.
- `rankFormations(rows, metric)` — every formation, feasible ones by total descending,
  impossible ones after, each carrying either its eleven or its per-line shortfall.

`rankFormations` sorts each line **once** and reads prefix sums, per the separability
argument above. A reader should not have to rediscover why that is optimal, so the
docstring says it.

## Error handling

| Situation | What happens |
| --- | --- |
| No formation is possible | The alert, naming the nearest formation and the missing line (Ruling 6). |
| No squad has been read at all | Says so, rather than claiming the manager holds nobody — the distinction `SquadList` already draws from `ownershipKnown`. |
| A team id that matches nothing | 404, as `/teams/[id]` already does. |
| `by` or `formation` is rubbish | Falls back to the default (Ruling 2). |
| A player with no recorded gameweek | Sinks; never sorts as zero (Ruling 4). |

## Testing

Pure domain, which is the bulk: each line taking its top N; the ranking ordered; an
impossible formation reporting a per-line shortfall; the nearest formation named; ties
broken by name; unavailable excluded and doubtful kept; a null average sinking; both
metrics; a squad that can field nothing; and the caller's array left unmutated.

Component: the eleven rendered by line with each player linked, the alert naming the short
line, both marks, and the selector reflecting the URL.

Page: still guarded, and rubbish parameters falling back.

**Unlike `/claim` and the Necroporra, this slice is genuinely covered.** Nothing here
needs a signed-in browser, so it leaves no manual checks behind beyond looking at it.

## Out of scope

- Writing a lineup back to LaLiga. That is roadmap step 5 ("scheduled operations"), it
  needs each manager's own credentials, and it is a decision not yet taken.
- Predicting next round's points. Every metric here is a record of what has happened.
- Any cap coupling the lines, such as a limit per real club. If the league adds one, the
  separability argument above is what has to be revisited — and a solver might then earn
  its place.

## The live check — performed 2026-09-09, matches the design

All four checks ran clean, one at a time as this machine requires (`vitest` and `eslint`
together starve PGlite's workers): `npx tsc --noEmit`, `npx vitest run` (50 files, 655
tests), `npx eslint`, `npx next build`. Nothing to report beyond "clean".

Since this slice has no signed-in-browser surface to walk (see Testing above), the check
that matters is the arithmetic itself, against production rather than through the app. A
throwaway, read-only script queried `squad_members`, `players` and `player_gameweek_points`
directly and re-derived `rankFormations`' own algorithm — sort each line, take a prefix,
sum — independently of the shipped code:

| Formations possible | Managers |
| --- | --- |
| all seven | 1 — `JMjugon` |
| three to five | 4 — `Millou912`, `Villaone` (5); `LamineTheTuareg`, `PavelmacuFC` (3) |
| exactly one | 4 — `La Agustineta 96`, `PlatanosVerdes`, `tete alejo`, `TheMessias` |
| **none** | **4 — `-papi—`, `cristian1206`, `La rataneta`, `LILTEAM`** |

This reproduces the feasibility table above exactly, manager for manager, against live
data rather than the snapshot the design was written from. `La rataneta`'s nearest
formation is `5-3-2`, short two midfielders — one eligible midfielder against every
formation's floor of three, confirming Ruling 6's example. `JMjugon`, the one squad that
can field all seven, scores best on `4-4-2` under the points metric.

Everything the spec predicted held. No domain change followed.
