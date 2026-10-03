import { inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { marketListings, players } from "@/lib/db/schema";
import type { FantasyClient, MarketListingRow } from "@/lib/fantasy-client";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type MarketClient = Pick<FantasyClient, "getMarket">;

export type MarketCapture = { captured: number; dropped: number; failed: boolean };

/**
 * Reads the league market and replaces `market_listings` with it.
 *
 * Never throws, the same ruling `captureLineups` gets and for the same reason: a missed read
 * costs one page a few hours of freshness, and the page says how old its market is. The
 * market log is the opposite ruling (see `runPlayerSweep`) because its window rolls on.
 *
 * An EMPTY read is treated as a failure and the previous market is kept. The daily auction
 * always holds players, so nothing on the market is far likelier a hiccup than a fact, and
 * believing it would blank the page until the next sweep.
 *
 * Delete-then-insert with no transaction (Neon HTTP has none): a failure between the two
 * leaves an empty market until the next sweep, which the page reports as never read.
 */
export async function captureMarket(db: Db, client: MarketClient, { now }: { now: Date }): Promise<MarketCapture> {
  let listings: MarketListingRow[];
  try {
    listings = await client.getMarket();
  } catch {
    return { captured: 0, dropped: 0, failed: true };
  }
  if (listings.length === 0) return { captured: 0, dropped: 0, failed: true };

  try {
    const byPlayer = new Map<string, MarketListingRow>();
    for (const row of listings) if (!byPlayer.has(row.playerId)) byPlayer.set(row.playerId, row);

    const known = new Set(
      (
        await db
          .select({ id: players.id })
          .from(players)
          .where(inArray(players.id, [...byPlayer.keys()]))
      ).map((row) => row.id),
    );
    const rows = [...byPlayer.values()].filter((row) => known.has(row.playerId));

    await db.delete(marketListings);
    if (rows.length > 0) {
      await db.insert(marketListings).values(rows.map((row) => ({ ...row, readAt: now })));
    }
    return { captured: rows.length, dropped: listings.length - rows.length, failed: false };
  } catch {
    return { captured: 0, dropped: 0, failed: true };
  }
}
