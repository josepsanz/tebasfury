import { and, count, desc, eq, like, notLike, sum } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";
import type { Snapshot, TeamRef } from "@/lib/domain/standings";
import type {
  CurrentValue,
  GameweekPoints,
  Ownership,
  PlayerRecord,
  PlayerTotals,
  RealTeamRecord,
  ValuePoint,
} from "@/lib/domain/players";
import type { MarketOperation } from "@/lib/domain/market";
import {
  gameweeks,
  marketOperations,
  playerGameweekPoints,
  playerValueSnapshots,
  players as playersTable,
  realTeams,
  squadMembers,
  syncRuns,
  teamGameweekStats,
  teams,
} from "./schema";

/**
 * The production database is `neon-http`, tests run against an in-process
 * PGlite instance (see `createTestDatabase`). Both extend Drizzle's
 * `PgDatabase` with a different driver-specific query-result kind, so this
 * type is generic over that to accept either without `any`.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type PortalData = {
  snapshots: Snapshot[];
  teams: TeamRef[];
  lastSync: Date | null;
  currentGameweek: number | null;
  isLive: boolean;
};

/** Everything both views need, in one read. */
export async function loadSnapshots(db: Db): Promise<PortalData> {
  const [stats, teamRows, weeks, runs] = await Promise.all([
    // Postgres returns heap order without an ORDER BY, and heap order shifts as rows
    // are updated and after a vacuum. The snapshot series is read as a series.
    db.select().from(teamGameweekStats).orderBy(teamGameweekStats.gameweek),
    db.select().from(teams),
    db.select().from(gameweeks).orderBy(desc(gameweeks.number)).limit(1),
    db
      .select()
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.status, "succeeded"),
          // The daily player sweep writes no gameweek snapshot, so its success says
          // nothing about how fresh THIS page is.
          notLike(syncRuns.trigger, "players-%"),
        ),
      )
      .orderBy(desc(syncRuns.finishedAt))
      .limit(1),
  ]);

  return {
    snapshots: stats.map((r) => ({
      teamId: r.teamId,
      gameweek: r.gameweek,
      points: r.points,
      roundPosition: r.roundPosition,
      livePoints: r.livePoints,
      isProvisional: r.isProvisional,
      teamValue: r.teamValue,
    })),
    teams: teamRows.map((t) => ({ id: t.id, managerName: t.managerName })),
    lastSync: runs[0]?.finishedAt ?? null,
    currentGameweek: weeks[0]?.number ?? null,
    isLive: weeks[0]?.isLive ?? false,
  };
}

export type CatalogueData = {
  players: PlayerRecord[];
  totals: PlayerTotals[];
  values: CurrentValue[];
  ownership: Ownership[];
  /**
   * Every club observed so far — about twenty rows. Read whole and merged in
   * `buildCatalogue` rather than LEFT JOINed: `toRecord` is shared by both reads, and
   * a join would change Drizzle's row shape in both of them for the sake of a table
   * this small. `buildCatalogue` already merges three maps; this is the fourth.
   */
  clubs: RealTeamRecord[];
  /**
   * Whether any squad has been read at all. Before the first sweep reads them every
   * player would look free, which is a different statement from "nobody owns them".
   */
  ownershipKnown: boolean;
  lastSweep: Date | null;
};

const toRecord = (row: typeof playersTable.$inferSelect): PlayerRecord => ({
  id: row.id,
  nickname: row.nickname,
  position: row.position,
  realTeamId: row.realTeamId,
  status: row.status,
  imageUrl: row.imageUrl,
});

/**
 * What the status bar says: which gameweek the portal is showing, whether it is being
 * played right now, and how old the table in front of the reader is.
 *
 * Deliberately its own read rather than a slice of `loadSnapshots`: this runs on every
 * page, including ones that have nothing to do with the standings, and `loadSnapshots`
 * pulls every snapshot of the season to answer it.
 *
 * `lastSync` counts only the STANDINGS cadence. The daily player sweep succeeds later
 * and more often, and reporting it here would tell a reader the table was refreshed
 * four hours ago when the table has not moved since one in the morning.
 */
export type LeagueStatus = { gameweek: number | null; isLive: boolean; lastSync: Date | null };

export async function loadLeagueStatus(db: Db): Promise<LeagueStatus> {
  const [week] = await db
    .select({ number: gameweeks.number, isLive: gameweeks.isLive })
    .from(gameweeks)
    .orderBy(desc(gameweeks.number))
    .limit(1);

  const [sync] = await db
    .select({ finishedAt: syncRuns.finishedAt })
    .from(syncRuns)
    .where(and(eq(syncRuns.status, "succeeded"), notLike(syncRuns.trigger, "players-%")))
    .orderBy(desc(syncRuns.finishedAt))
    .limit(1);

  return {
    gameweek: week?.number ?? null,
    isLive: week?.isLive ?? false,
    lastSync: sync?.finishedAt ?? null,
  };
}

/**
 * When the player cadence last succeeded — shared by the catalogue and the player-detail
 * read so the query is written once. A player sweep writes no gameweek snapshot, so this
 * is deliberately separate from `loadSnapshots`'s own last-sync read.
 */
export async function loadLastPlayerSweep(db: Db): Promise<Date | null> {
  const [sweep] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.status, "succeeded"), like(syncRuns.trigger, "players-%")))
    .orderBy(desc(syncRuns.finishedAt))
    .limit(1);
  return sweep?.finishedAt ?? null;
}

/** Everything the catalogue needs, aggregated in the database. */
export async function loadPlayerCatalogue(db: Db): Promise<CatalogueData> {
  const [playerRows, totalRows, valueRows, ownershipRows, clubRows, lastSweep] = await Promise.all([
    db.select().from(playersTable).orderBy(playersTable.nickname),

    // Six hundred players times thirty-eight weeks by May. Summed here, not shipped.
    db
      .select({
        playerId: playerGameweekPoints.playerId,
        seasonPoints: sum(playerGameweekPoints.points),
        gameweeksRecorded: count(),
      })
      .from(playerGameweekPoints)
      .groupBy(playerGameweekPoints.playerId),

    // DISTINCT ON keeps one row per player — the newest, thanks to the ORDER BY —
    // entirely in Postgres. By May this table is 836 players times a season of days;
    // shipping it whole to sum in JS is the timeout the aggregation constraint warns of.
    db
      .selectDistinctOn([playerValueSnapshots.playerId], {
        playerId: playerValueSnapshots.playerId,
        value: playerValueSnapshots.value,
        takenOn: playerValueSnapshots.takenOn,
      })
      .from(playerValueSnapshots)
      .orderBy(playerValueSnapshots.playerId, desc(playerValueSnapshots.takenOn)),

    db
      .select({
        playerId: squadMembers.playerId,
        teamId: squadMembers.teamId,
        managerName: teams.managerName,
      })
      .from(squadMembers)
      .innerJoin(teams, eq(teams.id, squadMembers.teamId)),

    db.select({ id: realTeams.id, name: realTeams.name }).from(realTeams),

    loadLastPlayerSweep(db),
  ]);

  return {
    players: playerRows.map(toRecord),
    // Postgres returns a bigint for `sum`, which the driver hands over as a string.
    totals: totalRows.map((t) => ({
      playerId: t.playerId,
      seasonPoints: Number(t.seasonPoints ?? 0),
      gameweeksRecorded: t.gameweeksRecorded,
    })),
    values: valueRows,
    ownership: ownershipRows,
    clubs: clubRows,
    ownershipKnown: ownershipRows.length > 0,
    lastSweep,
  };
}

export type PlayerDetail = {
  player: PlayerRecord;
  values: ValuePoint[];
  points: GameweekPoints[];
  owner: Ownership | null;
  /** This player's club, or null when no squad response has named it yet. */
  club: RealTeamRecord | null;
  /**
   * Whether any squad has been read at all, globally — not whether THIS player has an
   * owner. Mirrors `CatalogueData.ownershipKnown`: before the first sweep reads the
   * squads, this player having no owner row is a gap in what we know, not the fact
   * that they are unowned.
   */
  ownershipKnown: boolean;
  lastSweep: Date | null;
  /**
   * The furthest gameweek ANY player has points for — the axis every player's chart is
   * drawn against, so two of them can be compared. Deliberately taken from the points
   * table rather than from `gameweeks`: LaLiga plays some fixtures early, and on
   * 2026-09-09 the points table already held a gameweek 6 that `gameweeks` did not, so
   * the standings' idea of "now" would have truncated a score that had really happened.
   *
   * Null before anything has been swept.
   */
  seasonLastGameweek: number | null;
};

export async function loadPlayer(db: Db, playerId: string): Promise<PlayerDetail | null> {
  const [row] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!row) return null;

  const [values, points, owners, clubRows, anyOwnership, lastSweep, furthest] = await Promise.all([
    db
      .select({ takenOn: playerValueSnapshots.takenOn, value: playerValueSnapshots.value })
      .from(playerValueSnapshots)
      .where(eq(playerValueSnapshots.playerId, playerId))
      .orderBy(playerValueSnapshots.takenOn),
    db
      .select({ gameweek: playerGameweekPoints.gameweek, points: playerGameweekPoints.points })
      .from(playerGameweekPoints)
      .where(eq(playerGameweekPoints.playerId, playerId))
      .orderBy(playerGameweekPoints.gameweek),
    db
      .select({
        playerId: squadMembers.playerId,
        teamId: squadMembers.teamId,
        managerName: teams.managerName,
      })
      .from(squadMembers)
      .innerJoin(teams, eq(teams.id, squadMembers.teamId))
      .where(eq(squadMembers.playerId, playerId)),
    // One player needs one club, not twenty: keyed, unlike the catalogue's whole-table read.
    db
      .select({ id: realTeams.id, name: realTeams.name })
      .from(realTeams)
      .where(eq(realTeams.id, row.realTeamId))
      .limit(1),
    // Global, not scoped to this player: a squad table with rows for OTHER teams but
    // none for this player's is exactly "ownership is known and this player is free",
    // which is a `limit(1)` on the whole table, not a lookup keyed by playerId.
    db.select({ teamId: squadMembers.teamId }).from(squadMembers).limit(1),
    loadLastPlayerSweep(db),
    // Global, and one row: the shared axis is a property of the season, not of this
    // player. Indexed by the primary key's second column, so it is a cheap read.
    db
      .select({ gameweek: playerGameweekPoints.gameweek })
      .from(playerGameweekPoints)
      .orderBy(desc(playerGameweekPoints.gameweek))
      .limit(1),
  ]);

  return {
    player: toRecord(row),
    values,
    points,
    owner: owners[0] ?? null,
    club: clubRows[0] ?? null,
    ownershipKnown: anyOwnership.length > 0,
    lastSweep,
    seasonLastGameweek: furthest[0]?.gameweek ?? null,
  };
}

export type MarketData = {
  /** Newest first — the order the feed reads in. */
  operations: MarketOperation[];
  /**
   * Manager and player names, read whole and merged in the view rather than joined.
   * Thirteen managers and ~840 players against a few thousand operations: two small
   * maps beat two joins that would have to tolerate a missing row anyway, which
   * Ruling 7 guarantees can happen.
   */
  managerNames: Map<number, string>;
  playerNames: Map<string, string>;
  /**
   * The two directions of one translation, because both are needed and neither is
   * derivable from the other without a scan. The market keys everything by the API's
   * `managerId`; every page that links to a manager holds their `teams.id`. A
   * per-manager feed needs the first to filter, the feed's own rows need the second to
   * link. Both are columns on a query already being run.
   */
  managerIdByTeamId: Map<string, number>;
  teamIdByManagerId: Map<number, string>;
  /**
   * When this log first captured anything. Older operations exist in the world and
   * cannot be recovered — the API's window is seven days — so this is the date before
   * which a holding period is unknowable rather than clean.
   */
  logBegan: Date | null;
};

/** Everything the market page shows. */
export async function loadMarket(db: Db): Promise<MarketData> {
  const [operationRows, teamRows, playerRows] = await Promise.all([
    db.select().from(marketOperations).orderBy(desc(marketOperations.occurredAt)),
    db
      .select({ id: teams.id, managerId: teams.managerId, managerName: teams.managerName })
      .from(teams),
    db.select({ id: playersTable.id, nickname: playersTable.nickname }).from(playersTable),
  ]);

  return {
    operations: operationRows.map((row) => ({
      id: row.id,
      activityType: row.activityType,
      actorManagerId: row.actorManagerId,
      counterpartyManagerId: row.counterpartyManagerId,
      playerId: row.playerId,
      amount: row.amount,
      occurredAt: row.occurredAt,
    })),
    managerNames: new Map(teamRows.map((t) => [t.managerId, t.managerName])),
    playerNames: new Map(playerRows.map((p) => [p.id, p.nickname])),
    managerIdByTeamId: new Map(teamRows.map((t) => [t.id, t.managerId])),
    teamIdByManagerId: new Map(teamRows.map((t) => [t.managerId, t.id])),
    logBegan: operationRows.reduce<Date | null>(
      (earliest, row) =>
        earliest === null || row.firstSeenAt < earliest ? row.firstSeenAt : earliest,
      null,
    ),
  };
}
