import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { loadRefreshToken, saveRefreshToken } from "./credentials";
import { CredentialError } from "./errors";
import {
  currentWeekSchema,
  leaguesSchema,
  standingSchema,
  type CurrentWeek,
  type League,
  type StandingEntry,
} from "./schemas";

export { CredentialError, CREDENTIAL_ERROR_NAME } from "./errors";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const TOKEN_URL =
  "https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token" +
  "?p=B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
};

/**
 * Exchanges the stored refresh token for a 24-hour access token.
 *
 * The rotated refresh token is persisted BEFORE the access token is returned.
 * Losing a rotation costs a manual browser bootstrap, so the write comes first.
 */
export async function getAccessToken(db: Db): Promise<string> {
  const stored = await loadRefreshToken(db);
  if (!stored) throw new CredentialError("No LaLiga credential has been stored yet");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: stored.clientId,
      scope: `openid ${stored.clientId} offline_access`,
      refresh_token: stored.refreshToken,
    }),
  });

  if (!res.ok) {
    throw new CredentialError(`The identity provider refused the refresh token (${res.status})`);
  }

  const body = (await res.json()) as TokenResponse;
  if (!body.access_token) throw new CredentialError("The token response carried no access token");

  if (body.refresh_token) {
    await saveRefreshToken(db, {
      refreshToken: body.refresh_token,
      clientId: stored.clientId,
      updatedBy: "sync",
    });
  }

  return body.access_token;
}

const API_BASE = "https://fantasy-api.llt-services.com/api";
const COMPETITION = "1"; // LaLiga EA Sports

/** Enough of the upstream body to diagnose a refusal, not enough to fill a column. */
const ERROR_BODY_LIMIT = 500;

/**
 * One GET, validated. The undecoded body comes back alongside the parsed value
 * because `raw_sync_payloads` archives it: the parse strips every field the schema
 * does not name, and those are exactly the fields worth having the next time the API
 * moves under us.
 */
async function request<T>(
  accessToken: string,
  path: string,
  schema: { parse: (v: unknown) => T },
): Promise<{ value: T; body: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!res.ok) {
    // The body is the whole diagnostic. Without it `sync_runs.error` records that
    // LaLiga objected but not what it objected to, which is precisely what is needed
    // the first time the API's shape or its routes move again.
    const detail = await res
      .text()
      .then((text) => text.slice(0, ERROR_BODY_LIMIT).trim())
      .catch(() => "");
    throw new Error(
      `LaLiga API answered ${res.status} for ${path}${detail === "" ? "" : `: ${detail}`}`,
    );
  }
  const body: unknown = await res.json();
  return { value: schema.parse(body), body };
}

async function apiGet<T>(
  accessToken: string,
  path: string,
  schema: { parse: (v: unknown) => T },
): Promise<T> {
  return (await request(accessToken, path, schema)).value;
}

/**
 * A gameweek, as the portal models it.
 *
 * The API's own vocabulary — `weekNumber`, `openingWeekDate` — stops at this
 * directory. What crosses the boundary is the portal's, so the next time the API
 * renames a field, one mapping changes rather than every caller.
 */
export type Gameweek = {
  number: number;
  isLive: boolean;
  opensAt: Date;
  closesAt: Date;
};

/**
 * One team's row in a standing, as the portal models it.
 *
 * `weekPoints` is THE WEEK'S OWN SCORE, and producing it honestly is the reason this
 * mapping exists. The two standing endpoints disagree about what `points` means, and
 * only this module is in a position to know:
 *
 * - `/standing` (live) — `points` is the season total INCLUDING the round in play.
 *   Verified across all 13 entries of the captured response:
 *   `points === team.teamPoints + livePoints`.
 * - `/standing/{week}` (settled) — `points` is that week's own score (0–60 in the
 *   capture).
 *
 * Handing a caller the raw entry hands it that trap. It took it once: a season
 * cumulative was written into a per-week column, and the live table showed the wrong
 * leader on roughly double everyone's points.
 */
export type StandingRow = {
  teamId: string;
  managerId: number;
  managerName: string;
  /** Points scored in the week this standing describes. */
  weekPoints: number;
  /**
   * Rank within the round, or null when the response cannot say. A live response's
   * `position` is the OVERALL table position, not the rank inside the round, so it is
   * not recorded as one.
   */
  roundPosition: number | null;
  /** Points accumulated so far in a round in play; null for a settled week. */
  livePoints: number | null;
  /** Current state at the moment of the call — NOT the state at the week asked for. */
  teamValue: number;
  teamPoints: number;
};

function toGameweek(week: CurrentWeek): Gameweek {
  return {
    number: week.weekNumber,
    isLive: week.isLive,
    opensAt: week.openingWeekDate,
    closesAt: week.closingWeekDate,
  };
}

/** The part of an entry that means the same thing in both responses. */
function identity(entry: StandingEntry) {
  return {
    teamId: entry.team.id,
    managerId: entry.team.managerId,
    managerName: entry.team.manager.managerName,
    teamValue: entry.team.teamValue,
    teamPoints: entry.team.teamPoints,
  };
}

function fromSettledEntry(entry: StandingEntry): StandingRow {
  return {
    ...identity(entry),
    weekPoints: entry.points,
    roundPosition: entry.position,
    livePoints: null,
  };
}

function fromLiveEntry(entry: StandingEntry): StandingRow {
  // `livePoints` is the round's own score. Should the field ever be absent, the
  // identity verified across the capture recovers it — and yields 0 for a team that
  // has not started the round, which is the truthful answer in that case too.
  const scored = entry.livePoints ?? entry.points - entry.team.teamPoints;
  return { ...identity(entry), weekPoints: scored, roundPosition: null, livePoints: scored };
}

export async function getCurrentWeek(accessToken: string): Promise<Gameweek> {
  return toGameweek(
    await apiGet(accessToken, `/v1/competition/${COMPETITION}/week/current`, currentWeekSchema),
  );
}

export function getLeagues(accessToken: string): Promise<League[]> {
  return apiGet(accessToken, `/v1/competition/${COMPETITION}/leagues?x-lang=es`, leaguesSchema);
}

/**
 * A standing, mapped, with the response it was mapped from.
 *
 * `raw` is typed `unknown` on purpose: the sync archives it and never reads it, so
 * the API's shape still stops at this directory.
 */
export type Standing = { rows: StandingRow[]; raw: unknown };

/** Omit `week` for the live table; pass one to read a settled gameweek. */
export async function getStanding(
  accessToken: string,
  leagueId: string,
  week?: number,
): Promise<Standing> {
  const live = week === undefined;
  const { value, body } = await request(
    accessToken,
    `/v1/competition/${COMPETITION}/leagues/${leagueId}/standing${live ? "" : `/${week}`}`,
    standingSchema,
  );
  return { rows: value.map(live ? fromLiveEntry : fromSettledEntry), raw: body };
}

/** The narrow surface a sync run needs, in mapped rows rather than API entries. */
export type FantasyClient = {
  getCurrentWeek(): Promise<Gameweek>;
  getStanding(week?: number): Promise<Standing>;
};

/** Exchanges the credential once and binds it, so one run means one token exchange. */
export async function createClient(db: Db, leagueId: string): Promise<FantasyClient> {
  const accessToken = await getAccessToken(db);
  return {
    getCurrentWeek: () => getCurrentWeek(accessToken),
    getStanding: (week) => getStanding(accessToken, leagueId, week),
  };
}
