# TebasFury Step 11 — The Necroporra

## Context

The last item on the original roadmap, and the reason the team-claim slice exists. Each
week, every manager names **two** teams they think will finish the round last; naming the
team that actually does is worth **one point**; voting closes when the round opens.

Both prerequisites now exist: the portal can tell who is who (`teams.userId`), and there
is a season of data to resolve against. The rules above were settled in conversation and
are not re-opened here.

**The prerequisite no code can satisfy:** one team of thirteen is claimed. Until the
friends sign in there is nobody to vote, and this slice cannot make that happen — it can
only be ready when they do.

## Rulings

### Ruling 1 — the Necroporra is built as itself, not as a poll engine

The portal design called for six tables — `poll_templates`, `polls`, `poll_options`,
`poll_votes`, `poll_results`, `poll_scores` — with the Necroporra as `kind =
'necroporra'`, so that a second kind of poll would be a template rather than new code.

**That is overturned here, deliberately, and the reason is the same one that made the
claim a column instead of a table.** There is one poll. It has one shape, one scoring
rule and one deadline rule, all of them settled. A template engine would be six tables
and a rules interpreter serving a single instance, and every one of those tables would
have to be understood by anyone reading how a vote is counted. If a second kind of poll
is ever wanted, generalising two concrete tables with a season of real data behind them
is a better position to design from than guessing the abstraction now.

### Ruling 2 — the round's deadline is stored; its result is not

`necroporra_rounds` holds the gameweek and when voting closes. Nothing else.

Who finished last is **arithmetic over `team_gameweek_stats`**, so it is computed on
read, exactly as the fair-play slice refuses to keep a violations table: "a stored
verdict can outlive the rule that produced it." A corrected sync silently corrects every
past Necroporra result, which is the behaviour we want and the one a `poll_results` table
would quietly break.

The deadline is the exception because it is **not** derivable. See Ruling 3.

### Ruling 3 — the upcoming week does not go into `gameweeks`, and this is why the round table exists

The natural deadline is the round's own opening time, which the API reports three days
ahead on `week/current`. The natural place to keep it would be `gameweeks.opensAt`.

It cannot go there. `runSync` writes a `gameweeks` row only once a week has actually been
played — it `continue`s past a current-but-unplayed week — and `gameweeks` having only
played weeks is load-bearing: `loadLeagueStatus` takes `max(number)` as "the gameweek the
portal is showing", and the status strip on every page reads it. Adding week 5 the moment
the API names it would move that figure to a round with no scores in it, and the metrics
slice has already had to fix one bug of exactly that shape ("stop metrics from reading the
round still in play").

So the Necroporra keeps its own row, with no foreign key to `gameweeks.number` — the same
independence `player_gameweek_points` documents, and for the same reason: two cadences
that must not be able to fail each other.

### Ruling 4 — the round is opened by the sync, from data it already fetches

`runSync` already calls `getCurrentWeek()` every run and already gets `opensAt` back. It
now also ensures a Necroporra round exists for that week, closing at that time.

No new scheduled chain, no second thing that can silently die, and no human setting a
date. `decideNextRun` caps an idle wait at 24 hours, so the round appears within a day of
the previous one closing — comfortably inside the three days' notice the API gives.

Opening a round is idempotent and never moves a deadline that has passed: a rescheduled
kickoff may move the close forward while voting is open, but a closed poll stays closed.
Reopening voting after the fact would let somebody vote on a round they had already seen.

### Ruling 5 — one row per voter per round, with two team columns

Not one row per vote. Neon's HTTP driver has no transactions, so replacing a pair of
votes as delete-then-insert has a window in which a voter has none — and the failure
lands on the person who was mid-change.

Two nullable columns make replacing the pair a **single** `onConflictDoUpdate`: atomic
without a transaction, which is the same reasoning that made the claim one conditional
`UPDATE`. It also makes "at most two votes" a fact of the schema rather than a rule
somebody has to remember to validate.

The cost, written down: a rule change to three votes is a migration rather than a config
value. The rules are settled, and this is the trade the no-transactions constraint pays
for.

### Ruling 6 — you must hold a team to vote, and never for your own

Voting is per manager, so it needs a claimed team — which is also what supplies the team
you may not name. A signed-in account with no claim can read the Necroporra and cannot
vote, and the page says which of the two it is rather than just hiding the form.

Both votes must be different teams, enforced in the domain and by a check constraint.

### Ruling 7 — last place is the API's, not ours

The team whose `roundPosition` is highest in that gameweek. Measured on 2026-09-09, the
API hands out distinct sequential places where teams tie and a derived rank shares them,
so "last" is unambiguous in the stored data and would need an invented tie-break in ours.
The round table slice settled this with the same evidence.

A round is unresolved while any of its rows are provisional or its positions are null. An
unresolved round scores nobody — it does not score everybody zero.

### Ruling 8 — every vote is visible, open round included

**Reversed on 2026-09-09 by the owner, and the reason is better than the original.** This
said an open round should show a voter only their own picks, because seeing the others
would let a late voter copy, and committing early is the game.

The owner's answer: *això fomenta el pique.* The visible argument between friends IS the
product here — a poll nobody can needle each other about is a form. Thirteen people who
know each other are not an electorate to be protected from influence; the copying this
was guarding against is itself something to be teased about, and hiding the picks removes
far more fun than it protects.

So an open round shows everyone's picks, and who has not picked yet — the second is as
much of a prod as the first.

The cost, stated once and accepted: somebody who votes on Friday can see Monday's picks
before choosing. That is now a feature of the game rather than a flaw in it.

## Architecture

| Piece | Holds |
| --- | --- |
| `necroporra_rounds` | `gameweek` (PK), `closesAt`, `openedAt` |
| `necroporra_votes` | `gameweek` + `userId` (PK), `firstTeamId`, `secondTeamId`, `castAt` |
| `lib/domain/necroporra.ts` | pure: is it open, is a pair legal, who finished last, one round's score, the season table |
| `lib/necroporra/index.ts` | the I/O: open a round, cast a pair, read a round |
| `/necroporra` | the page: this round's form, past rounds, the season table |

Migration `0010`.

## Testing

Domain, pure: open and closed against a clock; a pair naming your own team; a pair naming
one team twice; a single vote allowed; last place from the stored position; an unresolved
round scoring nobody; a voter scoring once whichever slot the team is in; the season table
summing only resolved rounds and ordering stably.

I/O, against PGlite: opening a round twice; a deadline moving forward while open and not
after close; replacing a pair in one statement.

**Not coverable end to end:** the page needs a signed-in manager with a claimed team, and
the Playwright suite never signs in. Manual checks below.

## The manual checks this slice leaves for a human

1. With a claimed team, vote for two teams; reload; the pair is still there.
2. Change one of the two; exactly two votes remain.
3. Your own team is not offered.
4. With the second (unclaimed) account: the page reads, the form says why it cannot vote.
5. Everybody's votes appear on the open round as well as on closed ones, and a manager
   who has not voted is listed as not having voted.
6. A past round can be looked up from the picker without scrolling past every other one.
7. At 320px and 375px.

## Out of scope

- Any second kind of poll (Ruling 1).
- Notifying anybody that voting is about to close.
- What happens to votes when somebody changes team mid-season — still unsettled, and it
  has never happened.
