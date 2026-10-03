/**
 * Captures the league market this slice is built on, straight from the live API.
 *
 * Run it with the alias hook and type transforms (`errors.ts` uses parameter properties,
 * which Node's default strip-only mode rejects):
 *
 *   node --experimental-transform-types --import ./scripts/register-alias.mjs scripts/capture-market-fixture.mts
 *
 * It needs a `.env.local` whose DATABASE_URL points at a database holding a bootstrapped
 * LaLiga credential, and the matching CREDENTIALS_KEY. It goes through `getAccessToken`,
 * which persists the rotated refresh token.
 *
 * TRIMMED to the first entry of each `discr`: the shape varies by kind, not by volume.
 * Note the path: `league`, singular, unlike every other league route.
 */
import { writeFileSync } from "node:fs";

process.loadEnvFile(".env.local");

const { db } = await import("@/lib/db");
const { getAccessToken } = await import("@/lib/fantasy-client");

const BASE = "https://fantasy-api.llt-services.com/api";
const LEAGUE = process.env.LALIGA_LEAGUE_ID?.replace(/^"|"$/g, "");
if (!LEAGUE) throw new Error("LALIGA_LEAGUE_ID must be set in .env.local");

const token = await getAccessToken(db);
const res = await fetch(`${BASE}/v1/competition/1/league/${LEAGUE}/market`, {
  headers: { authorization: `Bearer ${token}`, accept: "application/json" },
});
const text = await res.text();
if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);

const entries = JSON.parse(text) as Record<string, unknown>[];
const seen = new Set<unknown>();
const trimmed = entries.filter((entry) => {
  if (seen.has(entry.discr)) return false;
  seen.add(entry.discr);
  return true;
});
/** The anonymous manager every listing is attributed to in the fixture. */
const ANONYMOUS = { id: "9000020", managerName: "Manager I", avatar: "" };

/**
 * Player names are public and stay; a manager's nickname is not, and the standings and
 * squad fixtures scrub theirs for the same reason. A manager's listing names its seller
 * twice — once as `playerTeam.manager`, once as `sellerTeam.manager` — and carries the
 * seller's team id and manager id besides, so every `manager` block in the tree becomes
 * the same anonymous one, and the seller's team gets a fake id. The first capture forgot
 * this and nearly shipped a real nickname to a public repository: the step lives here so
 * that a recapture never can.
 */
function scrubbed(raw: Record<string, unknown>[]): unknown {
  const copy = structuredClone(raw);
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === "manager" && value !== null && typeof value === "object") {
        record[key] = { ...ANONYMOUS };
      } else {
        walk(value);
      }
    }
  };
  walk(copy);
  for (const entry of copy) {
    const seller = entry.sellerTeam as { id?: string; managerId?: number } | undefined;
    if (!seller) continue;
    seller.id = "9000019";
    seller.managerId = 9000020;
  }
  return copy;
}

writeFileSync(
  "src/lib/fantasy-client/__fixtures__/market.json",
  `${JSON.stringify(scrubbed(trimmed), null, 2)}\n`,
);
console.log(`wrote ${trimmed.length} entries of ${entries.length}, one per discr:`, [...seen]);
process.exit(0);
