# The Calendar of Shame

Design, 2026-10-09.

## What it is for

`domain/breakfast.ts` already answers who **owes** breakfast after each round. Nothing
records who actually **brought** it. The league brings it whenever it suits it, not on
a fixed day, so the portal cannot infer it: somebody has to write it down. The owner
wants that record kept as a plain history, saying who brought breakfast, when, and what it was.

It lives inside the Necroporra section, as its own page, and it is called the
**Calendar of Shame**.

## Rulings from the owner, 2026-10-09

These were asked and answered. They are not open questions:

- **Free entries, not tied to a round.** An entry says *who, when, what* and nothing
  else. It does not settle a duty from `breakfastDuties`, and the page does not compute
  who still owes one. The two may disagree. That is fine, because the record describes
  what happened, not what the rule asked for.
- **One manager per entry.** If two people bring breakfast the same day (a tie at the
  bottom, or sharing the bill), that is two entries. The grid shows both names on that day.
- **Its own page, `/necroporra/breakfasts`**, linked from the Necroporra header. It does not
  become a seventh block on `/necroporra`, which is already long, and a URL of its own can be
  dropped into the group chat.
- **Layout: a month grid, then the full list** (option A of three shown in the visual
  companion; the season-strip and ledger-only layouts were rejected).
- **Admins and collaborators record it.** Everybody else reads it.

## Data

One new table, `breakfasts`, migration **0018**:

| column        | type                         | notes |
|---------------|------------------------------|-------|
| `id`          | generated integer, PK        | |
| `team_id`     | text, not null, → `teams.id` | who brought it; `on delete cascade`, like `necroporra_votes.team_id` |
| `brought_on`  | `date`, not null             | a calendar day, no time |
| `what`        | text, null                   | free text, optional; trimmed, and empty is stored as null |
| `recorded_by` | text, null, → `user.id`      | who wrote it down; `on delete set null`, like `necroporra_votes.entered_by` |
| `recorded_at` | timestamptz, not null, now() | |

Index on `brought_on`, since every read is by date.

**Keyed on the team, not the account**, for the reason `necroporra_votes` gives: two
managers have no portal account, and they bring breakfast too.

**`brought_on` is a `date`, not a timestamp.** A breakfast happens on a day. Storing an
instant would make the day it falls on depend on the timezone of whoever reads it, and that
is the bug a `date` column cannot have. "Today", where the form needs it as a default, is
today **in Europe/Madrid**, the league's own day.

No uniqueness constraint. The same manager bringing two breakfasts on one day is unlikely
but not impossible, and the table has no business refusing it.

Only this page reads the table, so deploying before the migration breaks only this page.
The migration still goes in **before** the push, as `docs/deployment.md` asks of every
migration.

## Permission

A new resource in `statement`, `breakfast: ["record"]`, placed in **`collaboratorGrants`**
so that the admin inherits it by composition. The `user` role does not get it.

`record` covers create, edit and delete. They are one act at three sizes, and splitting
them would add rows to the permission table without a reader who wants them apart.

Every server action re-checks it with `requirePermission({ breakfast: ["record"] })`. Hiding
the form is a courtesy, not a control, as `vote` says of its own form.

## The page

`src/app/(portal)/necroporra/breakfasts/page.tsx`, signed-in readers only (`requireSession`),
like the rest of the portal.

Top to bottom:

1. **`PageHeader`**: title "Calendar of Shame", a one-line note on what it records, and the
   count of breakfasts as `meta`. A link back to the Necroporra.
2. **The record form**, only when the viewer holds `breakfast:record`. It has a date (default:
   today in Madrid), a manager select listing **active** teams only, and an optional "what".
   Submit is "Record". A manager who has left still owns their past entries but is not
   offered for new ones, the same split `/necroporra` makes between the open round and
   the past.
3. **The month grid.** Weeks run Monday to Sunday. Navigation uses `?month=YYYY-MM`, with
   ‹ previous / next › links built with `urlWithParam`, so other parameters survive. The
   month opens on **the current month in Madrid**. A `month` that does not parse, or names a
   month that does not exist, falls back to the current month rather than a 404, which is
   the `?round=` ruling. Days outside the month are blank cells. A day with entries is
   marked in `--board-alert`, with each bringer's name under the day number. Today carries
   a quiet outline. The grid has to stay legible at phone width: names truncate, and the
   cell keeps its number.
4. **"Every breakfast"**: every entry for the whole history, **newest first** (ties on the
   date broken by `id` descending, so the order is stable). Each row shows the date in Madrid
   wording ("Wed 7 Oct"), the manager name, and "what" (or nothing). For a recorder, each row
   also carries **Edit**, which opens the same form filled in, as `BallotForRow` reuses
   `NecroporraBallot`, and **Delete**. Delete asks for confirmation before it posts,
   because it cannot be undone.
5. **Empty states.** With no entries at all, the grid still draws and the list says nobody
   has brought breakfast yet. A month with no entries draws an empty grid, and the list
   below still shows everything.

The Necroporra header gains the link to this page. `app-nav.tsx` gains nothing, because
the page lives inside the Necroporra section.

UI copy is in English, like the rest of the portal. Names, never pronouns or "this
manager". These lines get screenshotted.

## Server actions

`src/app/(portal)/necroporra/breakfasts/actions.ts`: `recordBreakfast`, `updateBreakfast`,
`deleteBreakfast`, each returning `{ ok, message }` like `vote`, and each
`revalidatePath("/necroporra/breakfasts")`.

Validation lives in a pure function in `src/lib/domain/breakfast-log.ts`, so it can be tested
without a database. It refuses the following:

- a date that is not a real `YYYY-MM-DD` day;
- a date **after today in Madrid**, because a breakfast not yet brought is not history;
- a team that is not in the league. A team that has *left* is accepted on **edit**, so an
  old entry can still be corrected, and refused on **create**;
- a "what" longer than 200 characters.

Edit and delete on an id that no longer exists answer "That breakfast is no longer
there." and do not throw. Two recorders working at once is the realistic way to hit it.

## Pure logic, tested first

`src/lib/domain/breakfast-log.ts`:

- `parseMonth(param, today)`: reads `?month=`, falling back to today's month.
- `monthGrid(month, entries)`: the weeks of the month, Monday first, each cell holding its
  day (or null outside the month) and its entries.
- `validateBreakfast(input, { today, teams, mode })`: the refusals above.
- `madridToday(now)`: the date in Europe/Madrid, and the one place that timezone is applied.

The queries (`loadBreakfasts`, insert, update, delete) live in `src/lib/necroporra/`,
next to the ballot queries.

## Testing

- TDD on everything in `breakfast-log.ts`. That includes a month starting on a Monday, a
  month starting on a Sunday, February in a leap year, and the Madrid day boundary (23:30
  UTC on 31 Oct is already 1 Nov in Madrid).
- The actions: a `user` is refused, a collaborator succeeds, a future date is refused, and
  an edit or delete of a vanished id is answered rather than thrown.
- `portal-pages.test.tsx` renders the new page against PGlite. `seed-league.ts` gains a
  couple of entries, with **anonymised manager names**, since this is a public repo.
- Then break the code on purpose and watch the tests fail, and finish with
  `npx tsc --noEmit`, lint and `next build`, because green tests are not a typecheck.

## Out of scope

- A tally of breakfasts per manager. The list shows every entry, and a count was not asked
  for.
- Linking an entry to a round's duty, or showing who still owes one. Ruled out above.
- A photo of the breakfast.
- Notifications of any kind.

## Amendment, 2026-10-09: planned breakfasts

The owner asked, the same day, to be able to write breakfasts down **ahead of time**, so the
calendar can be used to plan them. It is still breakfasts only. Other kinds of event were
offered and turned down. This reverses "a date after today in Madrid is refused" above:

- **Any real day is accepted, past or future.** A breakfast dated after today (Madrid) is
  **planned**. It becomes history **on its own day, with nobody confirming it**. A
  confirmation step that gets forgotten once leaves a breakfast stuck between the two, and
  a breakfast that never happened is edited or deleted like any other mistake. Today
  counts as brought.
- The answer is in the future tense: "Planned: Bruno brings breakfast on Fri 16 Oct."
- In the grid a planned day keeps the alert border, but **dashed and unfilled**, and its
  accessible name ends in ", planned".
- The page draws two lists:
  - **"Coming up"**: the plans, soonest first. It is drawn only when there is a plan.
  - **"Every breakfast"**: the history, as before, without the plans.
- The header's count counts breakfasts brought, not breakfasts planned.
