import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { teams, user } from "@/lib/db/schema";
import {
  claimTeam,
  isUniqueViolation,
  loadClaimBoard,
  loadMyTeam,
  releaseTeam,
  releaseTeamAsAdmin,
} from "./index";

let h: TestDatabase;

beforeEach(async () => {
  h = await createTestDatabase();
  await h.db.insert(user).values([
    { id: "alice", name: "Alice", email: "alice@example.com" },
    { id: "bruno", name: "Bruno", email: "bruno@example.com" },
  ]);
  await h.db.insert(teams).values([
    { id: "t1", managerId: 1, managerName: "La rataneta" },
    { id: "t2", managerId: 2, managerName: "LamineTheTuareg" },
    { id: "t3", managerId: 3, managerName: "La Agustineta 96" },
  ]);
});

afterEach(async () => {
  await h.close();
});

const ownerOf = async (teamId: string) => {
  const [row] = await h.db.select().from(teams).where(eq(teams.id, teamId));
  return row.userId;
};

describe("claimTeam", () => {
  it("gives a free team to whoever asks first", async () => {
    expect(await claimTeam(h.db, { userId: "alice", teamId: "t1" })).toBe("claimed");
    expect(await ownerOf("t1")).toBe("alice");
  });

  it("refuses a team somebody else holds, and leaves that holder in place", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await claimTeam(h.db, { userId: "bruno", teamId: "t1" })).toBe("taken");
    expect(await ownerOf("t1")).toBe("alice");
  });

  it("refuses a second team, and moves neither row", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await claimTeam(h.db, { userId: "alice", teamId: "t2" })).toBe(
      "already-claimed-another",
    );
    expect(await ownerOf("t1")).toBe("alice");
    expect(await ownerOf("t2")).toBeNull();
  });

  it("reports a re-claim of your own team as the second team it is", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await claimTeam(h.db, { userId: "alice", teamId: "t1" })).toBe(
      "already-claimed-another",
    );
    expect(await ownerOf("t1")).toBe("alice");
  });

  it("decides the race in the statement: the second claim writes nothing", async () => {
    // PGlite is in-process and single-connection, so this is NOT two simultaneous
    // claims. What it proves is the property the guarantee rests on — the second
    // statement matches no row — which is what makes the real race safe.
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    const outcome = await claimTeam(h.db, { userId: "bruno", teamId: "t1" });
    expect(outcome).toBe("taken");
    expect(await ownerOf("t1")).toBe("alice");
  });

  // isUniqueViolation exists for the branch above: two genuinely concurrent claims
  // by the SAME user for two DIFFERENT free teams can both pass `NOT EXISTS` before
  // either commits, and `teams_user_id_unique` is what actually stops the loser, by
  // raising SQLSTATE 23505. PGlite is single-connection and in-process, so no
  // sequential call through claimTeam can reach that error — its own `NOT EXISTS`
  // clause always catches a second call first. So this provokes the real violation
  // directly against the index instead, the same way src/lib/db/schema.test.ts does,
  // and checks the predicate against whatever drizzle actually throws.
  it("recognises a real unique-violation thrown by drizzle against PGlite", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });

    let caught: unknown;
    try {
      await h.db.update(teams).set({ userId: "alice" }).where(eq(teams.id, "t2"));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isUniqueViolation(caught)).toBe(true);
  });

  it("does not mistake an unrelated error for a unique violation", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });
});

describe("releaseTeam", () => {
  it("frees whatever the caller holds, and lets the next person take it", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await releaseTeam(h.db, { userId: "alice" })).toBe("released");
    expect(await ownerOf("t1")).toBeNull();
    expect(await claimTeam(h.db, { userId: "bruno", teamId: "t1" })).toBe("claimed");
  });

  it("says so when there is nothing to release, and writes nothing", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await releaseTeam(h.db, { userId: "bruno" })).toBe("nothing-to-release");
    expect(await ownerOf("t1")).toBe("alice");
  });
});

describe("releaseTeamAsAdmin", () => {
  it("frees a claim the caller does not hold", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await releaseTeamAsAdmin(h.db, { teamId: "t1" })).toBe("released");
    expect(await ownerOf("t1")).toBeNull();
  });

  it("says so when the team was already free", async () => {
    expect(await releaseTeamAsAdmin(h.db, { teamId: "t2" })).toBe("nothing-to-release");
  });
});

describe("the reads the views need", () => {
  it("lists every team with its claim, ordered by manager name", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await loadClaimBoard(h.db)).toEqual([
      { teamId: "t3", managerName: "La Agustineta 96", claimedBy: null },
      { teamId: "t1", managerName: "La rataneta", claimedBy: "alice" },
      { teamId: "t2", managerName: "LamineTheTuareg", claimedBy: null },
    ]);
  });

  it("names the caller's own team, and nothing when they have none", async () => {
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });
    expect(await loadMyTeam(h.db, { userId: "alice" })).toEqual({
      teamId: "t1",
      managerName: "La rataneta",
    });
    expect(await loadMyTeam(h.db, { userId: "bruno" })).toBeNull();
  });
});

describe("a claim and the sync that runs afterwards", () => {
  it("survives the team upsert the standings sync performs", async () => {
    // Ruling 7. runSync's upsert sets managerName and nothing else; the day somebody
    // widens that `set` clause, every claim in the league would be wiped on the next
    // sync and no other test would notice.
    await claimTeam(h.db, { userId: "alice", teamId: "t1" });

    const { upsertTeams } = await import("@/lib/sync");
    // upsertTeams returns an array of unexecuted drizzle query promises (lazy —
    // they run on `.then()`), exactly like runSync's own `for (const write of
    // upsertTeams(...)) await write` at src/lib/sync/index.ts:74. Awaiting the
    // array itself would not execute a single query.
    await Promise.all(
      upsertTeams(h.db, [
        {
          teamId: "t1",
          managerId: 1,
          managerName: "La rataneta renamed",
          weekPoints: 40,
          roundPosition: 1,
          livePoints: null,
          teamValue: 1,
          teamPoints: 1,
        },
      ]),
    );

    const [row] = await h.db.select().from(teams).where(eq(teams.id, "t1"));
    expect(row.managerName).toBe("La rataneta renamed");
    expect(row.userId).toBe("alice");
  });
});
