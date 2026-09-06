import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { leagueCredentials } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { open, seal } from "@/lib/crypto";
import { CredentialError } from "./errors";

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
  try {
    return { refreshToken: open(row.refreshTokenSealed), clientId: row.clientId };
  } catch (cause) {
    // A rotated `CREDENTIALS_KEY` or a damaged ciphertext is a credential state, not
    // a bug: it is recovered by re-bootstrapping. Naming it as such is what makes the
    // admin page say so, instead of surfacing `Unsupported state or unable to
    // authenticate data` from deep inside `node:crypto`.
    throw new CredentialError(
      "The stored LaLiga credential could not be decrypted. CREDENTIALS_KEY has changed " +
        "since it was sealed, or the stored value is damaged; it has to be re-bootstrapped.",
      { cause },
    );
  }
}

/**
 * Whether a credential is stored, WITHOUT decrypting it.
 *
 * The admin page only needs to know whether there is something there. Decrypting to
 * test presence takes down the one screen that can re-bootstrap a credential, at
 * exactly the moment a key rotation makes it unreadable.
 */
export async function hasStoredCredential(db: Db): Promise<boolean> {
  const rows = await db
    .select({ id: leagueCredentials.id })
    .from(leagueCredentials)
    .where(eq(leagueCredentials.id, ROW_ID));
  return rows.length > 0;
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
