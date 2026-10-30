import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { marketOperations, players, teams, user } from "@/lib/db/schema";
import { loadRulings, saveRuling } from "./rulings";

let h: TestDatabase;
const NOW = new Date("2026-10-30T10:00:00Z");

beforeEach(async () => {
  h = await createTestDatabase();
  await h.db.insert(user).values({ id: "u1", name: "Ada A", email: "ada@example.com" });
  await h.db.insert(teams).values([{ id: "t1", managerId: 1, managerName: "Ada", userId: "u1" }]);
  const forward = { position: "forward", realTeamId: "r1", status: "ok" };
  await h.db.insert(players).values([
    { id: "p1", nickname: "Forward 1", ...forward },
    { id: "p2", nickname: "Forward 2", ...forward },
  ]);
  // p1 held two days, a breach. p2 held eight, a clean sale and the control.
  const op = (id: string, activityType: number, playerId: string, occurredAt: string) => ({
    id,
    activityType,
    actorManagerId: 1,
    playerId,
    amount: 1_000_000,
    occurredAt: new Date(occurredAt),
  });
  await h.db.insert(marketOperations).values([
    op("buy1", 31, "p1", "2026-09-01T10:00:00Z"),
    op("sell1", 33, "p1", "2026-09-03T10:00:00Z"),
    op("buy2", 31, "p2", "2026-09-01T10:00:00Z"),
    op("sell2", 33, "p2", "2026-09-09T10:00:00Z"),
  ]);
});
afterEach(async () => {
  await h.close();
});

const save = (input: { saleId: string; status: string; note?: string }) =>
  saveRuling(h.db, { input: { note: "", ...input }, now: NOW, recordedBy: "u1" });

describe("saveRuling", () => {
  it("rules on a breach and says whose sale it was", async () => {
    expect(await save({ saleId: "sell1", status: "waived", note: "Agreed at dinner" })).toEqual({
      ok: true,
      message: "Ada's sale of Forward 1: Excused.",
    });
    expect(await loadRulings(h.db)).toEqual(
      new Map([["sell1", { status: "waived", note: "Agreed at dinner" }]]),
    );
  });

  it("replaces an earlier ruling rather than adding a second", async () => {
    await save({ saleId: "sell1", status: "waived", note: "Agreed at dinner" });
    await save({ saleId: "sell1", status: "remedied" });
    expect(await loadRulings(h.db)).toEqual(new Map([["sell1", { status: "remedied", note: null }]]));
  });

  it("refuses a sale that broke no rule, and writes nothing", async () => {
    expect(await save({ saleId: "sell2", status: "waived" })).toEqual({
      ok: false,
      message: "That sale is not a breach of the five-day rule.",
    });
    expect((await loadRulings(h.db)).size).toBe(0);
  });

  it("refuses a status the league does not have", async () => {
    expect(await save({ saleId: "sell1", status: "forgiven" })).toEqual({
      ok: false,
      message: "That is not a status the league uses.",
    });
  });
});
