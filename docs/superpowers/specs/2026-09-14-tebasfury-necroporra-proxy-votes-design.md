# Necroporra: the vote belongs to the team

Design, 2026-09-14.

## The problem

Two of the thirteen teams have no portal account behind them, and their managers vote the
way this league voted before the portal existed: by saying so in the group chat. Today
that vote cannot be recorded at all. Every row of `necroporra_votes` hangs off a
`user_id`, its primary key is `(gameweek, user_id)`, and `loadVoters` — the set the page
calls "everyone" — reads only teams with a claim. A manager without an account is not a
late voter or a silent one; they are outside the model.

The ask is that an admin can enter those ballots. The obstacle is that there is nothing
to enter them against.

## What was decided

Four decisions, taken in conversation on 2026-09-14, that the rest of this document
follows:

1. **The vote belongs to the team, not the account.** The Necroporra is re-keyed on
   `team_id`. The alternatives — a placeholder `user` row per unclaimed team, or a second
   table of proxy votes merged at read time — were rejected: the first blocks `/claim`
   the day the real person signs in, and the second makes the season table read from two
   sources that can disagree.
2. **An admin may enter a ballot after the round has closed.** The vote was cast
   elsewhere and on time; only the transcription is late. This is a real privilege — it
   is possible to type a ballot knowing who finished last — so it is paid for with
   visibility, below.
3. **An admin may enter or correct any team's ballot**, not only an unclaimed team's. A
   manager who fat-fingers a pick can ask for it to be fixed, and the code cannot tell a
   permission granted in the group chat from one that was not.
4. **The control lives on `/necroporra` itself**, in the list of ballots that already
   shows all thirteen managers and which of them have not voted. No second screen drawing
   the same thing.

## The shape of the change

### Data model

`necroporra_votes` becomes:

| column | change |
| --- | --- |
| `team_id` | **new**, `text not null references teams(id) on delete cascade` |
| `user_id` | **dropped** |
| primary key | `(gameweek, team_id)` |
| `entered_by` | **new**, `text references user(id) on delete set null`, null when the manager cast it themselves |
| `first_team_id`, `second_team_id`, `cast_at` | unchanged |

Two checks, rather than one:

- `necroporra_votes_distinct_teams` stays as it is.
- `necroporra_votes_not_own_team` is **new** and only expressible now: with the voter's
  team on the row, "you cannot pick your own team" becomes a fact of the table instead of
  a rule the domain alone remembers. Written null-tolerantly, since either pick may be
  null: `(first_team_id is null or first_team_id <> team_id) and (second_team_id is null
  or second_team_id <> team_id)`.

`entered_by` rather than a boolean: who typed it is strictly more than whether it was
typed, costs the same nullable column, and is the difference between "somebody entered
this" and an answer to "who?". It is **not** set when an admin edits their own ballot —
there they are the manager, and the row should not claim otherwise.

### Migration 0013, and when it can run

```sql
alter table necroporra_votes add column team_id text references teams(id) on delete cascade;
update necroporra_votes v set team_id = t.id from teams t where t.user_id = v.user_id;
alter table necroporra_votes alter column team_id set not null;   -- fails loudly if any row did not map
alter table necroporra_votes drop constraint necroporra_votes_pkey;
alter table necroporra_votes add primary key (gameweek, team_id);
alter table necroporra_votes drop column user_id;
alter table necroporra_votes add column entered_by text references "user"(id) on delete set null;
alter table necroporra_votes add constraint necroporra_votes_not_own_team
  check ((first_team_id is null or first_team_id <> team_id)
     and (second_team_id is null or second_team_id <> team_id));
```

The backfill is 1:1 and cannot collide: `teams.user_id` carries a unique index, so no two
votes can map to one team. Eleven rows exist and all eleven map today. The `set not null`
is deliberately the third statement: a vote whose voter has since released their team
would stop the migration rather than be silently dropped.

**This migration is only safe while no round is open**, because it drops a column the
running code still writes. Right now that is true — round 5 closed on 11 September and
round 6 does not exist yet — and it stays true until a sync names round 6, which happens
once the API calls gameweek 6 the current week. **If that window closes first**, the same
change has to be split in two: add and backfill `team_id` and `entered_by`, deploy the
code, and drop `user_id` and swap the primary key in a later migration.

### Domain (`lib/domain/necroporra.ts`)

Pure, and it stays pure. `Ballot`, `Voter` and `SeasonRow` swap `userId` for `teamId`;
`picksOf`, `isOpen`, `lastPlaced`, `scoreRound`, `seasonTable` and `roundBallots` keep
their logic and change only what they are keyed by. `seasonTable` still takes a map of
names, but the page builds it from `loadVoters` — which now carries every team and its
manager — rather than from a query of its own. `validatePair` keeps its signature —
`ownTeamId` stays nullable — but gains a caller that always has a team to pass, because
an entered ballot knows exactly whose it is.

One new function, and it is the whole authorization rule:

```ts
export function canCastFor(
  actor: { teamId: string | null; mayCastForOthers: boolean },
  teamId: string,
): boolean
```

True for your own team, or for any team when the actor holds the permission. Pure, so the
rule is tested without a database and stated in one place rather than in the action and
the component separately.

### Data layer (`lib/necroporra/index.ts`)

- `castVotes` takes `teamId` and `enteredBy`, and upserts on `(gameweek, team_id)`. Still
  one statement, for the reason the file already gives: the driver has no transactions,
  and a delete-then-insert opens a window in which the voter holds nothing.
- `loadVoters` drops its `isNotNull(teams.userId)` filter and returns **all thirteen**
  teams. Holding a team is what makes somebody a voter; having an account is what makes
  them able to vote for themselves, which is a different question.
- `loadVoterNames` is **deleted**. It existed to map account ids to manager names, with a
  fallback to the Google display name for a voter who had released their team. With the
  vote on the team, `teams.manager_name` is the name, and `loadVoters` already carries it.
- `loadMyBallot` is keyed by the caller's team, not their account.
- `loadBallots` returns `enteredBy` alongside the picks, because the page draws it.

### The action (`/necroporra/actions.ts`)

`vote` gains an optional `teamId` field. The rules, all re-checked on the server:

- **Target.** `teamId` from the form, defaulting to the caller's own claimed team. An
  account with no claim and no permission still has nothing to vote with.
- **Authority.** `canCastFor`. A caller sending another team's id without the permission
  is refused — the control is hidden for them, but a hidden control is a courtesy and not
  a control.
- **Deadline.** Unchanged for your own ballot: shut at kickoff, strictly. Bypassed when
  entering somebody else's, which is decision 2. **A round must still exist** for the
  gameweek — the deadline moves, the round's existence does not.
- **Legality.** `validatePair` against the *target* team, so "not your own team" means
  not the team the ballot belongs to.
- **Attribution.** `enteredBy` is the caller's id when the target is not their own team,
  and null when it is.

### Permission

A new action on the existing `poll` resource: `poll: ["create", "publish", "close",
"resolve", "voteFor"]`. It lands in `collaboratorGrants`, which means **a collaborator
gets it too**, exactly as they already get `close` and `resolve`. That follows the
existing shape rather than inventing an admin-only exception; say so if you want it
narrower, because it is a one-line change now and a migration of habits later.

### What people see

In `NecroporraBallots` — the component that already draws every manager's row, for the
open round and for past rounds alike, which is why the control works on both:

- A permitted viewer gets, on each row, a control to fill it in or change it: **"Enter
  picks"** on an empty row, **"Edit"** on one that has them. It opens the ballot form
  already used for your own vote, bound to that team.
- A row whose `entered_by` is set carries a quiet mark naming who entered it and when —
  **shown to everybody, always**. That is the price of decision 2, and it is not
  negotiable down to "only admins see it": a privilege nobody can see is not a privilege
  the league has agreed to.
- Everything else about the row is unchanged. No amber, no new colour: the mark is words.

## Testing

- **Domain**: the re-keyed suite, plus `canCastFor` (own team, other team with and
  without the permission, no team at all).
- **Integration (PGlite)**: `castVotes` upserting by team and recording `enteredBy`; both
  check constraints refusing what they exist to refuse; `loadVoters` returning the
  unclaimed teams.
- **Action**: a plain manager sending another team's id is refused; an admin entering a
  closed round's ballot succeeds; a manager's own late vote is still refused.
- **Component**: the control appears only for a permitted viewer; the entered-by mark
  renders for everyone.

## Out of scope

No poll engine, no auto-resolution, no notification when somebody's ballot is entered for
them, and no audit trail beyond `entered_by` and `cast_at`. The Necroporra stays two
tables — see the note on why it was built as itself.

## Open questions

1. **Collaborators.** As above: `voteFor` follows `collaboratorGrants` unless you say
   otherwise.
2. **The migration window.** If round 6 opens before this ships, the migration splits in
   two. Worth knowing before the plan is written, since it changes the first task.
