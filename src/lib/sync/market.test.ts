import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/lib/db/testing";
import { marketListings, players } from "@/lib/db/schema";
import type { MarketListingRow } from "@/lib/fantasy-client";
import { captureMarket } from "./market";

const now = new Date("2026-10-03T17:45:00Z");
const closes = new Date("2026-10-04T17:00:00Z");

const listing = (playerId: string, over: Partial<MarketListingRow> = {}): MarketListingRow => ({
  playerId,
  kind: "league",
  sellerTeamId: null,
  expiresAt: closes,
  bids: 0,
  ...over,
});

const client = (rows: MarketListingRow[] | Error) => ({
  getMarket: async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  },
});

describe("captureMarket", () => {
  let h: TestDatabase;
  beforeAll(async () => {
    h = await createTestDatabase();
    await h.db.insert(players).values(
      ["a", "b", "c"].map((id) => ({ id, nickname: id, position: "Midfielder", realTeamId: "rt1", status: "ok" })),
    );
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.db.delete(marketListings);
  });

  it("replaces the whole market with what the read returned", async () => {
    await captureMarket(h.db, client([listing("a"), listing("b")]), { now });
    const result = await captureMarket(
      h.db,
      client([listing("c", { kind: "team", sellerTeamId: "t9", bids: null })]),
      { now },
    );
    expect(result).toEqual({ captured: 1, dropped: 0, failed: false });
    const rows = await h.db.select().from(marketListings);
    expect(rows).toEqual([
      { playerId: "c", kind: "team", sellerTeamId: "t9", expiresAt: closes, bids: null, readAt: now },
    ]);
  });

  it("drops a player the catalogue has never seen instead of failing on the foreign key", async () => {
    const result = await captureMarket(h.db, client([listing("a"), listing("zzz")]), { now });
    expect(result).toEqual({ captured: 1, dropped: 1, failed: false });
  });

  it("keeps the previous market when the read fails", async () => {
    await captureMarket(h.db, client([listing("a")]), { now });
    const result = await captureMarket(h.db, client(new Error("503")), { now });
    expect(result).toEqual({ captured: 0, dropped: 0, failed: true });
    expect(await h.db.select().from(marketListings)).toHaveLength(1);
  });

  it("keeps the previous market when the read comes back empty", async () => {
    // The daily auction always holds players, so an empty market reads as a hiccup.
    await captureMarket(h.db, client([listing("a")]), { now });
    const result = await captureMarket(h.db, client([]), { now });
    expect(result).toEqual({ captured: 0, dropped: 0, failed: true });
    expect(await h.db.select().from(marketListings)).toHaveLength(1);
  });

  it("keeps one row per player if the API names one twice", async () => {
    const result = await captureMarket(h.db, client([listing("a"), listing("a", { bids: 3 })]), { now });
    expect(result.captured).toBe(1);
  });
});
