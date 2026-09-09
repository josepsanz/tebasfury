# TebasFury Step 9 — One round's table

## Context

`/standings` shows the season's cumulative total per manager. The owner asked for the
other view of the same data: **the points scored in one chosen round**, ranked.

No sync and no schema change. `team_gameweek_stats` already holds `points` per team per
gameweek and `roundPosition`, the rank within that round.

## What the data settled, before any of it was designed

Two questions were left open when this was first recorded. One of them turned out to have
an answer in the database rather than in anybody's preference, and measuring it changed
the design.

**Does the stored `roundPosition` agree with a rank derived from that round's points?**
Measured on 2026-09-09 across all 52 rows: **seven disagreements, and every one of them
is a tie.** Three of the four rounds played so far contain tied scores — seven tied pairs
in total, so this is common, not a corner case.

The pattern is exact. Where two teams score the same, SQL's `rank()` gives them the same
position and skips the next; the API gives them **distinct sequential positions**, 5 and
6, by some tie-break it does not publish. So:

- Deriving the rank ourselves would **contradict the API's own answer in every tied
  round** — and the league will compare this table against the app they already use.
- Deriving would also mean inventing a tie-break we do not have.

That is decisive, and it inverts what "derive it, one rule for every week" would have
given us.

## Rulings

### Ruling 1 — the stored position wins wherever it exists

`roundPosition` is used as recorded. It is complete for every finished round: all 13
teams in all four rounds have one.

### Ruling 2 — a live round is the only place we rank anything ourselves, and ties share a place

`roundPosition` is null for a week observed live, because a live response reports the
overall table position instead of a rank within the round. That is the one case where the
table has to derive.

There, tied teams **share a place** — two on 5, and nobody on 6. This is the honest
statement: we cannot tell them apart, and the API's tie-break is not ours to guess. It
differs from how a finished round reads, which is why a derived round is labelled.

### Ruling 3 — a derived round says so, in the table and not only in a tooltip

A round whose places we worked out ourselves carries the word `provisional` in the header.
A reader comparing this against the official app during a live round has to be able to see
why the two might differ, without hovering anything.

### Ruling 4 — the round lives in the URL, and the season stays the default

`/standings` is unchanged: the cumulative table, as today. `/standings?round=3` is one
round. Nothing about the default view moves, because the cumulative table is what the
league opens the page for.

Putting the choice in the URL rather than in component state keeps the page a server
component, makes a round linkable — "look at round 3" in the group chat is a link — and
lets the back button work. A `round` that is not a number, or names a round with no rows,
falls back to the season table rather than erroring: a hand-edited URL is not an
exceptional condition worth a 404.

### Ruling 5 — a separate table component, not a mode flag on the existing one

`StandingsTable` shows movement between rounds, three-week form bars, and a live column.
A round's table has none of those: there is no "up from 3rd" within a single round, and
form is a sequence the round does not contain. Threading a mode through it would put four
conditionals in a component that currently has one.

The round table is its own component in the same visual language — the same grid, the same
amber "you", the same manager link.

### Ruling 6 — the picker is a select, because a season is 38 rounds

Not a row of pills. Thirty-eight of them is the wall the catalogue was redesigned to stop
being, and it has to work at 320px, where a select is one control and a pill row is a
horizontal scroll a reader has to discover.

## Architecture

- **`src/lib/domain/standings.ts`** gains `buildRoundTable(snapshots, teams, gameweek)`
  returning `RoundRow[]` — `teamId`, `managerName`, `position`, `points`, and
  `positionDerived`. Pure, like everything else in the module.
- **`src/components/round-table.tsx`** — the view.
- **`src/components/round-picker.tsx`** — a client component; a `<select>` that navigates.
- **`/standings`** reads `searchParams.round` and branches.

## Testing

- `buildRoundTable`: the stored position preferred; a live round derived; ties sharing a
  place when derived; a team with no row for that round; an unknown round returning empty;
  ordering stable regardless of the caller's array order (the module's existing habit).
- `RoundTable`: renders the round's points, marks "you", labels a derived round.
- The page: `?round=3` shows the round, no parameter shows the season, and rubbish falls
  back to the season.

## Out of scope

- Charting a round. `/progress` already draws points per week for the whole season.
- Changing the cumulative table in any way.
