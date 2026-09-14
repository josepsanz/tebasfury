# What each manager actually fielded

Design, 2026-09-14.

## The problem

The portal can say what a squad is worth, what it could field at its best, and what every
player scored. It cannot say the one thing the league argues about on a Monday: **what
each manager actually put out**, and how many points they left in the wrong places.

## What the API gives, measured

Two endpoints, handed over from the official app's network tab after twenty guessed paths
found nothing. Both are **competition-scoped**, which is why every guess under
`/leagues/{league}/…` had failed:

| Request | Answer |
| --- | --- |
| `GET /v1/competition/1/teams/{teamId}/lineup` | **403 Forbidden**, for every team tried |
| `GET /v1/competition/1/teams/{teamId}/lineup/week/{week}` | **200**, for all thirteen teams, weeks 1–6 |

A response is:

```
{ formation: { goalkeeper[], defender[], midfield[], striker[], tacticalFormation },
  id, teamValue, points, initialPoints, teamSnapshotTookOn }
```

- `tacticalFormation` is an **array of the outfield line sizes** — `[5, 3, 2]` — and the
  four arrays hold the players fielded in each line. **Corrected 2026-09-14**, after the
  captured fixture disagreed with what this document first claimed: the probe that mapped
  this endpoint printed the array interpolated into a template beside a hyphenated string
  the probe itself had built, and the two were read as one. The client turns the array
  into the label the rest of the portal uses, `"1-5-3-2"`, by putting the goalkeeper back
  in front.
- A player is `{ playerMaster, buyoutClause, playerTeamId }`, and `playerMaster` carries
  `id, nickname, positionId, position, marketValue, playerStatus, points, averagePoints,
  images`, plus the two that matter here: **`weekPoints`**, what they scored that round,
  and **`isInIdealFormation`**, whether they made the round's ideal eleven.
- `teamSnapshotTookOn` is when the lineup froze.
- 30–36 KB per team per week, almost all of it a `lastStats` block we do not need.

Measured for week 4 across the league: thirteen answers, thirteen formations, from
`[3,4,3]` to `[5,4,1]`, points from 24 to 71.

## The ruling: the round has to have started

**The unplayed round answers too.** Week 6, before kickoff, returned a rival's intended
eleven with 0 points and that morning's snapshot. The official app refuses the same
question — plain `/lineup` is a 403 — so answering it would make this portal the tool that
hands one manager an advantage over another.

Decided 2026-09-14: **the portal shows a round's lineups only once that round has begun.**
The rule needs no new state to enforce: `runSync` writes a `gameweeks` row when a week is
live or played, so **a week with a row is a week that has started**, and a week without one
is never fetched and never drawn. Week 6 has no row today; it gets one at kickoff.

## The shape of the change

### Data

Two tables, because a lineup is one row and its eleven players are eleven.

**`round_lineups`** — primary key `(team_id, gameweek)`:

| column | |
| --- | --- |
| `team_id` | `text not null references teams(id) on delete cascade` |
| `gameweek` | `integer not null` |
| `formation` | `text not null` — the label `"1-5-3-2"`, built by the client from the API's `[5,3,2]` |
| `points` | `integer not null` — the round's total for that team |
| `snapshot_took_on` | `timestamptz not null` — when the lineup froze |
| `fetched_at` | `timestamptz not null default now()` |

**`round_lineup_players`** — primary key `(team_id, gameweek, player_id)`:

| column | |
| --- | --- |
| `team_id`, `gameweek` | the lineup this belongs to |
| `player_id` | `text not null references players(id)` |
| `line` | `text not null` — `goalkeeper`, `defender`, `midfield`, `striker` |
| `week_points` | `integer not null` |
| `in_ideal` | `boolean not null default false` |

`week_points` is stored rather than joined from `player_gameweek_points`, for the reason
`market_operations` stores what a sale made: it is what was true of that round, and a row
that carries its own figures cannot be rewritten by a later correction elsewhere.

`gameweek` deliberately references nothing, exactly as `necroporra_votes` and
`player_gameweek_points` already do: two cadences that must not be able to fail each other.

### Fetching

**On the player sweep's chain**, every six hours, because that chain already walks all
thirteen teams and this is thirteen more calls beside its thirteen.

- **A settled round is fetched once, ever.** Its lineup is frozen; a stored row is skipped.
- **The live round is refetched every sweep**, because its points climb as matches are
  played.
- **A week with no `gameweeks` row is never asked for**, which is the ruling above and also
  the thing that keeps an unplayed round out of the database entirely.
- The first sweep after this ships backfills every started week — thirteen calls per week,
  once.

A failure to fetch one team's lineup must not fail the sweep: the sweep's job is players
and the market, and a missing lineup costs a page section, not the chain. It is recorded
and skipped.

### The page

A section on **`/teams/[id]`**, under the squad, with the same `RoundPicker` the standings
and the Necroporra already use. It opens on the most recent started round.

For the round being read:

- The **formation** label — `1-5-3-2` — and the round's **points**.
- **The eleven on a pitch, laid out left to right, one column per line**: goalkeeper,
  defenders, midfielders, strikers, each column stacking its players. Asked for on
  2026-09-14, and it is the right shape for the question: a lineup is read as a SHAPE
  before it is read as a list, and `1-5-3-2` means nothing until you can see the five
  standing across.
- Each player shows their nickname, their **`weekPoints`**, and a mark for
  `isInIdealFormation`. The marks are shapes and words, never colour alone — the amber is
  the reader's own team and the green is a gain, and neither means "ideal eleven".
- A line naming when the lineup froze, because a reader comparing two managers needs to
  know they are comparing two frozen things.
- A round with no lineup stored says so plainly rather than drawing an empty pitch.

**The pitch is drawn as furniture, not as a photograph.** Hairlines in `--board-line` on
the panel background — a touchline, a halfway line, a centre circle, a goal box at the
keeper's end — in the same register as `PitchIcon`, which already set that vocabulary. It
is deliberately NOT green: this palette spends green on a gain and amber on the reader's
own team, and a green field would take one of those meanings away for decoration.

**It has to hold at 375px.** Four columns of short nicknames fit at the board's small type
with truncation; the pitch shrinks with the grid and never scrolls sideways. A name that
does not fit is truncated, never wrapped into a second line that would push its column out
of line with the others.

**This does not reuse `LineupBoard`.** That component draws the best eleven a squad could
field: it is built on `RankedFormation`, carries a formation ranking and a shortfall
diagnosis, and knows nothing of round points or an ideal eleven. This one knows nothing of
ranking or shortfalls. Sharing a pitch between them would mean a third abstraction serving
two callers whose only common ground is four rows of names — worth doing when a third
caller appears, and not before.

## Testing

- **Domain**: parsing one API response into a lineup and its eleven — the four lines in
  order, the formation string, the ideal marks. Pure, against a captured fixture.
- **Integration (PGlite)**: the upsert, a settled round skipped and a live one refetched,
  and a fetch failure that leaves the sweep's own work intact.
- **Component**: the four lines drawn in order, the ideal mark present, the empty state.
- **The walk**: the signed-in path has no end-to-end net, so the round picker and the
  section get walked by hand, as every slice here does.

## Out of scope

- **The bench.** The API returns the fielded eleven only; who sat is not in the response.
- **"What they could have fielded that round."** It needs the squad as it was then, and the
  portal knows the squad as it is now plus a market log that starts on 11 August. A
  comparison built on today's squad would be a lie for any round with a transfer in it.
- **The upcoming round**, as ruled above.

## Open question

**How far back to backfill.** Weeks 1–6 answer today, so the first sweep could fill the
season. Thirteen calls a week against an unofficial API, once, is the cost. The
alternative is to start from the current week and let history accumulate — cheaper, and it
loses what is available right now, permanently.
