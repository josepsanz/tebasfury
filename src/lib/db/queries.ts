import { and, count, desc, eq, gt, inArray, like, notExists, notLike, sql, sum } from "drizzle-orm";
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
  roundLineupPlayers,
  roundLineups,
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
 * When the newest standings run STARTED — whether it has finished or is still working.
 *
 * Deliberately not `loadLeagueStatus`'s `lastSync`, which is the newest SUCCESS and the
 * right answer to a different question ("how old is the table in front of me?"). The
 * collapse guard asks whether this delivery has a twin, and a twin arrives 70 milliseconds
 * into a run that takes seconds: at that instant the first delivery has written its
 * `running` row and has no result at all. Reading finishes would find the previous
 * cadence ten minutes back, call the twin legitimate, and let the fork run forever.
 *
 * A FAILED run is left out on purpose. It did no work, so it cannot make another run
 * redundant — and QStash's retry of the delivery that failed is the fast recovery the
 * endpoint's 500 exists to invite. Runs still in flight and runs that worked both count.
 */
export async function loadLastStandingsRunAt(db: Db): Promise<Date | null> {
  const [run] = await db
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(
      and(
        inArray(syncRuns.status, ["running", "succeeded"]),
        notLike(syncRuns.trigger, "players-%"),
      ),
    )
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  return run?.startedAt ?? null;
}

/**
 * The last sign of life from each chain, and whether a gameweek is being played.
 *
 * Everything the watchdog needs, in one read, because it runs on a schedule of its own
 * and finds nothing to do almost every time: the cheapest possible answer to "is either
 * chain dead?" is the point of it.
 *
 * A run of ANY status counts, failures included — the opposite of `claimStandingsRun`,
 * which ignores failures because they did no work. The question here is not whether the
 * data is fresh but whether the chain still exists, and a run that failed and booked its
 * successor five minutes out is as alive as one that worked.
 */
export type ChainHeartbeats = { standingsAt: Date | null; sweepAt: Date | null; isLive: boolean };

export async function loadChainHeartbeats(db: Db): Promise<ChainHeartbeats> {
  const [standings, sweep, week] = await Promise.all([
    db
      .select({ startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .where(notLike(syncRuns.trigger, "players-%"))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1),
    db
      .select({ startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .where(like(syncRuns.trigger, "players-%"))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1),
    db
      .select({ isLive: gameweeks.isLive })
      .from(gameweeks)
      .orderBy(desc(gameweeks.number))
      .limit(1),
  ]);

  return {
    standingsAt: standings[0]?.startedAt ?? null,
    sweepAt: sweep[0]?.startedAt ?? null,
    isLive: week[0]?.isLive ?? false,
  };
}

/**
 * Claims the right to run a scheduled standings sync, and writes the run's row doing it.
 *
 * ONE statement, and that is the whole point. The chain forked on 2026-09-11 when a
 * single booking was delivered twice, 70 ms apart, and both deliveries became permanent
 * chains. A guard that read the table and then decided could not have stopped it: each
 * delivery spends a few hundred milliseconds fetching a token before it writes anything,
 * so both would have read an empty window and both would have proceeded. Testing the
 * window and inserting the row in the same `INSERT ... SELECT ... WHERE NOT EXISTS` makes
 * the row itself the claim — the same answer the team claim and the Necroporra's vote
 * upsert give to a driver that has no transactions.
 *
 * Returns false when another standings run started inside the window; the caller's
 * contract is to stand down **without booking a successor**, which is what collapses the
 * extra chain. It cannot collapse the last one: whichever delivery inserts first is the
 * one that runs, and it books the next run as usual.
 *
 * A run still in flight blocks, a run that succeeded blocks, a FAILED one does not: it
 * did no work, and QStash's retry of the delivery that failed is the fast recovery the
 * endpoint's 500 exists to invite. The player chain never blocks this one.
 */
export async function claimStandingsRun(
  db: Db,
  {
    runId,
    trigger,
    now,
    collapseWindowMs,
  }: { runId: string; trigger: string; now: Date; collapseWindowMs: number },
): Promise<boolean> {
  const windowOpenedAt = new Date(now.getTime() - collapseWindowMs);

  const claimed = await db
    .insert(syncRuns)
    .select((qb) =>
      qb
        // Every column of the table, in its own order: an insert-select is positional,
        // and the query builder refuses anything else. The three a run fills in as it
        // goes are named here as the nulls they start out as.
        .select({
          id: sql<string>`${runId}::text`.as("id"),
          trigger: sql<string>`${trigger}::text`.as("trigger"),
          status: sql<string>`'running'`.as("status"),
          startedAt: sql<Date>`${now}::timestamptz`.as("started_at"),
          finishedAt: sql<Date | null>`null::timestamptz`.as("finished_at"),
          weeksSynced: sql<number | null>`null::integer`.as("weeks_synced"),
          error: sql<string | null>`null::text`.as("error"),
        })
        // A one-row source to hang the WHERE on: `SELECT ... WHERE NOT EXISTS` is legal
        // SQL with no FROM at all, but the query builder only offers `where` on a select
        // that has one.
        .from(sql`(select 1) as one_row`)
        .where(
          notExists(
            db
              .select({ one: sql`1` })
              .from(syncRuns)
              .where(
                and(
                  notLike(syncRuns.trigger, "players-%"),
                  inArray(syncRuns.status, ["running", "succeeded"]),
                  gt(syncRuns.startedAt, windowOpenedAt),
                ),
              ),
          ),
        ),
    )
    .returning({ id: syncRuns.id });

  return claimed.length > 0;
}

/**
 * Closes a claimed run that failed before it could record its own outcome.
 *
 * The claim writes the row before the LaLiga client is built, which is deliberate — that
 * is where the milliseconds two twin deliveries would race through go — but it means an
 * expired credential now throws with a `running` row already in the table. Nothing else
 * would ever close it, and the admin history would show a run that never ended instead of
 * the one error that most needs acting on.
 *
 * Conditional on the row still being `running`, so it can never overwrite what `runSync`
 * recorded for itself: that failure carries the detail this caller does not have.
 */
export async function markClaimedRunFailed(
  db: Db,
  { runId, now, error }: { runId: string; now: Date; error: string },
): Promise<void> {
  await db
    .update(syncRuns)
    .set({ status: "failed", finishedAt: now, error })
    .where(and(eq(syncRuns.id, runId), eq(syncRuns.status, "running")));
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

/**
 * Which (team, gameweek) lineups are already stored, keyed `"teamId:gameweek"`.
 *
 * `captureLineups` needs this once per sweep, not once per team per week: a Set built
 * from a single read replaces thirteen times the number of started weeks worth of
 * per-pair existence checks, and it is what lets a settled week be asked for once and
 * never again.
 *
 * Read off `round_lineup_players`, joined back to the header, rather than off
 * `round_lineups` alone: `writeLineup` writes the header first and the eleven second,
 * with no transaction and no foreign key between them, so a sweep that dies in between
 * — a timeout, a dropped connection — leaves a header with zero players. A header-only
 * read would call that "already stored" for ever, since a settled week is never asked
 * for twice; keying off the eleven instead means a half-write has no player row to
 * join against, is not counted as stored, and self-heals on the very next sweep.
 */
export async function loadStoredLineupWeeks(db: Db): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ teamId: roundLineups.teamId, gameweek: roundLineups.gameweek })
    .from(roundLineups)
    .innerJoin(
      roundLineupPlayers,
      and(
        eq(roundLineupPlayers.teamId, roundLineups.teamId),
        eq(roundLineupPlayers.gameweek, roundLineups.gameweek),
      ),
    );
  return new Set(rows.map((r) => `${r.teamId}:${r.gameweek}`));
}

/** One player as they were fielded: who, where, and what the round paid them. */
export type FieldedRow = {
  playerId: string;
  nickname: string;
  line: string;
  weekPoints: number;
  inIdeal: boolean;
  /** Their portrait, which the API has been sending all along. Null for a player it has
   *  never pictured, and the pitch draws initials for those rather than a hole. */
  imageUrl: string | null;
};

/** What a team fielded in one round — the header from `round_lineups`, the eleven beside it. */
export type RoundLineup = {
  gameweek: number;
  formation: string;
  points: number;
  snapshotTookOn: Date;
  players: FieldedRow[];
};

/**
 * The order a pitch is read in: keeper first, then outward from goal to attack. Fixed
 * here rather than read off any row, because a line with nobody in it still needs a
 * place in the order — `RoundLineup` says nothing about columns that are empty.
 */
const LINE_ORDER = ["goalkeeper", "defender", "midfield", "striker"] as const;

/**
 * What one team fielded in one round, eleven in line order — or null when nothing was
 * captured for that (team, gameweek), which is the honest answer for a round still to
 * come or one the sweep has not reached yet.
 *
 * Two statements, not a join: `round_lineup_players` carries no foreign key back to
 * `round_lineups` (see the schema comment on why), so a join could not tell "no header"
 * from "header with no players" apart. Asking for the header first is also the cheap
 * way to answer null without ever touching the eleven.
 */
export async function loadRoundLineup(
  db: Db,
  { teamId, gameweek }: { teamId: string; gameweek: number },
): Promise<RoundLineup | null> {
  const [header] = await db
    .select()
    .from(roundLineups)
    .where(and(eq(roundLineups.teamId, teamId), eq(roundLineups.gameweek, gameweek)))
    .limit(1);
  if (!header) return null;

  const rows = await db
    .select({
      playerId: roundLineupPlayers.playerId,
      nickname: playersTable.nickname,
      line: roundLineupPlayers.line,
      weekPoints: roundLineupPlayers.weekPoints,
      inIdeal: roundLineupPlayers.inIdeal,
      imageUrl: playersTable.imageUrl,
    })
    .from(roundLineupPlayers)
    .innerJoin(playersTable, eq(playersTable.id, roundLineupPlayers.playerId))
    .where(
      and(
        eq(roundLineupPlayers.teamId, teamId),
        eq(roundLineupPlayers.gameweek, gameweek),
      ),
    );

  // Postgres owes no order without one, and the eleven is read as a shape (I3 on this
  // task) — a pitch drawn in whatever order the heap happened to return would be wrong
  // as often as it was right.
  const position = new Map(LINE_ORDER.map((line, i) => [line, i]));
  const players = [...rows].sort(
    (a, b) => (position.get(a.line as (typeof LINE_ORDER)[number]) ?? LINE_ORDER.length) -
      (position.get(b.line as (typeof LINE_ORDER)[number]) ?? LINE_ORDER.length),
  );

  return {
    gameweek: header.gameweek,
    formation: header.formation,
    points: header.points,
    snapshotTookOn: header.snapshotTookOn,
    players,
  };
}

/**
 * Every gameweek this team has a stored lineup for, newest first — so the team page's
 * own `chosenRound` can default to `weeks[0]` with no separate "latest" query. The team
 * page reverses this before handing it to `RoundPicker`, which wants the opposite order
 * (see that component's own comment on why); the reversal is that caller's business,
 * not a second ordering baked in here.
 */
export async function loadLineupWeeks(
  db: Db,
  { teamId }: { teamId: string },
): Promise<number[]> {
  const rows = await db
    .select({ gameweek: roundLineups.gameweek })
    .from(roundLineups)
    .where(eq(roundLineups.teamId, teamId))
    .orderBy(desc(roundLineups.gameweek));
  return rows.map((r) => r.gameweek);
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
        buyoutClause: squadMembers.buyoutClause,
        clauseLockedUntil: squadMembers.clauseLockedUntil,
        shielded: squadMembers.shielded,
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
        buyoutClause: squadMembers.buyoutClause,
        clauseLockedUntil: squadMembers.clauseLockedUntil,
        shielded: squadMembers.shielded,
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
