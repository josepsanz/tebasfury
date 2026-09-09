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
  loadVoters,
  loadVoterNames,
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
    await castVotes(h.db, { gameweek: 5, userId: "alice", picks: ["t2", "t3"], now: BEFORE });
    expect(await loadMyBallot(h.db, { gameweek: 5, userId: "alice" })).toMatchObject({
      firstTeamId: "t2",
      secondTeamId: "t3",
    });
  });

  it("records a single pick, leaving the other slot empty", async () => {
    await castVotes(h.db, { gameweek: 5, userId: "alice", picks: ["t2"], now: BEFORE });
    expect(await loadMyBallot(h.db, { gameweek: 5, userId: "alice" })).toMatchObject({
      firstTeamId: "t2",
      secondTeamId: null,
    });
  });

  it("replaces a pair rather than adding to it, in one statement", async () => {
    // The reason the pair lives in one row: Neon's HTTP driver has no transactions, so
    // delete-then-insert would leave a window with no votes at all, opened for exactly
    // the person who was mid-change.
    await castVotes(h.db, { gameweek: 5, userId: "alice", picks: ["t2", "t3"], now: BEFORE });
    await castVotes(h.db, { gameweek: 5, userId: "alice", picks: ["t3"], now: BEFORE });

    const ballots = await loadBallots(h.db, [5]);
    expect(ballots).toHaveLength(1);
    expect(ballots[0]).toMatchObject({ firstTeamId: "t3", secondTeamId: null });
  });

  it("keeps voters apart", async () => {
    await castVotes(h.db, { gameweek: 5, userId: "alice", picks: ["t2"], now: BEFORE });
    await castVotes(h.db, { gameweek: 5, userId: "bruno", picks: ["t3"], now: BEFORE });
    expect(await loadBallots(h.db, [5])).toHaveLength(2);
  });

  it("refuses the same team twice at the table, not only in the domain", async () => {
    // The check constraint. The domain protects the person; this protects the table from
    // any future caller that forgets to ask.
    await expect(
      castVotes(h.db, { gameweek: 5, userId: "alice", picks: ["t2", "t2"], now: BEFORE }),
    ).rejects.toThrow();
  });

  it("reads back nothing for a voter who has not voted", async () => {
    expect(await loadMyBallot(h.db, { gameweek: 5, userId: "bruno" })).toBeNull();
  });

  it("asks for no rounds and gets no ballots, without hitting the database", async () => {
    expect(await loadBallots(h.db, [])).toEqual([]);
  });
});

describe("loadVoterNames", () => {
  it("prefers the manager name, which is how the league knows each other", async () => {
    const names = await loadVoterNames(h.db);
    expect(names.get("alice")).toBe("La rataneta");
  });

  it("falls back to the account name for somebody holding no team", async () => {
    // So a past round's ballot never renders as a bare id after a team is released.
    const names = await loadVoterNames(h.db);
    expect(names.get("bruno")).toBe("Bruno B");
  });
});

describe("loadVoters", () => {
  it("is every manager who has claimed a team, in name order", async () => {
    await h.db.update(teams).set({ userId: "bruno" }).where(eq(teams.id, "t3"));
    const voters = await loadVoters(h.db);
    expect(voters).toEqual([
      { userId: "bruno", name: "La Agustineta 96" },
      { userId: "alice", name: "La rataneta" },
    ]);
  });

  it("leaves out unclaimed teams, which have nobody to vote for them", async () => {
    const voters = await loadVoters(h.db);
    expect(voters).toEqual([{ userId: "alice", name: "La rataneta" }]);
  });
});
