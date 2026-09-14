/**
 * Captures one real lineup response, straight from the live API.
 *
 * Run it with the alias hook:
 *
 *   node --import ./scripts/register-alias.mjs scripts/capture-lineup-fixture.mts
 *
 * It needs a `.env.local` whose DATABASE_URL points at a database that already holds
 * a bootstrapped LaLiga credential (bootstrap one at /admin/sync first). It goes
 * through `getAccessToken`, which persists the rotated refresh token — exchanging the
 * token by hand would invalidate the stored one and cost someone a browser bootstrap.
 */
import { writeFileSync } from "node:fs";

// `@/lib/db` calls `getEnv()` at module load and static imports hoist above every
// statement, so the environment is loaded first and the app's modules imported after it.
process.loadEnvFile(".env.local");

const { db } = await import("@/lib/db");
const { getAccessToken } = await import("@/lib/fantasy-client");
const { teams } = await import("@/lib/db/schema");

const BASE = "https://fantasy-api.llt-services.com/api";
const token = await getAccessToken(db);
const [team] = await db.select({ id: teams.id }).from(teams).limit(1);

const res = await fetch(`${BASE}/v1/competition/1/teams/${team.id}/lineup/week/4`, {
  headers: { authorization: `Bearer ${token}`, accept: "application/json" },
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const body = await res.json();

// `lastStats` is 90% of the payload and nothing reads it. Dropped from the fixture so the
// file stays readable, and NOT from the schema, which must keep tolerating it.
for (const line of ["goalkeeper", "defender", "midfield", "striker"]) {
  for (const player of body.formation[line] ?? []) delete player.playerMaster?.lastStats;
}
writeFileSync(
  "src/lib/fantasy-client/__fixtures__/lineup-week.json",
  `${JSON.stringify(body, null, 2)}\n`,
);
