/**
 * Captures the league activity feed this slice is built on, straight from the live API.
 *
 * Run it with the alias hook:
 *
 *   node --import ./scripts/register-alias.mjs scripts/capture-activity-fixture.mts
 *
 * It needs a `.env.local` whose DATABASE_URL points at a database holding a
 * bootstrapped LaLiga credential, and the matching CREDENTIALS_KEY. It goes through
 * `getAccessToken`, which persists the rotated refresh token — exchanging the token by
 * hand would invalidate the stored one and cost someone a browser bootstrap.
 *
 * It writes a TRIMMED fixture: the feed is a rolling seven-day window of about a
 * hundred entries, and what the tests need is one entry of every distinct
 * `activityTypeId`, because the SHAPE varies by type and the volume does not.
 */
import { writeFileSync } from "node:fs";

process.loadEnvFile(".env.local");

const { db } = await import("@/lib/db");
const { getAccessToken } = await import("@/lib/fantasy-client");
const { activitySchema } = await import("@/lib/fantasy-client/schemas");

const BASE = "https://fantasy-api.llt-services.com/api";
const LEAGUE = process.env.LALIGA_LEAGUE_ID;
if (!LEAGUE) throw new Error("LALIGA_LEAGUE_ID must be set in .env.local");

const token = await getAccessToken(db);
const res = await fetch(`${BASE}/v1/competition/1/leagues/${LEAGUE}/activity`, {
  headers: { authorization: `Bearer ${token}`, accept: "application/json" },
});
const text = await res.text();
if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);

const raw: unknown = JSON.parse(text);
// Parsed BEFORE trimming, so a shape mismatch fails here against the whole feed rather
// than silently against the handful of entries that get committed.
const parsed = activitySchema.parse(raw);
console.log(`parsed ${parsed.length} entries`);
console.log("distinct activityTypeId:", [...new Set(parsed.map((a) => a.activityTypeId))].sort((a, b) => a - b));

const entries = raw as Record<string, unknown>[];
const seen = new Set<unknown>();
const trimmed = entries.filter((entry) => {
  if (seen.has(entry.activityTypeId)) return false;
  seen.add(entry.activityTypeId);
  return true;
});
writeFileSync(
  "src/lib/fantasy-client/__fixtures__/activity.json",
  `${JSON.stringify(trimmed, null, 2)}\n`,
);
console.log(`wrote ${trimmed.length} entries, one per type`);
