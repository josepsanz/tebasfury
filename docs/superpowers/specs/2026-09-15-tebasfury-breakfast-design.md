# Who brings breakfast

Design, 2026-09-15.

## The rule, as the league plays it

Every round, **the team that finishes last brings breakfast**. Bringing it buys protection:
that team is **shielded for the next three rounds** and cannot be made to bring it again in
them, even if it finishes last — the obligation **walks up the table**: to the second from
bottom, and if that one is shielded too to the third from bottom, and on up until it finds
a team that is not shielded. **If several teams tie** at whatever height the walk stops,
**all of them bring it.**

**Somebody always brings breakfast.** That is the rule's own sentence and it outranks
everything below: no round ever ends with nobody carrying the bag.

Two readings settled with the owner on 2026-09-15, because the sentence above does not
decide them:

- **The shield is the three rounds AFTER the punishment.** Bring breakfast in round 5 and
  you are covered in 6, 7 and 8; round 9 exposes you again. Not "the round you brought it
  plus two".
- **A tie is decided on the round's POINTS**, not on the places the API publishes. See
  below — this is the one part of the rule the data actively lies about.

## What the data says, and where it lies

`buildRoundTable` already gives each team's points **for one round**. That is the figure
the rule turns on.

**The API's `roundPosition` cannot be used to find a tie.** Measured against production on
2026-09-09 and written into `buildRoundTable`'s own doc comment: a rank derived from the
round's points disagreed with the stored `roundPosition` seven times across four rounds,
and **every disagreement was a tie** — where two teams score the same, the API hands out
distinct sequential places by a tie-break it does not publish. So reading "last" off
`roundPosition` would name one team where the league's rule names two, and it would pick
the one the API happened to sort lower.

The rule therefore reads: **the lowest round POINTS among the unshielded, and everybody who
has them.**

## Only settled rounds count

A round still being played has no last place: the standings response reports the overall
table position rather than a rank within the round, and the points are still climbing. The
Necroporra already draws this line for the same reason and in the same words — `lastPlaced`
returns null while any row of the round is provisional.

So breakfast is worked out over **settled rounds only**. A live round shows no obligation:
it says the round is still being played, which is the truth and also the fun of it.

## The calculation

A fold over the settled rounds, oldest first — the obligation of round N depends on who
brought it in N-1, N-2 and N-3, so it cannot be answered for one round in isolation:

```
for each settled round R, in order:
  shielded(R)  = teams that brought breakfast in R-1, R-2 or R-3
  candidates   = every team with a row in R, minus shielded(R)
  if candidates is empty: candidates = every team with a row in R   // see below
  bringers(R)  = the candidates whose round points are the lowest — all of them, on a tie
  those bringers are shielded for R+1, R+2, R+3
```

Taking the lowest points among the unshielded IS walking up from the bottom until the walk
finds somebody unshielded — the same rule said two ways, and worth saying the second way in
the code's own comment, because that is the way the league says it out loud.

Cheap: thirteen teams across a season of thirty-eight rounds is five hundred rows, already
loaded by the page that draws the table.

Edge cases, decided here so the code does not have to guess:

- **A team with no row for the round** is absent from the calculation, not counted as zero:
  the round table already treats them that way, and being unlisted is not the same as
  finishing last.
- **If every team were shielded, the shield yields and the bottom brings it anyway.**
  Somebody always brings breakfast, so when the walk up the table runs out of table it
  starts again from the bottom with the shields ignored. This needs three consecutive
  rounds whose ties cover all thirteen teams, which is as close to impossible as the
  league gets — but "nobody eats" is not an outcome this rule has, so the code must not
  have one either.
- **A tie among the shielded changes nothing**: shielded teams are removed before the
  lowest score is looked for, so their points never enter it.

## Where it shows

**On the round table, `/standings?round=N`**: who brought breakfast that round, and which
teams were shielded from it.

**On the season standings**, the screen everybody opens: the same line for the **most recent
settled round**. That is the question the league actually asks on a Monday, and answering it
only behind the round picker would be hiding it.

The explicit sentence the owner asked for, in the league's own voice:

- One team: **"Round 5: LILTEAM brings breakfast."**
- A tie: **"Round 5: LILTEAM and TheMessias bring breakfast."** — every name, because the
  rule says every one of them brings it.
- A live round: **"Round 6 is still being played."**

In the table itself:

- The team or teams bringing breakfast are **marked on their row**, with a word and not
  only a colour — the same discipline the clause marks and the ideal-eleven star follow.
- A **shielded** team is marked differently, and its mark says how many rounds it has left:
  a reader looking at the bottom of the table needs to know why the last-placed team is not
  the one named.

## Out of scope

- **A season tally** — who has brought the most breakfasts. Obvious next question, and a
  separate slice; this one answers "who, this round".
- **Notifying anybody.** The portal shows it; the group chat does the shouting.
- **Editing it by hand.** If the league ever overrules the rule for a week, that is a
  conversation to have then, not a feature to guess at now.
