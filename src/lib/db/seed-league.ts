import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import {
  allowedEmails,
  gameweeks,
  marketOperations,
  necroporraRounds,
  necroporraVotes,
  playerGameweekPoints,
  playerValueSnapshots,
  players,
  realTeams,
  roundLineupPlayers,
  roundLineups,
  squadMembers,
  syncRuns,
  teamGameweekStats,
  teams,
  user,
} from "./schema";

/** The account that owns `t1`, so a page can be rendered as somebody in particular. */
export const SEED_USER = { id: "u-ada", name: "Ada", email: "ada@example.com" };
export const SEED_TEAM = "t1";
export const SEED_SETTLED_WEEK = 1;
export const SEED_LIVE_WEEK = 2;

/**
 * A league small enough to read and complete enough to render every page of the portal.
 *
 * TEST-ONLY, and deliberately not a factory with options: the page tests are checking
 * that a page survives contact with a real database, so they all want the SAME league —
 * one whose numbers a failing assertion can be traced back to by eye. A test needing a
 * different shape adds to what it seeded rather than parameterising this.
 *
 * Three teams, two rounds (one settled, one still being played), and a squad of fourteen
 * on `t1` — one keeper, five defenders, five midfielders, three forwards, which is the
 * smallest squad from which every formation the lineup board offers can be fielded.
 */
/** Both drivers, exactly as the queries are typed: Neon in production, PGlite in tests. */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export async function seedLeague(db: Db) {
  await db.insert(user).values({
    id: SEED_USER.id,
    name: SEED_USER.name,
    email: SEED_USER.email,
    emailVerified: true,
  });
  await db.insert(allowedEmails).values({ email: SEED_USER.email, addedBy: SEED_USER.id });

  await db.insert(teams).values([
    { id: "t1", managerId: 1, managerName: "Ada", userId: SEED_USER.id },
    { id: "t2", managerId: 2, managerName: "Bruno", userId: null },
    { id: "t3", managerId: 3, managerName: "Chus", userId: null },
  ]);

  await db.insert(gameweeks).values([
    {
      number: SEED_SETTLED_WEEK,
      opensAt: new Date("2026-08-15T17:00:00Z"),
      closesAt: new Date("2026-08-18T01:00:00Z"),
      isLive: false,
    },
    {
      number: SEED_LIVE_WEEK,
      opensAt: new Date("2026-08-22T17:00:00Z"),
      closesAt: new Date("2026-08-25T01:00:00Z"),
      isLive: true,
    },
  ]);

  // Round 1 is settled and Chus finished last in it, so the breakfast rule has something
  // to say on every page that says it. Round 2 is still being played.
  await db.insert(teamGameweekStats).values([
    { teamId: "t1", gameweek: 1, points: 50, roundPosition: 1, isProvisional: false },
    { teamId: "t2", gameweek: 1, points: 30, roundPosition: 2, isProvisional: false },
    { teamId: "t3", gameweek: 1, points: 10, roundPosition: 3, isProvisional: false },
    { teamId: "t1", gameweek: 2, points: 12, roundPosition: 2, isProvisional: true, livePoints: 12, teamValue: 250_000_000 },
    { teamId: "t2", gameweek: 2, points: 20, roundPosition: 1, isProvisional: true, livePoints: 20, teamValue: 210_000_000 },
    { teamId: "t3", gameweek: 2, points: 5, roundPosition: 3, isProvisional: true, livePoints: 5, teamValue: 190_000_000 },
  ]);

  await db.insert(realTeams).values({ id: "rt1", name: "Real Test", slug: "real-test" });

  const squad = [
    { id: "gk1", nickname: "Courtois", position: "Goalkeeper" },
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `df${n}`, nickname: `Defender ${n}`, position: "Defender" })),
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `mf${n}`, nickname: `Midfielder ${n}`, position: "Midfielder" })),
    ...[1, 2, 3].map((n) => ({ id: `fw${n}`, nickname: `Forward ${n}`, position: "Forward" })),
  ];

  await db.insert(players).values(
    squad.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      position: p.position,
      realTeamId: "rt1",
      status: "ok",
      imageUrl: null,
    })),
  );

  await db.insert(playerGameweekPoints).values(
    squad.flatMap((p, i) => [
      { playerId: p.id, gameweek: 1, points: i },
      { playerId: p.id, gameweek: 2, points: i + 1 },
    ]),
  );

  await db.insert(playerValueSnapshots).values(
    squad.map((p, i) => ({
      playerId: p.id,
      takenOn: "2026-08-20",
      value: 1_000_000 + i * 100_000,
    })),
  );

  await db.insert(squadMembers).values(
    squad.map((p) => ({
      teamId: "t1",
      playerId: p.id,
      buyoutClause: 5_000_000,
      clauseLockedUntil: null,
    })),
  );

  // A purchase and the sale that closes it, so the feed has a profit to work out.
  await db.insert(marketOperations).values([
    {
      id: "op-buy",
      activityType: 31,
      actorManagerId: 1,
      playerId: "fw1",
      amount: 2_000_000,
      occurredAt: new Date("2026-08-16T10:00:00Z"),
    },
    {
      id: "op-sell",
      activityType: 33,
      actorManagerId: 1,
      playerId: "fw1",
      amount: 3_000_000,
      occurredAt: new Date("2026-08-24T10:00:00Z"),
    },
  ]);

  await db.insert(necroporraRounds).values({
    gameweek: SEED_LIVE_WEEK,
    closesAt: new Date("2026-08-22T17:00:00Z"),
  });
  await db.insert(necroporraVotes).values({
    gameweek: SEED_LIVE_WEEK,
    teamId: "t1",
    firstTeamId: "t3",
    secondTeamId: "t2",
  });

  // `t1`'s eleven for the settled round: a 4-4-2 with the keeper implied by the endpoint.
  await db.insert(roundLineups).values({
    teamId: "t1",
    gameweek: SEED_SETTLED_WEEK,
    formation: "4-4-2",
    points: 50,
    snapshotTookOn: new Date("2026-08-15T16:00:00Z"),
  });
  await db.insert(roundLineupPlayers).values([
    { teamId: "t1", gameweek: 1, playerId: "gk1", line: "goalkeeper", weekPoints: 6, inIdeal: false },
    ...[1, 2, 3, 4].map((n) => ({
      teamId: "t1", gameweek: 1, playerId: `df${n}`, line: "defender", weekPoints: 4, inIdeal: false,
    })),
    ...[1, 2, 3, 4].map((n) => ({
      teamId: "t1", gameweek: 1, playerId: `mf${n}`, line: "midfield", weekPoints: 5, inIdeal: n === 1,
    })),
    ...[1, 2].map((n) => ({
      teamId: "t1", gameweek: 1, playerId: `fw${n}`, line: "striker", weekPoints: -2, inIdeal: false,
    })),
  ]);

  await db.insert(syncRuns).values({
    id: "run-1",
    trigger: "schedule",
    status: "succeeded",
    startedAt: new Date("2026-08-24T10:00:00Z"),
    finishedAt: new Date("2026-08-24T10:00:05Z"),
    weeksSynced: 2,
  });
}
