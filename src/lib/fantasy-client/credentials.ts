import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { leagueCredentials } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { open, seal } from "@/lib/crypto";

/** The single row's key. There is one league, so there is one credential. */
const ROW_ID = "league";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export async function loadRefreshToken(
  db: Db,
): Promise<{ refreshToken: string; clientId: string } | null> {
  const rows = await db.select().from(leagueCredentials).where(eq(leagueCredentials.id, ROW_ID));
  const row = rows[0];
  if (!row) return null;
  return { refreshToken: open(row.refreshTokenSealed), clientId: row.clientId };
}

export async function saveRefreshToken(
  db: Db,
  args: { refreshToken: string; clientId: string; updatedBy: string },
): Promise<void> {
  const values = {
    id: ROW_ID,
    refreshTokenSealed: seal(args.refreshToken),
    clientId: args.clientId,
    rotatedAt: new Date(),
    updatedBy: args.updatedBy,
  };
  await db.insert(leagueCredentials).values(values).onConflictDoUpdate({
    target: leagueCredentials.id,
    set: values,
  });
}
