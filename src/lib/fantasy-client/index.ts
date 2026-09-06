import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { loadRefreshToken, saveRefreshToken } from "./credentials";
import {
  currentWeekSchema,
  leaguesSchema,
  standingSchema,
  type CurrentWeek,
  type League,
  type StandingEntry,
} from "./schemas";

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

/**
 * The credential is missing, or the provider refused it. This is a distinct state
 * from a transport failure: recovering needs a person and a browser, so the admin
 * page names it rather than showing a generic error.
 */
export class CredentialError extends Error {}

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

async function apiGet<T>(
  accessToken: string,
  path: string,
  schema: { parse: (v: unknown) => T },
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`LaLiga API answered ${res.status} for ${path}`);
  }
  return schema.parse(await res.json());
}

export function getCurrentWeek(accessToken: string): Promise<CurrentWeek> {
  return apiGet(accessToken, `/v1/competition/${COMPETITION}/week/current`, currentWeekSchema);
}

export function getLeagues(accessToken: string): Promise<League[]> {
  return apiGet(accessToken, `/v1/competition/${COMPETITION}/leagues?x-lang=es`, leaguesSchema);
}

/** Omit `week` for the live table; pass one to read a settled gameweek. */
export function getStanding(
  accessToken: string,
  leagueId: string,
  week?: number,
): Promise<StandingEntry[]> {
  const suffix = week === undefined ? "" : `/${week}`;
  return apiGet(
    accessToken,
    `/v1/competition/${COMPETITION}/leagues/${leagueId}/standing${suffix}`,
    standingSchema,
  );
}

/** The narrow surface a sync run needs. Task 6 injects a fake shaped like this. */
export type FantasyClient = {
  getCurrentWeek(): Promise<CurrentWeek>;
  getStanding(week?: number): Promise<StandingEntry[]>;
};

/** Exchanges the credential once and binds it, so one run means one token exchange. */
export async function createClient(db: Db, leagueId: string): Promise<FantasyClient> {
  const accessToken = await getAccessToken(db);
  return {
    getCurrentWeek: () => getCurrentWeek(accessToken),
    getStanding: (week) => getStanding(accessToken, leagueId, week),
  };
}
