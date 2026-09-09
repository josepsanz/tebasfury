# TebasFury Step 8 — League and team metrics

## Context

The portal reports what happened — the table, the market, the values — and answers
almost nothing about it. A manager can see they are third; they cannot see whether they
are third and climbing, whether their 44 was a good round or a poor one for everybody,
or whether the manager above them is consistent or lucky.

The data to answer all of that has been sitting in `team_gameweek_stats` since Step 2.
Thirteen teams times the weeks played is sixty-five rows today and under five hundred by
May, so this slice adds no table, no sync and no query. It adds arithmetic and two
places to read it.

It also opens `/teams/[id]`, the portal's first per-manager page. That route is the
answer to a request recorded before this slice existed — a squad view per manager, and
the market log filtered by team — and this slice deliberately builds only its metrics
half, leaving the other two as follow-ups with a page to land on.

## Decisions

| Decision | Chosen value |
|---|---|
| Where the league's figures go | A second strip on the home page, below the personal one |
| Where a team's figures go | `/teams/[id]`, a new page |
| How that page is reached | Every manager name in the standings becomes a link |
| Trend | The slope of the last three gameweeks, in points per gameweek |
| Streak | Consecutive recent gameweeks above or below the league's average |
| Zeros | Excluded from the records, counted everywhere else |

## Rulings

### Ruling 1 — a zero is a missing lineup, and the records say so

Gameweeks 2 and 3 already contain scores of 0. A zero in this league does not mean a
manager played badly; it means nobody set a lineup. Left in, the house record for the
worst round of the season becomes "the week somebody forgot", which is a different and
much less interesting fact than the one the metric promises.

So `worst` and `best` skip zeros. Everything else — average, trend, regularity, streak —
counts every gameweek, because those describe the season as it actually went, and a
season with two blank weeks did go worse.

The consequence is visible and must be owned rather than hidden: a team's "worst" can be
higher than a gameweek that its own average includes. The view therefore carries the
reason next to the figure, in the reader's language:

> Zeros excluded — a blank gameweek usually means nobody set a lineup.

### Ruling 2 — trend is a slope over three rounds, and says so when it cannot be

Least squares over the last three gameweeks' points, reported as points per gameweek and
a direction. Fewer than three readings produces `null`, and the view says "needs another
round" rather than drawing an arrow from two points.

The alternatives were considered and rejected. Last round against the season average is a
photograph, not a trend: one good week from a manager who has been sinking for a month
would point up. Three rounds against the previous three is the most robust and needs six
gameweeks, which means it would say nothing until mid-October.

Three is small, and a slope over three points is a fragile number. That is accepted: the
portal shows it to a group of thirteen friends, not to an investor, and the honest
mitigation is that the figure carries its own unit — `▲ 6 pts/round` invites the reader
to judge it, where a bare arrow would not.

### Ruling 3 — streak is measured against the league, not against position

A manager's position moves when other people score, so a "three weeks climbing" streak is
often somebody else's collapse. Being above the league's average for that gameweek is a
statement about the manager themself, and in a thirteen-team league where a single injury
swings a position, it is the more truthful of the two.

### Ruling 4 — two strips on the home page, not one

The strip that exists today is about the reader: rank, points, live score. The league's
figures go in a second panel below it. Merging them would produce a row where each figure
requires the reader to work out whose it is, which is exactly the confusion the amber
"you" convention was introduced to avoid.

### Ruling 5 — the standings table is the door to the team pages

Every manager name in the table becomes a link to `/teams/[id]`. The table is the only
screen where all thirteen appear, and it is where the question "what is happening to this
one" occurs to a reader. A page nobody can find is a page nobody reads — the mistake
`/claim` avoided by putting its only door on the home page.

### Ruling 6 — no new read, and no new table

`loadSnapshots(db)` already returns the snapshots and the teams, and both the standings
page and the home page already call it. The team page calls the same one. At sixty-five
rows today and under five hundred by May, aggregating in TypeScript is cheaper to write,
cheaper to test and cheaper to change than the SQL that would replace it — and Step 5
already established that the ranking rules live in the domain rather than in a query.

### Ruling 7 — every metric has an unavailable state, and it is a value not an absence

`null` means "cannot be computed yet", and each view renders a short reason: a trend needs
three rounds, a regularity needs two, points per million needs a squad value that only a
live-observed gameweek records. Rendering a dash and leaving the reader to guess whether
the figure is zero, missing or broken is the failure this ruling exists to prevent.

### Ruling 8 — a metric describes rounds that have FINISHED

`teamMetrics` and `leagueMetrics` read `team_gameweek_stats` whole, and while a round is
open that table holds one row per team whose `points` is not a score but a partial: the
in-progress total for a match that has not finished. On six settled rounds averaging 45,
one live row sitting at 8 points mid-round turns the average into 39.7, the trend from
"▼ 1 pts/round" into "▼ 17.5 pts/round", and the regularity from "± 1.3 pts" into
"± 13 pts" — a collapse the League panel would report for the two or three days a round
is open, that is not happening. Before kickoff every row reads 0, which is the exact
ambiguity Ruling 1 excludes zeros to resolve, walking back in through `average`,
`trend` and `regularity`, which Ruling 1 never touched.

`buildTable` (`standings.ts`) also reads the live row, and stays right to: a cumulative
total is monotone — the live points only ever add to it — and the view labels it as live,
with a "Live" column and "GW n live" in the strip. A reader is told what they are looking
at. A mean, a slope and a standard deviation are not monotone and are not provisional —
partway through a round they are simply computed from the wrong rows, and the metric grid
carries no such label to say so.

So `teamMetrics` and `leagueMetrics` filter every provisional row out at the point
snapshots enter each function, before any figure is derived from them: the records, the
average, the trend, the spread, and the array `streakOf` walks — including the league
averages it measures a streak against. The filter costs nothing a settled week needs:
`upsertStats` writes `isProvisional: live` for the week currently open and rewrites that
same row to `false` once it closes, so the round reappears, correctly, the moment it is
one.

## Architecture

### The domain

`src/lib/domain/metrics.ts`, pure, no I/O:

```ts
export type Trend = { slope: number; rising: boolean } | null;
export type Streak = { rounds: number; above: boolean };
export type RoundRecord = { points: number; gameweek: number; teamId: string } | null;

export type TeamMetrics = {
  best: RoundRecord;
  worst: RoundRecord;
  average: number | null;
  trend: Trend;
  regularity: number | null;   // population standard deviation, in points
  streak: Streak;
  pointsPerMillion: number | null;
};

export type LeagueMetrics = {
  best: RoundRecord;           // carries the teamId, so the view can name the manager
  worst: RoundRecord;
  average: number | null;
  trend: Trend;
};

teamMetrics(snapshots: Snapshot[], teamId: string): TeamMetrics
leagueMetrics(snapshots: Snapshot[]): LeagueMetrics
```

Definitions, so that the implementation cannot quietly choose differently:

- **best / worst** — the highest and lowest `points` among gameweeks whose `points` is
  not zero. Ties resolve to the earliest gameweek: the first time it happened is the
  record.
- **average** — the mean of every gameweek's `points`, zeros included, to one decimal.
- **trend** — least-squares slope of `points` against gameweek number over the last three
  gameweeks, to one decimal. `rising` is `slope > 0`; a slope of exactly zero is not
  rising.
- **regularity** — population standard deviation of every gameweek's `points`, to one
  decimal. Needs two gameweeks.
- **streak** — walking back from the latest gameweek, the run of consecutive gameweeks in
  which the team's `points` are above (or below) the league's average **for that same
  gameweek**. A gameweek exactly on the average ends the run.
- **pointsPerMillion** — cumulative points divided by the most recent non-null
  `teamValue`, in millions, to one decimal. Backfilled gameweeks record no team value, so
  this exists for the observed season and not for its whole history.

**Rounding happens in the domain, not in the view.** A figure is rounded once, where it is
computed, so that two views cannot disagree about the same number — and so that the tests
assert the value a reader will actually see.

**A team with no gameweeks at all** has a streak of zero rounds, every record `null` and
every average `null`. It is the state of the whole league before the first sync, and it
must render as a page rather than as a crash.

### Views

**`/` (home)** — the existing personal strip is untouched. Below it, a `MetricGrid`
labelled `League` with average, best, worst and trend. Best and worst carry the manager's
name and the gameweek as their caption; worst also carries the zero note.

**`/teams/[id]`** — session-guarded like every portal page. `PageHeader` with the
manager's name; a `MetricGrid` of the seven team metrics. An unknown id is a 404 through
the route's own `notFound()`.

**`/standings`** — each manager name becomes a link to its team page. Nothing else about
the table changes.

### Components

`src/components/metric-grid.tsx` — `{ label, value, note? }[]` in a wrapping grid, two
columns at phone width. Deliberately not an extension of `KpiStrip`: that is a single row
of three figures with deltas, this is a wrapping grid of seven with captions, and forcing
one component to be both would leave a props object that is mostly conditionals.

## Error handling

There is no new failure mode. Every metric is derived from rows already on the page, and
every one of them has a defined unavailable state (Ruling 7). A team id that matches no
team is a 404, not an empty page of dashes.

## Testing

**Pure, in `metrics.test.ts`** — this is where the slice's risk lives:

- a zero does not become the worst round, and the same zero does lower the average;
- ties in a record resolve to the earliest gameweek;
- a trend over two gameweeks is `null`; over three it carries the right sign, and a flat
  three is not rising;
- regularity of three identical scores is 0, and of a spread is the standard deviation;
- a streak stops at the gameweek that breaks it, and a gameweek exactly on the league
  average breaks it;
- points per million uses the latest known value and is `null` when none was recorded.

**Presentational** — `MetricGrid` renders a note when given one and nothing where a
metric is unavailable beyond its stated reason.

**Playwright** — `/teams/<id>` redirects an anonymous visitor to `/login`. As with every
other page, the signed-in path has no automated coverage.

## Out of scope

- **The squad on the team page**, and **the team's market history**. Both were asked for
  before this slice and both belong on this page; all three at once would be too large to
  review well. Follow-ups, with a page now waiting for them.
- **Metrics on the standings table itself.** Thirteen rows times seven columns at 375px
  is not a table, and the team page exists so that it does not have to be one.
- **Comparing two managers side by side.** `/progress` already pins three.
- **Any new table, query or sync.** Ruling 6.

## Practical notes for whoever implements this

- The arithmetic is the product here. Write the pure tests first and make them the
  argument — a metric nobody can reproduce by hand in the terminal is a metric that will
  be disputed in the group chat and cannot be defended.
- `Snapshot` already carries `points`, `gameweek`, `teamId` and `teamValue`. Nothing new
  is needed from the database.
- Load `frontend-design` before `MetricGrid`. The portal's direction is now a terminal:
  panel headers, mono figures, colour only for up and down, amber only for the reader.
- Vitest does not typecheck. `npx tsc --noEmit` before committing.

## Follow-ups this slice is expected to leave behind

- **The squad and the market history on `/teams/[id]`**, as above.
- **Nothing links a player to the team page of whoever owns them.** `/players/[id]` shows
  an owner's name; once team pages exist, that name wants to be a link.
- **The league's own regularity is not shown.** A season where everyone scores 40 and one
  where scores swing between 10 and 80 are different leagues, and the figure is already
  computed for teams.
- **Records are season-wide and unlabelled by season.** The moment a second season exists,
  every record on these pages silently becomes "this season" without saying so.

## The visual checks — performed 2026-09-09, all clean

Walked by the owner on 2026-09-09, signed in, at 320px and 375px. All five read
correctly and nothing needed changing.

One qualification, so the record is not read as more than it is: check 43 asked for a
team with fewer than three rounds played, and with five gameweeks in the table no such
team exists — every manager has a trend and a regularity. So the page was judged with
most of its figures populated, and the state where three of seven show their unavailable
reason has still not been seen. It will appear on its own at the start of next season,
and `Points per million` is the one metric that can show it today, on a team whose
gameweeks recorded no squad value.

41. The League panel at 320px: four figures with captions in two columns, and the longest
    manager name in a caption. Does a caption wrap under its figure or collide with the
    next one?
42. The zero note next to the worst round — does it read as an explanation, or as an
    apology for a broken number?
43. `/teams/[id]` with seven metrics at 320px, three of them unavailable and showing their
    reason. Does the page read as informative or as mostly excuses?
44. A manager name as a link in the standings: is it discoverably a link without
    underlining thirteen rows into noise?
45. A trend of `▲ 0.3 pts/round` — is a figure that small legible as "basically flat", or
    does the arrow overstate it?
