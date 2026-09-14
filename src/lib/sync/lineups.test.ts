import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { gameweeks, players, roundLineupPlayers, roundLineups, teams } from "@/lib/db/schema";
import type { LineupRow } from "@/lib/fantasy-client";
import { captureLineups, type LineupClient } from "./lineups";

const NOW = new Date("2026-09-14T04:00:00Z");

/**
 * A client that records every call it gets, so a test can assert exactly which
 * (team, week) pairs were asked for and in what order.
 *
 * `failFor` fails only that one team's lineup, leaving the others to succeed — the
 * fixture for "one team's failure does not cost the rest".
 */
function fakeClient(
  opts: { points?: number; playerIds?: string[]; failFor?: string } = {},
): LineupClient & { asked: { teamId: string; week: number }[] } {
  const asked: { teamId: string; week: number }[] = [];
  const playerIds = opts.playerIds ?? ["p1"];

  return {
    asked,
    getLineup: async (teamId: string, week: number): Promise<LineupRow> => {
      asked.push({ teamId, week });
      if (opts.failFor === teamId) {
        throw new Error(`lineup fetch failed for ${teamId}`);
      }
      return {
        teamId,
        gameweek: week,
        formation: "1-4-4-2",
        points: opts.points ?? 0,
        snapshotTookOn: NOW,
        players: playerIds.map((playerId) => ({
          playerId,
          line: "midfield" as const,
          weekPoints: 0,
          inIdeal: false,
        })),
      };
    },
  };
}

describe("captureLineups", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.db.delete(roundLineupPlayers);
    await h.db.delete(roundLineups);
    await h.db.delete(gameweeks);
    await h.db.delete(teams);
    await h.db.delete(players);
    // A fixed roster of players so a fielded id always satisfies
    // `round_lineup_players.player_id`'s foreign key to `players.id`.
    await h.db.insert(players).values(
      ["p1", "p2", "p3"].map((id) => ({
        id,
        nickname: id,
        position: "Midfielder",
        realTeamId: "rt1",
        status: "ok",
      })),
    );
  });

  it("asks only for weeks that have started", async () => {
    // The league's ruling, enforced where it cannot be forgotten: `gameweeks` gets a row
    // when a week goes live, so a week with no row is a week nobody may see yet.
    await h.db.insert(gameweeks).values([
      { number: 4, isLive: false },
      { number: 5, isLive: true },
    ]);
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Ana" });

    const client = fakeClient();
    await captureLineups(h.db, client, { now: NOW });

    expect(client.asked).toEqual([
      { teamId: "t1", week: 4 },
      { teamId: "t1", week: 5 },
    ]);
  });

  it("asks once for a settled week and never again", async () => {
    // A frozen lineup cannot change, and thirteen calls a week against an unofficial API
    // are the whole budget of this feature.
    await h.db.insert(gameweeks).values([
      { number: 4, isLive: false },
      { number: 5, isLive: true },
    ]);
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Ana" });

    const first = fakeClient();
    await captureLineups(h.db, first, { now: NOW });
    const second = fakeClient();
    const counts = await captureLineups(h.db, second, { now: NOW });

    expect(second.asked).toEqual([{ teamId: "t1", week: 5 }]);
    expect(counts).toMatchObject({ captured: 1, skipped: 1 });
  });

  it("asks again for the live week, because its points are still climbing", async () => {
    await h.db.insert(gameweeks).values({ number: 5, isLive: true });
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Ana" });

    await captureLineups(h.db, fakeClient({ points: 12 }), { now: NOW });
    await captureLineups(h.db, fakeClient({ points: 48 }), { now: NOW });

    const [stored] = await h.db.select().from(roundLineups);
    expect(stored.points).toBe(48);
  });

  it("replaces the eleven rather than adding to it", async () => {
    // The one place a stale row could survive: an upsert keyed on the player leaves behind
    // anybody who was dropped from the lineup between two fetches of a live round.
    await h.db.insert(gameweeks).values({ number: 5, isLive: true });
    await h.db.insert(teams).values({ id: "t1", managerId: 1, managerName: "Ana" });

    await captureLineups(h.db, fakeClient({ playerIds: ["p1", "p2"] }), { now: NOW });
    await captureLineups(h.db, fakeClient({ playerIds: ["p1", "p3"] }), { now: NOW });

    const rows = await h.db.select().from(roundLineupPlayers);
    expect(rows.map((r) => r.playerId).sort()).toEqual(["p1", "p3"]);
  });

  it("keeps the other twelve when one team's lineup fails", async () => {
    // Deliberately NOT the ruling `getActivity` gets. A lost lineup costs a page section
    // and the next sweep asks again; a lost market operation is gone for good, because the
    // feed's window will have rolled past it.
    await h.db.insert(gameweeks).values({ number: 5, isLive: true });
    await h.db.insert(teams).values([
      { id: "t1", managerId: 1, managerName: "Ana" },
      { id: "t2", managerId: 2, managerName: "Bruno" },
    ]);

    const client = fakeClient({ failFor: "t1" });
    const counts = await captureLineups(h.db, client, { now: NOW });

    expect(counts).toMatchObject({ captured: 1, failed: 1 });
    expect(await h.db.select().from(roundLineups)).toHaveLength(1);
  });
});
