# Necroporra Proxy Ballots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin record the Necroporra ballot of any team, including the two that have no portal account, by moving the vote from the account to the team.

**Architecture:** `necroporra_votes` is re-keyed from `(gameweek, user_id)` to `(gameweek, team_id)`, so every team is a voter whether or not anybody has claimed it. A nullable `entered_by` records the admin who typed a ballot on somebody's behalf, and is drawn on the page for everyone to see. Authority is one pure function, `canCastFor`, checked in the server action; the control lives in the ballot list that already shows all thirteen managers.

**Tech Stack:** Next.js 16 App Router (server actions), Drizzle ORM 0.45 on Neon (no transactions — single-statement writes), better-auth access control, Vitest + PGlite for integration tests, React 19 client components for the form.

**Spec:** `docs/superpowers/specs/2026-09-14-tebasfury-necroporra-proxy-votes-design.md`

## Global Constraints

- **English only**, including every UI string, comment and commit message.
- **No transactions.** The Neon HTTP driver has none: every write that must not tear is ONE statement (`onConflictDoUpdate`, conditional `UPDATE`). Never delete-then-insert.
- **TDD.** Write the test, run it, watch it fail for the right reason, then implement. `pnpm vitest run <file>` for one file.
- **The suite needs `pnpm vitest run --maxWorkers=2`** on a machine short of memory; the default worker count gets PGlite files SIGKILLed.
- **`pnpm test` does not typecheck.** `npx tsc --noEmit` and `pnpm build` are the checks that catch type errors; run both before declaring a task done.
- **The migration is applied by a human**, never by this plan. Task 1 produces the SQL; `docs/deployment.md` tells the owner when to run it.
- Comments explain **why**, in the voice of the surrounding file. Do not narrate what the code plainly does.

---

### Task 1: The vote belongs to the team

The whole re-key, in one commit, because nothing here compiles without the rest of it: the schema, the migration, the domain's key, the data layer, and the two consumers that pass names around. No new capability yet — after this task the portal behaves exactly as it does today, with an unclaimed team showing as a manager who has not voted.

**Files:**
- Modify: `src/lib/db/schema.ts` (the `necroporraVotes` table)
- Create: `drizzle/0013_necroporra_votes_by_team.sql` (+ the snapshot `drizzle-kit generate` writes beside it)
- Modify: `src/lib/domain/necroporra.ts`, `src/lib/domain/necroporra.test.ts`
- Modify: `src/lib/necroporra/index.ts`, `src/lib/necroporra/index.test.ts`
- Modify: `src/app/(portal)/necroporra/page.tsx`, `src/app/(portal)/necroporra/actions.ts`
- Modify: `src/components/necroporra-ballots.tsx`, `src/components/necroporra-ballots.test.tsx`
- Modify: `docs/deployment.md`

**Done 2026-09-14, commit `198b5cd`.** One deviation from the steps below: it took TWO
migrations, `0013_necroporra_vote_team_columns` and `0014_necroporra_votes_by_team`, not
one. `drizzle-kit generate` stops to ask whether a removed column and an added one are a
rename, and it asks through a TUI that cannot be answered from this tooling; splitting the
change into a diff that only adds and a diff that only removes avoids the question
entirely and keeps generation reproducible. The hand-written backfill lives in `0013`.

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Ballot = { gameweek: number; teamId: string; firstTeamId: string | null; secondTeamId: string | null; enteredBy: string | null }`; `Voter = { teamId: string; name: string }`; `SeasonRow = { teamId: string; name: string; points: number; rounds: number }`; `RoundBallot = { teamId: string; name: string; picks: string[]; hit: boolean; enteredBy: string | null }`; `castVotes(db, { gameweek, teamId, picks, now, enteredBy })`; `loadVoters(db): Promise<Voter[]>` returning **every** team; `loadMyBallot(db, { gameweek, teamId })`.

- [x] **Step 1: Re-key the table in the schema**

In `src/lib/db/schema.ts`, replace the `necroporraVotes` definition's key columns and add the two new things. Keep the existing doc comment about two columns rather than two rows, and add the paragraphs below to it.

```ts
export const necroporraVotes = pgTable(
  "necroporra_votes",
  {
    gameweek: integer("gameweek").notNull(),
    /**
     * Whose ballot this is — the TEAM, not the account.
     *
     * Two of the thirteen managers have no portal account and vote in the group chat, so
     * an account-keyed row had nowhere to put what they said. Keying on the team also
     * means a manager's history survives their claim: the votes an admin entered for them
     * are already theirs the day they sign in.
     */
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    firstTeamId: text("first_team_id").references(() => teams.id, { onDelete: "set null" }),
    secondTeamId: text("second_team_id").references(() => teams.id, { onDelete: "set null" }),
    /**
     * The admin who typed this ballot for somebody else, or null when the manager cast it.
     *
     * Who, not whether: it costs the same nullable column and answers the question the
     * league will actually ask. The page draws it for everyone, which is the price of
     * being allowed to enter a ballot after the round has closed.
     */
    enteredBy: text("entered_by").references(() => user.id, { onDelete: "set null" }),
    castAt: timestamp("cast_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.gameweek, table.teamId] }),
    check(
      "necroporra_votes_distinct_teams",
      sql`${table.firstTeamId} is null or ${table.secondTeamId} is null or ${table.firstTeamId} <> ${table.secondTeamId}`,
    ),
    // Only expressible now that the row knows whose ballot it is. The domain protects the
    // person with the same rule; this protects the table.
    check(
      "necroporra_votes_not_own_team",
      sql`(${table.firstTeamId} is null or ${table.firstTeamId} <> ${table.teamId}) and (${table.secondTeamId} is null or ${table.secondTeamId} <> ${table.teamId})`,
    ),
  ],
);
```

- [x] **Step 2: Generate the migration, then write its SQL by hand**

Run: `pnpm drizzle-kit generate --name necroporra_votes_by_team`

It writes `drizzle/0013_necroporra_votes_by_team.sql` and a snapshot under `drizzle/meta/`. **Keep the snapshot; replace the SQL entirely** with the version below. Drizzle cannot know the backfill, and its generated order would add a `NOT NULL` column to a table with eleven rows in it.

```sql
ALTER TABLE "necroporra_votes" ADD COLUMN "team_id" text;--> statement-breakpoint
UPDATE "necroporra_votes" v SET "team_id" = t."id" FROM "teams" t WHERE t."user_id" = v."user_id";--> statement-breakpoint
ALTER TABLE "necroporra_votes" ALTER COLUMN "team_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD COLUMN "entered_by" text;--> statement-breakpoint
ALTER TABLE "necroporra_votes" DROP CONSTRAINT "necroporra_votes_gameweek_user_id_pk";--> statement-breakpoint
ALTER TABLE "necroporra_votes" DROP CONSTRAINT "necroporra_votes_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "necroporra_votes" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_gameweek_team_id_pk" PRIMARY KEY("gameweek","team_id");--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "necroporra_votes" ADD CONSTRAINT "necroporra_votes_not_own_team" CHECK (("necroporra_votes"."first_team_id" is null or "necroporra_votes"."first_team_id" <> "necroporra_votes"."team_id") and ("necroporra_votes"."second_team_id" is null or "necroporra_votes"."second_team_id" <> "necroporra_votes"."team_id"));
```

The `SET NOT NULL` is third on purpose: a vote whose voter has released their team stops the migration instead of being silently dropped.

- [x] **Step 3: Prove the SQL applies**

Run: `pnpm vitest run src/lib/db/queries.test.ts`

Expected: PASS. Every integration test builds its database by running `drizzle/` through PGlite (`src/lib/db/testing.ts`), so a migration that does not apply turns the whole integration suite red. This proves the DDL; it does **not** prove the backfill, which runs against an empty table here. The backfill is checked against production in Task 5.

- [x] **Step 4: Re-key the domain's tests**

In `src/lib/domain/necroporra.test.ts`, replace every `userId` in a `Ballot`, `Voter` or `SeasonRow` with `teamId`, and add `enteredBy: null` to the ballots the fixtures build. Add this test to the `roundBallots` block:

```ts
it("returns a team nobody has claimed, so an absent manager is still a row", () => {
  const voters = [
    { teamId: "t-1", name: "Ana" },
    { teamId: "t-2", name: "Bruno" },
  ];
  const ballots = [
    { gameweek: 5, teamId: "t-1", firstTeamId: "t-2", secondTeamId: null, enteredBy: null },
  ];

  const rows = roundBallots(voters, ballots, 5, null);

  expect(rows.map((row) => row.name)).toEqual(["Ana", "Bruno"]);
  expect(rows[1]).toMatchObject({ teamId: "t-2", picks: [] });
});
```

And this one to the `seasonTable` block:

```ts
it("scores a ballot an admin entered exactly like one its manager cast", () => {
  const ballots = [
    { gameweek: 5, teamId: "t-1", firstTeamId: "t-3", secondTeamId: null, enteredBy: "u-admin" },
  ];

  const table = seasonTable(ballots, [{ gameweek: 5, lastTeamId: "t-3" }], new Map([["t-1", "Ana"]]));

  expect(table).toEqual([{ teamId: "t-1", name: "Ana", points: 1, rounds: 1 }]);
});
```

- [x] **Step 5: Run the domain tests to verify they fail**

Run: `pnpm vitest run src/lib/domain/necroporra.test.ts`

Expected: FAIL — TypeScript-shaped failures about `teamId` not existing on the fixtures' types are fine here; what matters is that the assertions keyed on `teamId` do not pass yet.

- [x] **Step 6: Re-key the domain**

In `src/lib/domain/necroporra.ts`: `Ballot` gains `teamId` in place of `userId` and a `enteredBy: string | null`; `Voter` becomes `{ teamId: string; name: string }`; `SeasonRow` and `RoundBallot` swap `userId` for `teamId`; `RoundBallot` gains `enteredBy: string | null`, taken from the ballot that produced it (null for a manager who has not voted). `scoreRound`, `seasonTable` and `roundBallots` change only what they key on. Update the doc comment on `loadVoters`' counterpart rule in `roundBallots` to say that a team with no account is returned like any other.

`validatePair` does not change.

- [x] **Step 7: Run the domain tests to verify they pass**

Run: `pnpm vitest run src/lib/domain/necroporra.test.ts`
Expected: PASS.

- [x] **Step 8: Re-key the data layer's tests**

In `src/lib/necroporra/index.test.ts`, replace the `userId` arguments to `castVotes` and `loadMyBallot` with `teamId`, and drop the `loadVoterNames` block entirely. Add:

```ts
it("records who entered a ballot on somebody's behalf", async () => {
  await h.db.insert(teams).values({ id: "t-1", managerId: 1, managerName: "Ana" });
  await h.db.insert(teams).values({ id: "t-2", managerId: 2, managerName: "Bruno" });

  await castVotes(h.db, {
    gameweek: 5,
    teamId: "t-1",
    picks: ["t-2"],
    now: CAST_AT,
    enteredBy: "u-admin",
  });

  const [ballot] = await loadBallots(h.db, [5]);
  expect(ballot).toMatchObject({ teamId: "t-1", firstTeamId: "t-2", enteredBy: "u-admin" });
});

it("clears the entered-by mark when the manager replaces the ballot themselves", async () => {
  // The row says who spoke last. A manager correcting what was typed for them is the
  // manager's own vote from that moment on, and the page must stop saying otherwise.
  await castVotes(h.db, { gameweek: 5, teamId: "t-1", picks: ["t-2"], now: CAST_AT, enteredBy: "u-admin" });
  await castVotes(h.db, { gameweek: 5, teamId: "t-1", picks: ["t-3"], now: CAST_AT, enteredBy: null });

  const [ballot] = await loadBallots(h.db, [5]);
  expect(ballot.enteredBy).toBeNull();
});

it("counts every team as a voter, claimed or not", async () => {
  const voters = await loadVoters(h.db);
  expect(voters.map((v) => v.teamId)).toContain("t-2");
});
```

(The fixtures in this file already create teams and users; follow whatever `beforeEach` it has rather than inventing a second style. `u-admin` must exist in `user` for the foreign key — insert it beside the others.)

- [x] **Step 9: Run the data-layer tests to verify they fail**

Run: `pnpm vitest run src/lib/necroporra/index.test.ts`
Expected: FAIL — `castVotes` does not accept `teamId` or `enteredBy` yet.

- [x] **Step 10: Re-key the data layer**

In `src/lib/necroporra/index.ts`:

```ts
export async function castVotes(
  db: Db,
  {
    gameweek,
    teamId,
    picks,
    now,
    enteredBy,
  }: {
    gameweek: number;
    teamId: string;
    picks: string[];
    now: Date;
    enteredBy: string | null;
  },
): Promise<void> {
  const [firstTeamId = null, secondTeamId = null] = picks;
  await db
    .insert(necroporraVotes)
    .values({ gameweek, teamId, firstTeamId, secondTeamId, enteredBy, castAt: now })
    .onConflictDoUpdate({
      target: [necroporraVotes.gameweek, necroporraVotes.teamId],
      // `enteredBy` is in the SET on purpose: the row records who spoke LAST. A manager
      // replacing what an admin typed for them owns the ballot from that moment.
      set: { firstTeamId, secondTeamId, enteredBy, castAt: now },
    });
}
```

`loadBallots` and `loadMyBallot` select `teamId` and `enteredBy` instead of `userId`; `loadMyBallot` takes `{ gameweek, teamId }`.

```ts
/**
 * Who may be voted for: every team in the league.
 *
 * It used to be every team with a claim, because a vote hung off an account. The vote
 * hangs off the team now, so a manager with no account is a voter who cannot yet vote for
 * themselves — and the page says exactly that by showing their row with no picks.
 */
export async function loadVoters(db: Db): Promise<Voter[]> {
  const rows = await db
    .select({ teamId: teams.id, name: teams.managerName })
    .from(teams);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
```

Delete `loadVoterNames` and its import of `user`.

- [x] **Step 11: Run the data-layer tests to verify they pass**

Run: `pnpm vitest run src/lib/necroporra/index.test.ts`
Expected: PASS.

- [x] **Step 12: Follow the key through the page, the action and the list**

Nothing new, just the same key everywhere:

- `src/app/(portal)/necroporra/page.tsx`: drop the `loadVoterNames` call and build the name map from `voters` (`new Map(voters.map((v) => [v.teamId, v.name]))`) for `seasonTable`. `loadMyBallot` takes `{ gameweek, teamId: myTeam.teamId }`. The season table's `key` and its "this is you" highlight compare `row.teamId === myTeam?.teamId`. `NecroporraBallots` gets `viewerTeamId={myTeam?.teamId ?? null}`.
- `src/components/necroporra-ballots.tsx`: the prop `viewerId: string` becomes `viewerTeamId: string | null`, and `row.userId` becomes `row.teamId` in the key, the highlight and the name colour. Update its test file's props to match.
- `src/app/(portal)/necroporra/actions.ts`: `castVotes(db, { gameweek, teamId: myTeam.teamId, picks, now, enteredBy: null })`. Nothing else changes in this task — authority arrives in Task 3.

- [x] **Step 13: Record the migration in the deployment doc**

Add a section to `docs/deployment.md` after the `0012` one, in the voice of the sections around it:

```markdown
### `0013` — the Necroporra votes by team, and it must go in BEFORE the code

`0013` re-keys `necroporra_votes` from `(gameweek, user_id)` to `(gameweek, team_id)`,
backfills the existing rows through `teams.user_id`, adds `entered_by`, and drops
`user_id`.

**It drops a column the running code still writes**, so the order is not negotiable and
the window is not permanent: apply it while **no round is open**, then deploy. A round is
open from the moment a sync names it until that gameweek kicks off, and `/necroporra`
shows at the top which state the league is in. Between the migration and the deploy the
Necroporra page is the only thing that breaks, and only for whoever loads it in those two
minutes.

Verify the backfill before the deploy, not after:

```sql
select count(*) as votes, count(team_id) as mapped from necroporra_votes;
```

Both figures must be equal. If `mapped` is short, a voter released their team — the
migration will have stopped at `SET NOT NULL` and nothing was dropped.
```

- [x] **Step 14: Verify the whole tree**

Run: `npx tsc --noEmit` → no output.
Run: `pnpm vitest run --maxWorkers=2` → all files pass.
Run: `pnpm lint` → no output.
Run: `pnpm build` → compiles.

- [x] **Step 15: Commit**

```bash
git add -A
git commit -m "refactor: a Necroporra vote belongs to the team, not the account"
```

---

### Task 2: Entering a ballot is an admin's alone

**Files:**
- Modify: `src/lib/auth/permissions.ts`
- Modify: `src/lib/auth/permissions.test.ts`

**Done 2026-09-14.**

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the permission `{ poll: ["voteFor"] }`, which Tasks 3 and 4 check through `decideAccess`.

- [x] **Step 1: Write the failing tests**

In `src/lib/auth/permissions.test.ts`:

```ts
it("lets an admin enter another manager's ballot", () => {
  expect(roles.admin.authorize({ poll: ["voteFor"] }).success).toBe(true);
});

it("refuses a collaborator, who may close a round but not speak in a manager's name", () => {
  // The first poll action that is NOT in `collaboratorGrants`, so the admin role has to
  // name it. This test is what stops it being lost the next time the roles are tidied.
  expect(roles.collaborator.authorize({ poll: ["voteFor"] }).success).toBe(false);
});

it("refuses a manager", () => {
  expect(roles.user.authorize({ poll: ["voteFor"] }).success).toBe(false);
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/auth/permissions.test.ts`
Expected: FAIL — `voteFor` is not an action on `poll`.

- [x] **Step 3: Add the action to the statement and to the admin role only**

In `src/lib/auth/permissions.ts`, extend the statement and override `poll` on the admin:

```ts
export const statement = {
  ...defaultStatements,
  /** `voteFor` is entering somebody else's ballot; see the admin role for why it is not a collaborator's. */
  poll: ["create", "publish", "close", "resolve", "voteFor"],
  ...
} as const;

const admin = ac.newRole({
  ...collaboratorGrants,
  /**
   * The one poll action a collaborator does not get. Closing a round and speaking in
   * another manager's name are different sizes of act — the same line `access: ["manage"]`
   * draws just above. Spelled out rather than inherited, so it cannot be widened by
   * accident when `collaboratorGrants` grows.
   */
  poll: [...collaboratorGrants.poll, "voteFor"],
  access: ["manage"],
  ...adminAc.statements,
});
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/auth/permissions.test.ts src/lib/auth/access-decision.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: entering another manager's ballot is an admin's alone"
```

---

### Task 3: Who may cast for whom

**Files:**
- Modify: `src/lib/domain/necroporra.ts`, `src/lib/domain/necroporra.test.ts`
- Modify: `src/app/(portal)/necroporra/actions.ts`

**Done 2026-09-14.** The form field is `forTeamId`, not `teamId` as the prose above said:
the picks themselves are posted as repeated `teamId` entries, so a target named `teamId`
would be read back by `formData.getAll("teamId")` as a third pick.

**Interfaces:**
- Consumes: `castVotes(db, { gameweek, teamId, picks, now, enteredBy })` from Task 1; `{ poll: ["voteFor"] }` from Task 2.
- Produces: `canCastFor({ teamId, mayCastForOthers }, teamId: string): boolean`; the action `vote(formData)` reading an optional `teamId` field.

- [x] **Step 1: Write the failing tests for the rule**

In `src/lib/domain/necroporra.test.ts`:

```ts
describe("canCastFor", () => {
  it("lets a manager cast for their own team", () => {
    expect(canCastFor({ teamId: "t-1", mayCastForOthers: false }, "t-1")).toBe(true);
  });

  it("refuses a manager casting for somebody else", () => {
    expect(canCastFor({ teamId: "t-1", mayCastForOthers: false }, "t-2")).toBe(false);
  });

  it("lets an admin cast for any team", () => {
    expect(canCastFor({ teamId: "t-1", mayCastForOthers: true }, "t-2")).toBe(true);
  });

  it("lets an admin with no team of their own cast for a team", () => {
    // The portal's owner need not be a manager. An admin who has claimed nothing still
    // has to be able to enter what the group chat said.
    expect(canCastFor({ teamId: null, mayCastForOthers: true }, "t-2")).toBe(true);
  });

  it("refuses somebody with neither a team nor the permission", () => {
    expect(canCastFor({ teamId: null, mayCastForOthers: false }, "t-2")).toBe(false);
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/domain/necroporra.test.ts`
Expected: FAIL — `canCastFor is not a function`.

- [x] **Step 3: Implement the rule**

In `src/lib/domain/necroporra.ts`:

```ts
/**
 * Whether this actor may record a ballot for this team.
 *
 * Two ways to be allowed and no third: it is your own team, or you hold the permission to
 * enter somebody else's. Pure, so the page and the action ask the same question of the
 * same function rather than each deciding for themselves — the control being hidden is a
 * courtesy, and this is the control.
 */
export function canCastFor(
  actor: { teamId: string | null; mayCastForOthers: boolean },
  teamId: string,
): boolean {
  if (actor.teamId !== null && actor.teamId === teamId) return true;
  return actor.mayCastForOthers;
}
```

- [x] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/lib/domain/necroporra.test.ts`
Expected: PASS.

- [x] **Step 5: Rewrite the action around the target team**

In `src/app/(portal)/necroporra/actions.ts`. The existing refusal texts stay; add one for the two new refusals.

```ts
export async function vote(formData: FormData): Promise<VoteResult> {
  const session = await requireSession();

  const gameweek = Number(formData.get("gameweek"));
  if (!Number.isInteger(gameweek)) return { ok: false, message: "No round was named." };

  const now = new Date();
  const round = await loadRound(db, gameweek);
  // The deadline moves for an entered ballot; the round's existence does not. A gameweek
  // nobody opened a round for was never a poll.
  if (round === null) return { ok: false, message: "No round exists for that gameweek." };

  const myTeam = await loadMyTeam(db, { userId: session.user.id });
  const mayCastForOthers = decideAccess(session, { poll: ["voteFor"] }).kind === "allow";

  // The form names the team when an admin is filling somebody's row in; a manager voting
  // for themselves sends nothing and gets their own.
  const asked = formData.get("forTeamId");
  const targetTeamId = typeof asked === "string" && asked !== "" ? asked : myTeam?.teamId ?? null;
  if (targetTeamId === null) {
    return { ok: false, message: "Claim your team first — the Necroporra is per manager." };
  }

  if (!canCastFor({ teamId: myTeam?.teamId ?? null, mayCastForOthers }, targetTeamId)) {
    return { ok: false, message: "That is not your ballot." };
  }

  const onBehalf = targetTeamId !== myTeam?.teamId;
  // Your own vote shuts at kickoff, whoever you are. An entered one does not: it was cast
  // elsewhere and on time, and only the typing is late — which is why the row says who
  // typed it, for everybody to see.
  if (!onBehalf && !isOpen(round, now)) {
    return { ok: false, message: "Voting for this round has closed." };
  }

  const picks = formData.getAll("teamId").map(String).filter((id) => id !== "");
  const { teams } = await loadSnapshots(db);
  const verdict = validatePair(picks, {
    ownTeamId: targetTeamId,
    teamIds: teams.map((t) => t.id),
  });
  if (!verdict.ok) return { ok: false, message: REFUSALS[verdict.reason] };

  await castVotes(db, {
    gameweek,
    teamId: targetTeamId,
    picks,
    now,
    enteredBy: onBehalf ? session.user.id : null,
  });
  revalidatePath("/necroporra");

  return { ok: true, message: onBehalf ? "Their picks are in." : "Your picks are in." };
}
```

`REFUSALS["own-team"]` currently reads "You cannot pick your own team." — change it to "That team cannot pick itself." so it is true of a ballot entered for somebody else.

Imports to add: `canCastFor` from the domain, `decideAccess` from `@/lib/auth/guards`.

- [x] **Step 6: Verify the tree**

Run: `npx tsc --noEmit` → no output.
Run: `pnpm vitest run --maxWorkers=2` → all pass.
Expected: the action has no test of its own — this repo tests server actions through their domain and data layers, both of which are covered. Task 5's manual walk is what exercises it end to end.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: an admin can record the ballot a manager sent by other means"
```

---

### Task 4: The row you can fill in

**Files:**
- Modify: `src/components/necroporra-ballots.tsx`, `src/components/necroporra-ballots.test.tsx`
- Modify: `src/components/necroporra-ballot.tsx`
- Modify: `src/app/(portal)/necroporra/page.tsx`

**Done 2026-09-14.** Three deviations worth knowing:

- The mark carries a DATE as well as a name, which meant `castAt` had to travel through
  `Ballot` and `RoundBallot` — the plan had only `enteredBy`. Without it the mark cannot
  show the one thing that matters about an entered ballot: whether it was typed after the
  round had closed.
- The control is a native `<details>`, not a button with state. The list stays a server
  component, the disclosure costs no JavaScript, and the keyboard works for free.
- `castForRow` as a curried builder tripped `react/display-name`, which was right: it was
  a component pretending to be a closure. It is `BallotForRow` at module scope now.

**Interfaces:**
- Consumes: `RoundBallot` with `teamId` and `enteredBy` (Task 1), `vote` accepting `forTeamId` (Task 3).
- Produces: nothing later tasks depend on.

- [x] **Step 1: Write the failing component tests**

In `src/components/necroporra-ballots.test.tsx` (it renders with `renderToStaticMarkup`, like `nav-links.test.tsx`):

```ts
it("names who entered a ballot, for everyone to read", () => {
  const html = renderToStaticMarkup(
    <NecroporraBallots
      rows={[{ teamId: "t-1", name: "Ana", picks: ["t-2"], hit: false, enteredBy: "u-admin" }]}
      teamName={new Map([["t-2", "Bruno"]])}
      enteredByName={new Map([["u-admin", "JM"]])}
      viewerTeamId={null}
      resolved={false}
      castFor={null}
    />,
  );
  expect(html).toContain("entered by JM");
});

it("says nothing extra about a ballot its own manager cast", () => {
  const html = renderToStaticMarkup(
    <NecroporraBallots
      rows={[{ teamId: "t-1", name: "Ana", picks: ["t-2"], hit: false, enteredBy: null }]}
      teamName={new Map([["t-2", "Bruno"]])}
      enteredByName={new Map()}
      viewerTeamId={null}
      resolved={false}
      castFor={null}
    />,
  );
  expect(html).not.toContain("entered by");
});

it("offers no control to a reader who may not enter ballots", () => {
  const html = renderToStaticMarkup(
    <NecroporraBallots
      rows={[{ teamId: "t-1", name: "Ana", picks: [], hit: false, enteredBy: null }]}
      teamName={new Map()}
      enteredByName={new Map()}
      viewerTeamId="t-9"
      resolved={false}
      castFor={null}
    />,
  );
  expect(html).not.toContain("Enter picks");
});
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/necroporra-ballots.test.tsx`
Expected: FAIL — the props do not exist and nothing renders "entered by".

- [x] **Step 3: Draw the mark and the control**

`NecroporraBallots` gains three props: `enteredByName: Map<string, string>`, `viewerTeamId: string | null` (renamed in Task 1), and

```ts
/**
 * What to render for a row an admin may fill in, or null for a reader who may not.
 *
 * A render prop rather than a boolean and a form built in here: this component is drawn
 * by a server component, and the form is a client one. Handing it down keeps the list a
 * server component and puts exactly one client boundary on the page.
 */
castFor: ((row: RoundBallot) => ReactNode) | null;
```

Each row renders, after the picks: the mark when `row.enteredBy` is set — `entered by {enteredByName.get(row.enteredBy) ?? "an admin"}` in `--board-ink-dim` at `11px`, no colour of its own — and `castFor?.(row)` when the prop is given.

`NecroporraBallot` gains an optional `forTeamId?: string` that it appends to the form data as `forTeamId`, and an optional `submitLabel?: string` defaulting to today's "Save my picks" (an admin filling in Ana's row should read "Save Ana's picks"). Nothing else about it changes: the same component, the same rules.

- [x] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/components/necroporra-ballots.test.tsx`
Expected: PASS.

- [x] **Step 5: Wire the page**

In `src/app/(portal)/necroporra/page.tsx`:

- Compute `const mayCastForOthers = decideAccess(session, { poll: ["voteFor"] }).kind === "allow";`
- Build `enteredByName` from the `user` rows the page already has? It does not have them — add a small `loadAdminNames(db)` to `src/lib/necroporra/index.ts` returning `Map<string, string>` of user id to name, and call it only when `mayCastForOthers || ballots.some((b) => b.enteredBy !== null)`. The mark is drawn for everyone, so the map is needed whenever any ballot carries one.
- Define one builder above the return, so the two lists differ only in the round they are
  drawing:

```tsx
const castForRow = (gameweek: number) => (row: RoundBallot) => (
  <NecroporraBallot
    gameweek={gameweek}
    forTeamId={row.teamId}
    submitLabel={`Save ${row.name}'s picks`}
    teams={teams.filter((team) => team.id !== row.teamId)}
    chosen={row.picks}
    action={vote}
  />
);
```

- Pass it to **both** lists: `castFor={mayCastForOthers ? castForRow(open.gameweek) : null}`
  on the open round's, and `castFor={mayCastForOthers ? castForRow(looking.gameweek) : null}`
  on the past round's. The past round's is the whole point of decision 2.

- [x] **Step 6: Verify the tree**

Run: `npx tsc --noEmit`, `pnpm vitest run --maxWorkers=2`, `pnpm lint`, `pnpm build`. All clean.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: fill in the ballot of a manager who voted in the group chat"
```

---

### Task 5: Walk it, then ship it

The signed-in path has no end-to-end net in this repo, so this task is the net. Nothing here is automated and nothing here is optional.

**Files:**
- Modify: `docs/deployment.md` (only if the walk finds something worth recording)

- [ ] **Step 1: Bring the portal up against the real database**

Run: `pnpm dev`, and open **http://localhost:3000** — not the LAN address. A wrong origin kills hydration and makes every POST fail with `INVALID_ORIGIN`, which looks exactly like a broken feature.

- [ ] **Step 2: Walk the eight checks**

1. As an admin, `/necroporra` shows **thirteen** rows in the ballot list, including the two teams nobody has claimed.
2. "Enter picks" appears on every row for the admin.
3. Entering a ballot for an unclaimed team saves, and the row shows the picks plus "entered by <you>".
4. The same round's ballots seen from a **manager's** account show the mark and **no** control.
5. On a **past, closed** round, the admin can still enter a ballot; a manager cannot vote in it at all.
6. A manager's own ballot for the open round still saves, and its row carries no mark.
7. A manager replacing a ballot an admin entered for them clears the mark.
8. The season table counts an entered ballot exactly like any other.

- [ ] **Step 3: Check the backfill against production**

Before the deploy, with the production `DATABASE_URL`:

```sql
select count(*) as votes, count(team_id) as mapped from necroporra_votes;
```

Both must read 11 (or whatever the vote count is by then). A shortfall means a voter released their team and the migration stopped; nothing was lost, but the plan needs a decision before it goes further.

- [ ] **Step 4: Hand over the deploy**

The migration is the owner's to run, and it runs **before** the code:

```bash
DATABASE_URL="<neon-url>" pnpm drizzle-kit migrate
git push origin main
```

Tell them plainly: apply it while no round is open, and the two commands belong in the same minute.

## Notes for the executor

- **Nothing in this plan touches the sync chains.** If `runSync` or either `/api/sync` route shows up in a diff, something has gone wrong.
- **The Necroporra is two tables, not a poll engine.** If a task starts to want a third, stop and ask: that argument was had and settled.
- **`enteredBy` is never set for your own ballot**, including an admin's own. The row says who spoke, and for your own vote that is you.
