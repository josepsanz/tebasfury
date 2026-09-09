import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/lib/db/schema";
import { loadRefreshToken, saveRefreshToken } from "./credentials";
import { CredentialError } from "./errors";
import {
  activitySchema,
  currentWeekSchema,
  leaguesSchema,
  playersSchema,
  squadSchema,
  standingSchema,
  type ActivityEntry,
  type CurrentWeek,
  type League,
  type PlayerEntry,
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

/**
 * The API numbers positions; a catalogue prints words. An unrecognised id falls back
 * to the number as a string rather than to "unknown", because the number is a fact
 * and "unknown" is not. The capture used every one of these five.
 */
const POSITIONS: Record<number, string> = {
  1: "Goalkeeper",
  2: "Defender",
  3: "Midfielder",
  4: "Forward",
  5: "Coach",
};

/**
 * One gameweek's score for a player, carrying the gameweek it belongs to.
 *
 * The gameweek is part of the value because the API's array cannot be trusted to be
 * one: its entries arrive out of order, and a club that has played its sixth fixture
 * and not its fourth reports gameweeks 1, 2, 3, 6. Handing on a bare `number[]` would
 * hand on the invitation to read the fourth element as gameweek 4.
 */
export type PlayerWeekPoints = { week: number; points: number };

/**
 * A player, as the portal models it.
 *
 * `marketValue` is the value AT THE MOMENT OF THE CALL — there is no history in the
 * API, so the sync stamps it with a date and appends. `weekPoints` is every gameweek
 * the player has actually played, ascending; it is the reason this slice needs no
 * per-player call at all. A gameweek the player sat out is ABSENT, not zero, because
 * the catalogue does not distinguish "scored nothing" from "did not feature" and
 * inventing a zero would put a lie in the history.
 *
 * `status` is the API's own word. The capture carried five — `ok`, `out_of_league`,
 * `injured`, `doubtful`, `suspended` — and pinning them into a union would only mean
 * the next one the game invents breaks a sync, so it stays a string into the column.
 *
 * There is no club name here: the catalogue names a `teamId` and nothing more.
 */
export type PlayerRow = {
  id: string;
  nickname: string;
  position: string;
  realTeamId: string;
  status: string;
  imageUrl: string | null;
  marketValue: number;
  weekPoints: PlayerWeekPoints[];
};

/** One LaLiga club, as a squad response reveals it. */
export type RealTeamRow = {
  id: string;
  name: string;
  slug: string;
  badgeUrl: string | null;
};

/**
 * One league team's squad, as ids the portal can join on.
 *
 * `teamId` is the FANTASY team of a manager. `realTeams` are the LaLiga clubs its
 * players belong to. The two live one field apart in the same type and the collision
 * is easy to trip on — they are different id spaces entirely.
 */
/**
 * One player a manager holds, and what it would take to prise them away.
 *
 * `buyoutClause` is the API's own figure and cannot be worked out from market value: an
 * owner may raise their own clause to make a player expensive to steal, and across one
 * captured squad the ratio ran from 1.00 to 7.15.
 *
 * `clauseLockedUntil` is likewise stated rather than derived. The league's rule is
 * fourteen days from acquisition, and the two agree where both are known — but the API
 * says it exactly, without depending on the market log having seen the purchase.
 */
export type SquadHolding = {
  playerId: string;
  buyoutClause: number | null;
  clauseLockedUntil: Date | null;
  /** An extra 24-hour shield the owner may apply. Carried, not yet used. */
  shielded: boolean;
};

export type SquadRow = { teamId: string; holdings: SquadHolding[]; realTeams: RealTeamRow[] };

function toPlayerRow(entry: PlayerEntry): PlayerRow {
  return {
    id: entry.id,
    nickname: entry.nickname,
    position: POSITIONS[entry.positionId] ?? String(entry.positionId),
    realTeamId: entry.teamId,
    status: entry.playerStatus,
    imageUrl: entry.image ?? null,
    marketValue: entry.marketValue,
    weekPoints: entry.weekPoints
      .map((week) => ({ week: week.weekNumber, points: week.points }))
      .sort((a, b) => a.week - b.week),
  };
}

/**
 * The whole eligible catalogue, in one call.
 *
 * Unlike `getStanding` this does not hand back the undecoded body: the sweep does not
 * archive it. One catalogue response is around 280 kilobytes, a daily cadence would
 * put thirty of them in `raw_sync_payloads`, and the shape is already pinned by the
 * committed fixture. A shape change surfaces as a Zod error naming the field.
 */
export async function getPlayers(accessToken: string): Promise<PlayerRow[]> {
  const entries = await apiGet(
    accessToken,
    `/v1/competition/${COMPETITION}/players`,
    playersSchema,
  );
  return entries.map(toPlayerRow);
}

/**
 * The players one league team owns, as ids.
 *
 * The buyout clause and its lock now DO cross this boundary — the clause board needed
 * them, which is the "until something needs it" this comment was waiting for. A sale
 * listing, the owning manager and a season of per-match event counts still do not.
 */
export async function getSquad(
  accessToken: string,
  leagueId: string,
  teamId: string,
): Promise<SquadRow> {
  const squad = await apiGet(
    accessToken,
    `/v1/competition/${COMPETITION}/leagues/${leagueId}/teams/${teamId}`,
    squadSchema,
  );

  const realTeams = new Map<string, RealTeamRow>();
  for (const entry of squad.players) {
    const team = entry.playerMaster?.team;
    if (team === undefined) continue;
    realTeams.set(team.id, {
      id: team.id,
      name: team.name,
      slug: team.slug,
      badgeUrl: team.badgeColor ?? null,
    });
  }

  return {
    teamId,
    holdings: squad.players.flatMap((entry) => {
      const playerId = entry.playerMaster?.id ?? entry.id;
      if (playerId === undefined) return [];
      return [
        {
          playerId,
          buyoutClause: entry.buyoutClause ?? null,
          clauseLockedUntil: entry.buyoutClauseLockedEndTime ?? null,
          shielded: entry.isShielded ?? false,
        },
      ];
    }),
    realTeams: [...realTeams.values()],
  };
}

/**
 * One market operation, as everything outside this module sees it.
 *
 * `activityType` keeps the API's opaque number. Naming it is the domain's job — see
 * `operationKind` — and three of the six observed values have names.
 *
 * Every optional field arrives as `null`, never `undefined`: these go straight into
 * nullable columns, and the three types that each omit a different field would
 * otherwise each produce a different write.
 */
export type MarketOperationRow = {
  id: string;
  activityType: number;
  actorManagerId: number;
  counterpartyManagerId: number | null;
  playerId: string | null;
  amount: number | null;
  weekNumber: number | null;
  occurredAt: Date;
};

/**
 * How many pages of activity a single read will walk before giving up.
 *
 * Two pages held the whole season when this was measured. The cap is not there to save
 * requests: it is there so a response that never comes back empty cannot spin for ever.
 * Reaching it is not an error and does not fail the sweep — the pages beyond it are the
 * oldest ones, and every earlier sweep already wrote them.
 */
export const MAX_ACTIVITY_PAGES = 20;

/**
 * The league's market operations, the whole history the API still holds.
 *
 * A previous probe concluded there was none: it tried `?limit`, `?offset`, `?page`,
 * `?size` and `?from`, all five returned the identical entries, and the docstring here
 * said so — "no paging to add and no history to reach". That was wrong, and it was
 * wrong in a way worth remembering: the paging is a PATH SEGMENT, not a query
 * parameter. `/activity/0` is the recent window and `/activity/1` everything before it;
 * measured on 2026-09-08 they held 105 and 318 entries, no id in both, reaching back to
 * 11 August against a window that alone would have started on 2 September.
 *
 * So this walks pages until one comes back empty. Every sweep does it, which is what
 * makes a backfill unnecessary: the first sweep after this ships collects the season,
 * and an outage longer than the recent window heals itself on the next run instead of
 * losing those days for good.
 */
export async function getActivity(
  accessToken: string,
  leagueId: string,
): Promise<MarketOperationRow[]> {
  const operations: MarketOperationRow[] = [];

  for (let page = 0; page < MAX_ACTIVITY_PAGES; page += 1) {
    const rows = await apiGet(
      accessToken,
      `/v1/competition/${COMPETITION}/leagues/${leagueId}/activity/${page}`,
      activitySchema,
    );
    // An empty page is how the history says it has ended. It is also what a league
    // with no operations at all answers on page zero, and both mean the same thing
    // here: there is nothing further back to ask for.
    if (rows.length === 0) break;
    operations.push(...rows.map(toMarketOperation));
  }

  return operations;
}

function toMarketOperation(row: ActivityEntry): MarketOperationRow {
  return {
    id: row.id,
    activityType: row.activityTypeId,
    actorManagerId: row.user1Id,
    counterpartyManagerId: row.user2Id ?? null,
    playerId: row.playerMasterId ?? null,
    amount: row.amount ?? null,
    weekNumber: row.weekNumber ?? null,
    occurredAt: new Date(row.createdAt),
  };
}

/** The narrow surface a sync run needs, in mapped rows rather than API entries. */
export type FantasyClient = {
  getCurrentWeek(): Promise<Gameweek>;
  getStanding(week?: number): Promise<Standing>;
  getPlayers(): Promise<PlayerRow[]>;
  getSquad(teamId: string): Promise<SquadRow>;
  getActivity(): Promise<MarketOperationRow[]>;
};

/** Exchanges the credential once and binds it, so one run means one token exchange. */
export async function createClient(db: Db, leagueId: string): Promise<FantasyClient> {
  const accessToken = await getAccessToken(db);
  return {
    getCurrentWeek: () => getCurrentWeek(accessToken),
    getStanding: (week) => getStanding(accessToken, leagueId, week),
    getPlayers: () => getPlayers(accessToken),
    getSquad: (teamId) => getSquad(accessToken, leagueId, teamId),
    getActivity: () => getActivity(accessToken, leagueId),
  };
}
