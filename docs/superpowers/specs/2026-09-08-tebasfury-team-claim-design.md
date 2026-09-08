# TebasFury Step 7 — Claiming a team

## Context

The Necroporra was the slice asked for. Designing it stopped at its first question —
"who is allowed to vote, and which team can't they vote for?" — because the portal has
no answer. Three facts, measured against production on 2026-09-08:

- `teams` holds 13 rows and **zero** of them have a `user_id`.
- The `user` table holds two accounts: the owner's, and the owner's work address.
- **Nothing in the codebase ever writes `teams.user_id`.** The column came with the
  skeleton, complete with an `on delete set null`, and has been dead ever since.

So the league's managers are 13 names the API reports, and the portal's users are a set
that has never intersected them. Every Necroporra rule needs that intersection: two votes
per manager, never for your own team, a season table of who guessed right.

This slice builds it and nothing else. It is deliberately small, and it is worth
shipping on its own: it is the thing that makes an invitation to the group meaningful,
and until the group signs in there is no poll to run.

**The prerequisite no code can satisfy:** the friends have to sign in with Google. This
slice makes that worth doing; it cannot make it happen.

## What the probe settled, for the slice after this one

While designing the Necroporra's deadline, one probe ran against the live API on
2026-09-08 at 18:53 UTC, between rounds. Recorded here because it is the evidence the
next slice will build on, and it should not have to be paid for twice:

- `GET /v1/competition/1/week/current` returned **week 5** — `isLive: false`,
  `openingWeekDate: 2026-09-11T21:00:00+02:00`, `closingWeekDate: 2026-09-15T03:00:00+02:00`,
  plus `nextWeek: 6` and `previousWeek: 4`, two fields the client's schema currently
  ignores.
- `/v1/competition/1/week`, `/v1/competition/1/week/5` and `/v1/competition/1/weeks` all
  answered **404**.

Two conclusions. There is no calendar endpoint: only the current week exists. But "the
current week" rolls forward to the *upcoming* one as soon as the previous closes, and it
states its opening time three days in advance — so a poll whose voting closes at kickoff
can be scheduled without a human setting a date. `gameweeks` will hold that row within a
day of the previous week closing, because `decideNextRun` caps an idle wait at 24 hours.

## Decisions

| Decision | Chosen value |
|---|---|
| Who validates a claim | Nobody. Self-service, first come first served |
| Where the link lives | `teams.user_id`, the column the skeleton left dead |
| A user without a team | Sees the whole portal, plus a nudge on the home page |
| Who sees the mapping | Nobody. Your own team is marked for you alone |
| Fixing a mistake | The claimer releases it themselves; an admin can release any |
| Discoverability | No nav entry. The home page is the only door |

## Rulings

### Ruling 1 — the claim is a column, not a table

`teams.user_id` already exists, already declares `on delete set null`, and is already
untouched by every write in the system. A `team_claims` table with `claimed_at` and
`released_at` was considered and rejected: it answers "who held which team in March",
and nothing will ask. Votes will be attributed to the **person**, not to the team; the
link is read at the moment of voting, to enforce the rule against voting for yourself,
and never afterwards.

One migration, `0009`, creating one unique index. No new table.

### Ruling 2 — the unique index is plain, because Postgres treats NULLs as distinct

One user may hold one team. A unique index on a nullable column enforces exactly that
while leaving twelve unclaimed teams alone, because Postgres considers two NULLs distinct
in a unique index. A partial index with `where user_id is not null` would be equivalent
and would suggest, wrongly, that the plain one does not work.

`0009` creates it against a column that is currently all NULL, so it cannot fail on the
populated database.

### Ruling 3 — one statement decides the race, and the row count is the answer

Neon's HTTP driver has no transactions and PGlite has no `db.batch()`. A conditional
`UPDATE` is therefore not a stylistic preference, it is the only concurrency primitive
available:

```sql
update teams set user_id = :me
 where id = :team
   and user_id is null
   and not exists (select 1 from teams where user_id = :me)
```

One row affected means the team is yours. Zero means somebody was faster, or you already
hold another — two different messages, told apart by a follow-up read.

**That follow-up read is allowed to be wrong.** By the time it runs the world may have
moved again, and the text it produces may name the wrong reason. This costs nothing: the
decision was already made, correctly, by the statement above. The read informs a
sentence, not an outcome. Any attempt to make the message authoritative would need a
transaction, and there is not one to be had.

### Ruling 4 — nobody learns who claimed what

A claimed team someone else holds renders as `Claimed`, with no name. The group already
knows who is behind each manager name — that is what the names are — so publishing the
mapping adds no information, while introducing a second display name per person (their
Google account) that can disagree with the first.

But a taken row must still say it is taken, or the absence of a button reads as a bug.
`Claimed` says the door is shut without saying who holds the key.

This applies to admins too. An admin sees a **Release** control on every claimed row and
still sees no names: releasing is all that fixing a mistake requires, and "I took the
wrong row, free it for me" is the whole conversation.

### Ruling 5 — releasing is by user, never by team

`releaseTeam` takes the caller's user id and clears whatever they hold. It never takes a
team id, so no request — mistyped, forged, or curious — can free somebody else's claim.
The admin variant is a separate function that does take a team id, and it is the only one
that checks a role.

### Ruling 6 — the nudge is on the home page only

Signed in, no team: a strip on `/`, which is where a Google sign-in lands. Not on every
page. Six nav destinations already forced a second tier costing 32 vertical pixels, and
four unperformed visual checks (31–34) are still asking whether that pushed content below
the fold. A second permanent strip would be answering those questions with "worse"
before they have been asked.

Once claimed, the same slot on the home page becomes `Your team: <manager> · change`,
which is the way back to `/claim`. No seventh nav entry for something done once.

### Ruling 7 — the claim survives the sync, and a test says so

`runSync`'s upsert of `teams` sets exactly one column on conflict: `managerName`.
Verified by reading it, not assumed. But it is one line, in a file that future slices
will touch, and widening its `set` clause would silently wipe every claim in the league
on the next sync. A cross-module test — claim a team, run the upsert, assert the claim
survives — is what will remember this. It is the highest-value test in the slice.

### Ruling 8 — marking "your team" stops at the standings

Your row in the standings gets a marker. The home boards, the catalogue and the market
log could all mark it too, and each is a visual decision of its own on a page that
already earned its layout. This slice adds two views' worth of design; a third would be
scope that nobody asked for. Recorded as a follow-up.

## Architecture

### Data model

No new table. Migration `0009` adds:

```sql
create unique index "teams_user_id_unique" on "teams" ("user_id");
```

The existing column stays as the skeleton declared it:
`user_id text references "user"(id) on delete set null`. Deleting an account frees its
team rather than deleting the team.

### Modules

`src/lib/claims/index.ts` — I/O, deliberately not under `lib/domain/`, which is pure by
contract:

```ts
type ClaimOutcome = "claimed" | "taken" | "already-claimed-another";

claimTeam(db, { userId, teamId }): Promise<ClaimOutcome>
releaseTeam(db, { userId }): Promise<"released" | "nothing-to-release">
releaseTeamAsAdmin(db, { teamId }): Promise<"released" | "nothing-to-release">
loadClaimBoard(db, { userId }): Promise<ClaimRow[]>
```

`src/lib/domain/claim-row.ts` — pure, tested without a database:

```ts
type RowState = "free" | "mine" | "taken";
rowState(row: ClaimRow, viewer: { userId: string; isAdmin: boolean }): RowState
```

The server action in `src/app/claim/actions.ts` translates outcomes into text and
revalidates. It is the only place that knows the wording.

### Views

**`/claim`** — session-guarded like `/standings`. The 13 manager names in one column,
each with the control its state earns: `This is me`, `Release`, or the inert `Claimed`.
When the viewer holds a team, the free rows lose their buttons and a line explains that
it is one team per person.

**`/`** — one line in one slot, whose content depends on the viewer. Without a team,
the nudge: `No team claimed yet.` and a link reading `Claim yours`. With one,
`Your team: <manager> · change`. Signed out, neither: the page is unchanged.

**`/standings`** — the viewer's row is marked. No other page changes.

## Error handling

The three outcomes are not exceptions and are not logged as failures. `taken` and
`already-claimed-another` are ordinary results of a race between friends, rendered as a
sentence above the list, with the page re-read so it shows the world as it now is.

A database error is a database error: it throws, and the page's error boundary handles it
as every other page does.

## Testing

**Integration, against PGlite** (`src/lib/claims/index.test.ts`):

- a free team is claimed, and the row carries the claimer;
- a team someone else holds returns `taken`, **and the existing owner is unchanged**;
- a second team returns `already-claimed-another`, and neither row moves;
- release frees the team, and another user can then claim it;
- release with nothing held returns `nothing-to-release` and writes nothing;
- the admin release clears a claim the caller does not hold.

**On concurrency, honestly:** PGlite is in-process and single-connection, so two
simultaneous claims cannot be simulated. What the tests prove is the property the
guarantee rests on — the second statement affects **zero rows** — not that it was
observed under real contention. The spec says so rather than letting a test name imply
otherwise.

**Schema** (`schema.test.ts`, following the existing ones): the unique index exists, and
a second team for the same user is rejected by the database.

**Cross-module regression** (Ruling 7): claim a team, run `runSync`'s team upsert against
a fake standing, assert `user_id` survives.

**Pure** (`claim-row.test.ts`): every state, including the admin's view of a taken row.

**Playwright**: `/claim` redirects a visitor with no session to `/login`. That is the
whole of what the e2e suite can cover — it never signs in, by design — so **the claiming
path itself has no automated coverage of the signed-in case**. It is covered by the
manual checks below, and by nothing else.

## Out of scope

- **The Necroporra.** The next slice, and the reason this one exists.
- **Linking a LaLiga account for write operations.** A different link, a different slice,
  and the one that carries real credential risk.
- **A public mapping of accounts to teams.** Ruling 4.
- **Marking your team anywhere but the standings.** Ruling 8.
- **Inviting the group.** A message from the owner with a URL, not a feature.

## Practical notes for whoever implements this

- Load `frontend-design` before the first line of UI. Two views change.
- Vitest does not typecheck. `npx tsc --noEmit` before committing.
- `0009` must be applied to production before this deploys — `docs/deployment.md` step 4
  gets its line, as every migration has.
- The conditional `UPDATE` must be one statement. Reading first and then writing
  reintroduces exactly the race the statement exists to avoid.
- Do not add a nav entry. Ruling 6 argues why, and the nav's second tier is three days
  old.

## Follow-ups this slice is expected to leave behind

- **Nothing tells the owner who has not claimed yet.** With no names anywhere, the
  question "who still has to sign in?" has no screen. A count — *9 of 13 teams claimed* —
  would answer it without naming anyone, and it belongs on the home page or `/admin/sync`.
- **What happens to Necroporra votes when someone changes team mid-season** is not
  decided here, because there are no votes yet. Releasing is currently free and
  unconditional; the poll slice may need it to stop being so once a round is open.
- **Marking the viewer's team on the home boards, the catalogue and the market log.**
  Ruling 8.
- **`nextWeek` and `previousWeek` are in the week response and unread.** The probe found
  them; the calendar the next slice needs may be simpler for it.

## The visual checks — not yet performed

On `/claim`:

35. The 13 rows at 320px with the longest names — `LamineTheTuareg` and
    `La Agustineta 96` — beside their button. Does the name wrap, and if it does, does
    the button stay on the row it belongs to?
36. Does `Claimed` read as a fact about the team, or as a refusal aimed at the reader?
37. The page as an admin, with a Release control on several rows: does it still look like
    the page everyone else sees, or does it turn into an administration screen?

On `/`:

38. The nudge at 320px: does it sit above the fold with something else, or does it push
    the boards down enough that the page opens on a banner?
39. The claimed variant — `Your team: La Agustineta 96 · change` — on the narrowest
    screen. Does the link survive on one line?

On `/standings`:

40. The marked row against the twelve that are not, at 320px. Is it visible without being
    louder than the leader's row?
