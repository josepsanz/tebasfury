/**
 * Captures the two responses this slice is built on, straight from the live API.
 *
 * Run it with the alias hook:
 *
 *   node --import ./scripts/register-alias.mjs scripts/capture-players-fixture.mts
 *
 * It needs a `.env.local` whose DATABASE_URL points at a database that already holds
 * a bootstrapped LaLiga credential (bootstrap one at /admin/sync first), and the
 * matching CREDENTIALS_KEY. It goes through `getAccessToken`, which persists the
 * rotated refresh token — exchanging the token by hand would invalidate the stored
 * one and cost someone a browser bootstrap.
 *
 * It writes a TRIMMED slice of the catalogue: eight hundred players is a large
 * fixture, and the slice keeps one player for every distinct position, every distinct
 * status and every distinct shape of `weekPoints`, so the committed file still
 * carries the whole shape.
 */
import { writeFileSync } from "node:fs";
import type { PlayerEntry } from "@/lib/fantasy-client/schemas";

// `@/lib/db` calls `getEnv()` at module load, and static imports are hoisted above
// every statement in the file — so the environment has to be loaded first and the
// application's modules imported dynamically, after it. (The line above is a type
// import: it is erased before the file runs and hoists nothing.)
process.loadEnvFile(".env.local");

const { db } = await import("@/lib/db");
const { getAccessToken } = await import("@/lib/fantasy-client");
const { playersSchema, squadSchema } = await import("@/lib/fantasy-client/schemas");
const { teams } = await import("@/lib/db/schema");

const BASE = "https://fantasy-api.llt-services.com/api";
const LEAGUE = process.env.LALIGA_LEAGUE_ID;
if (!LEAGUE) throw new Error("LALIGA_LEAGUE_ID must be set in .env.local");

const token = await getAccessToken(db);

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}: ${text.slice(0, 300)}`);
  console.log(`${path} → HTTP ${res.status}, ${text.length} bytes`);
  return JSON.parse(text);
}

const rawPlayers = await get(`/v1/competition/1/players`);

// Parsed BEFORE trimming, so a shape mismatch fails here against all eight hundred
// entries rather than silently against the dozen that get committed.
const players = playersSchema.parse(rawPlayers);
console.log(`parsed ${players.length} players`);
console.log("distinct positionId:", [...new Set(players.map((p) => p.positionId))].sort());
console.log("distinct playerStatus:", [...new Set(players.map((p) => p.playerStatus))].sort());
console.log(
  "weekPoints lengths:",
  [...new Set(players.map((p) => p.weekPoints.length))].sort((a, b) => a - b),
);
const disagreeing = players.filter(
  (p) => p.weekPoints.reduce((sum, w) => sum + w.points, 0) !== p.points,
);
console.log(`players whose weekPoints do not sum to points: ${disagreeing.length}`);

// `weekPoints` entries label themselves with a gameweek, and these three lines are
// the evidence that the label — not the array index — is what has to be read.
const weeks = (p: PlayerEntry) => p.weekPoints.map((w) => w.weekNumber);
console.log(
  "distinct weekNumber:",
  [...new Set(players.flatMap(weeks))].sort((a, b) => a - b),
);
console.log(
  "players whose weekPoints are not in ascending gameweek order:",
  players.filter((p) => weeks(p).some((w, i) => i > 0 && w < weeks(p)[i - 1])).length,
);
console.log(
  "players whose gameweeks are not exactly 1..n:",
  players.filter((p) =>
    [...weeks(p)].sort((a, b) => a - b).some((w, i) => w !== i + 1),
  ).length,
);

/**
 * What the fixture has to keep one of. A position or a status the map has never seen
 * would reach a view unrecognised; a `weekPoints` array that is empty, sparse or out
 * of order is the case an index-based reading gets wrong, so the fixture carries one
 * of each rather than a dozen dense arrays that would pin nothing.
 */
const FACETS: Record<string, (p: PlayerEntry) => unknown> = {
  positionId: (p) => p.positionId,
  playerStatus: (p) => p.playerStatus,
  weekPointsShape: (p) => {
    const own = weeks(p);
    if (own.length === 0) return "empty";
    if ([...own].sort((a, b) => a - b).some((w, i) => w !== i + 1)) return "sparse";
    return own.some((w, i) => i > 0 && w < own[i - 1]) ? "unordered" : "dense";
  },
};

// One entry per distinct value of each facet, deduplicated by id.
const wanted = new Map<string, unknown>();
const entries = rawPlayers as Record<string, unknown>[];
for (const facet of Object.values(FACETS)) {
  const seen = new Set<unknown>();
  for (const [i, parsed] of players.entries()) {
    const value = facet(parsed);
    if (seen.has(value)) continue;
    seen.add(value);
    wanted.set(parsed.id, entries[i]);
  }
}

writeFileSync(
  "src/lib/fantasy-client/__fixtures__/players.json",
  `${JSON.stringify([...wanted.values()], null, 2)}\n`,
);
console.log(`wrote ${wanted.size} players to the fixture`);

const [team] = await db.select().from(teams).limit(1);
if (!team) throw new Error("No team is stored yet — run a standings sync first");

const rawSquad = await get(`/v1/competition/1/leagues/${LEAGUE}/teams/${team.id}`);
const squad = squadSchema.parse(rawSquad);
console.log(`parsed a squad of ${squad.players.length} players`);

/** The anonymous owner every squad entry is attributed to in the fixture. */
const ANONYMOUS = { id: "9000020", managerName: "Manager I", avatar: "" };

type SquadEntry = { managerId: number; manager: typeof ANONYMOUS; playerMaster: object };

/**
 * Player names are public and stay; a manager's nickname is not, and the standings
 * fixtures scrub theirs for the same reason. `lastStats` goes with them: it is 111 of
 * the response's 136 kilobytes of per-match event counts, and nothing reads it —
 * the points this slice needs come from the catalogue's `weekPoints` instead.
 */
function scrubbed(raw: unknown): unknown {
  const copy = structuredClone(raw) as {
    id: string;
    managerId: number;
    manager: typeof ANONYMOUS;
    players: SquadEntry[];
    loanedPlayers: SquadEntry[];
  };
  copy.id = "9000019";
  copy.managerId = 9000020;
  copy.manager = { ...ANONYMOUS };
  for (const entry of [...copy.players, ...copy.loanedPlayers]) {
    entry.managerId = 9000020;
    entry.manager = { ...ANONYMOUS };
    delete (entry.playerMaster as { lastStats?: unknown }).lastStats;
  }
  return copy;
}

writeFileSync(
  "src/lib/fantasy-client/__fixtures__/squad.json",
  `${JSON.stringify(scrubbed(rawSquad), null, 2)}\n`,
);
