import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { teams, user } from "@/lib/db/schema";
import {
  castVotes,
  loadBallots,
  loadMyBallot,
  loadRound,
  loadRounds,
  loadEntererNames,
  loadVoters,
  openRound,
} from "./index";

let h: TestDatabase;

const KICKOFF = new Date("2026-09-11T19:00:00Z");
const BEFORE = new Date("2026-09-10T12:00:00Z");
const AFTER = new Date("2026-09-12T12:00:00Z");

beforeEach(async () => {
  h = await createTestDatabase();
  await h.db.insert(user).values([
    { id: "alice", name: "Alice A", email: "alice@example.com" },
    { id: "bruno", name: "Bruno B", email: "bruno@example.com" },
  ]);
  await h.db.insert(teams).values([
    { id: "t1", managerId: 1, managerName: "La rataneta", userId: "alice" },
    { id: "t2", managerId: 2, managerName: "LamineTheTuareg" },
    { id: "t3", managerId: 3, managerName: "La Agustineta 96" },
  ]);
});

afterEach(async () => {
  await h.close();
});

describe("openRound", () => {
  it("names a round the first time it is asked", async () => {
    await openRound(h.db, { gameweek: 5, closesAt: KICKOFF, now: BEFORE });
    expect((await loadRound(h.db, 5))?.closesAt).toEqual(KICKOFF);
  });

  it("is idempotent, because the sync calls it on every run", async () => {
    await openRound(h.db, { gameweek: 5, closesAt: KICKOFF, now: BEFORE });
    await openRound(h.db, { gameweek: 5, closesAt: KICKOFF, now: BEFORE });
    expect(await loadRounds(h.db)).toHaveLength(1);
  });

  it("follows a kickoff that moves while voting is still open", async () => {
    const moved = new Date("2026-09-11T21:00:00Z");
    await openRound(h.db, { gameweek: 5, closesAt: KICKOFF, now: BEFORE });
    await openRound(h.db, { gameweek: 5, closesAt: moved, now: BEFORE });
    expect((await loadRound(h.db, 5))?.closesAt).toEqual(moved);
  });

  it("never reopens a round that has already closed", async () => {
    // The rule this whole `where` clause exists for: reopening voting after the fact
    // would let somebody vote on a round they had already watched being played.
    await openRound(h.db, { gameweek: 5, closesAt: KICKOFF, now: BEFORE });
    await openRound(h.db, {
      gameweek: 5,
      closesAt: new Date("2026-09-20T19:00:00Z"),
      now: AFTER,
    });
    expect((await loadRound(h.db, 5))?.closesAt).toEqual(KICKOFF);
  });

  it("has no round for a gameweek nobody has opened", async () => {
    expect(await loadRound(h.db, 9)).toBeNull();
  });
});

describe("castVotes", () => {
  beforeEach(async () => {
    await openRound(h.db, { gameweek: 5, closesAt: KICKOFF, now: BEFORE });
  });

  it("records a pair", async () => {
    await castVotes(h.db, { gameweek: 5, teamId: "t1", picks: ["t2", "t3"], now: BEFORE, enteredBy: null });
    expect(await loadMyBallot(h.db, { gameweek: 5, teamId: "t1" })).toMatchObject({
      firstTeamId: "t2",
      secondTeamId: "t3",
    });
  });

  it("records a single pick, leaving the other slot empty", async () => {
    await castVotes(h.db, { gameweek: 5, teamId: "t1", picks: ["t2"], now: BEFORE, enteredBy: null });
    expect(await loadMyBallot(h.db, { gameweek: 5, teamId: "t1" })).toMatchObject({
      firstTeamId: "t2",
      secondTeamId: null,
    });
  });

  it("replaces a pair rather than adding to it, in one statement", async () => {
    // The reason the pair lives in one row: Neon's HTTP driver has no transactions, so
    // delete-then-insert would leave a window with no votes at all, opened for exactly
    // the person who was mid-change.
    await castVotes(h.db, { gameweek: 5, teamId: "t1", picks: ["t2", "t3"], now: BEFORE, enteredBy: null });
    await castVotes(h.db, { gameweek: 5, teamId: "t1", picks: ["t3"], now: BEFORE, enteredBy: null });

    const ballots = await loadBallots(h.db, [5]);
    expect(ballots).toHaveLength(1);
    expect(ballots[0]).toMatchObject({ firstTeamId: "t3", secondTeamId: null });
  });

  it("keeps teams apart", async () => {
    await castVotes(h.db, { gameweek: 5, teamId: "t1", picks: ["t2"], now: BEFORE, enteredBy: null });
    await castVotes(h.db, { gameweek: 5, teamId: "t3", picks: ["t2"], now: BEFORE, enteredBy: null });
    expect(await loadBallots(h.db, [5])).toHaveLength(2);
  });

  it("refuses the same team twice at the table, not only in the domain", async () => {
    // The check constraint. The domain protects the person; this protects the table from
    // any future caller that forgets to ask.
    await expect(
      castVotes(h.db, { gameweek: 5, teamId: "t1", picks: ["t2", "t2"], now: BEFORE, enteredBy: null }),
    ).rejects.toThrow();
  });

  it("refuses a team picking itself at the table, which the row can finally say", async () => {
    // Before the re-key the table had no idea whose ballot it was, so this rule lived in
    // the domain alone. Now it is a check constraint as well.
    await expect(
      castVotes(h.db, { gameweek: 5, teamId: "t1", picks: ["t1"], now: BEFORE, enteredBy: null }),
    ).rejects.toThrow();
  });

  it("records who entered a ballot on somebody's behalf", async () => {
    await castVotes(h.db, {
      gameweek: 5,
      teamId: "t2",
      picks: ["t1"],
      now: BEFORE,
      enteredBy: "alice",
    });

    const [ballot] = await loadBallots(h.db, [5]);
    expect(ballot).toMatchObject({
      teamId: "t2",
      firstTeamId: "t1",
      enteredBy: "alice",
      castAt: BEFORE,
    });
  });

  it("clears the mark when the manager replaces what was typed for them", async () => {
    // The row says who spoke LAST. A manager correcting an entered ballot owns it from
    // that moment, and the page must stop saying otherwise.
    await castVotes(h.db, { gameweek: 5, teamId: "t2", picks: ["t1"], now: BEFORE, enteredBy: "alice" });
    await castVotes(h.db, { gameweek: 5, teamId: "t2", picks: ["t3"], now: BEFORE, enteredBy: null });

    const [ballot] = await loadBallots(h.db, [5]);
    expect(ballot.enteredBy).toBeNull();
  });

  it("reads back nothing for a team that has not voted", async () => {
    expect(await loadMyBallot(h.db, { gameweek: 5, teamId: "t2" })).toBeNull();
  });

  it("asks for no rounds and gets no ballots, without hitting the database", async () => {
    expect(await loadBallots(h.db, [])).toEqual([]);
  });
});

describe("loadVoters", () => {
  it("is every team in the league, in name order", async () => {
    // Including the ones nobody has claimed. Holding a team is what makes somebody a
    // voter; having an account is what lets them vote for themselves, and those are
    // different questions — the second is what an admin answers on their behalf.
    const voters = await loadVoters(h.db);
    expect(voters).toEqual([
      { teamId: "t3", name: "La Agustineta 96" },
      { teamId: "t1", name: "La rataneta" },
      { teamId: "t2", name: "LamineTheTuareg" },
    ]);
  });

  it("does not change when a team is claimed, because the claim is not what makes a voter", async () => {
    await h.db.update(teams).set({ userId: "bruno" }).where(eq(teams.id, "t3"));
    expect(await loadVoters(h.db)).toHaveLength(3);
  });
});

describe("loadEntererNames", () => {
  it("names the admins who entered ballots, and nobody else", async () => {
    // The account name, not a manager name: whoever typed a ballot for somebody else is
    // acting as themselves, and may hold no team at all — this league's admin does not.
    const names = await loadEntererNames(h.db, ["alice"]);
    expect(names.get("alice")).toBe("Alice A");
    expect(names.has("bruno")).toBe(false);
  });

  it("asks for nobody and gets nobody, without hitting the database", async () => {
    expect(await loadEntererNames(h.db, [])).toEqual(new Map());
  });
});
