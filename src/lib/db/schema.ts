import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  integer,
  bigint,
  jsonb,
  primaryKey,
  date,
} from "drizzle-orm/pg-core";

/**
 * A team as LaLiga Fantasy models it. The API gives teams no name — they are
 * identified by their manager — so the display identity is `managerName`.
 */
export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  managerId: integer("manager_id").notNull(),
  managerName: text("manager_name").notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("account_issuer_accountId_uidx").on(
      table.issuer,
      table.accountId,
    ),
    index("account_userId_idx").on(table.userId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const leagueCredentials = pgTable("league_credentials", {
  id: text("id").primaryKey(),
  refreshTokenSealed: text("refresh_token_sealed").notNull(),
  clientId: text("client_id").notNull(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").notNull(),
});

/**
 * `opensAt` and `closesAt` are nullable because only the CURRENT week's dates are
 * ever reported: `week/current` gives them, and no other call does. A backfilled week
 * leaves them null rather than stamping them with the time of the sync, which would
 * be a fabricated date that later slices — fair play, scheduled operations — would
 * read as real. A run that finds the week current fills them in.
 */
export const gameweeks = pgTable("gameweeks", {
  number: integer("number").primaryKey(),
  opensAt: timestamp("opens_at", { withTimezone: true }),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  isLive: boolean("is_live").notNull().default(false),
});

/**
 * One row per team per gameweek, holding only what the API states for that week.
 *
 * Cumulative points and table position are NOT stored: they are a pure function of
 * this series, and keeping both would let them drift.
 *
 * `points` is the score of THAT WEEK. `roundPosition` is the rank WITHIN the week,
 * and it is nullable: a live response reports the overall table position instead, so
 * for a week observed live there is no round rank to record and null is the only
 * truthful value.
 *
 * `teamValue` and `teamPoints` are nullable because a backfilled week cannot know
 * them: the API reports current state, not the state at that week.
 */
export const teamGameweekStats = pgTable(
  "team_gameweek_stats",
  {
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    gameweek: integer("gameweek").notNull().references(() => gameweeks.number),
    points: integer("points").notNull(),
    roundPosition: integer("round_position"),
    livePoints: integer("live_points"),
    isProvisional: boolean("is_provisional").notNull().default(false),
    teamValue: bigint("team_value", { mode: "number" }),
    teamPoints: integer("team_points"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.gameweek] })],
);

export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  weeksSynced: integer("weeks_synced"),
  error: text("error"),
});

export const rawSyncPayloads = pgTable("raw_sync_payloads", {
  id: text("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").notNull(),
});

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

/**
 * The eligible player catalogue.
 *
 * `status` holds the API's own string rather than an enum. Task 1's live capture
 * found five values: `ok`, `out_of_league`, `injured`, `doubtful`, `suspended`.
 * The set may not be exhaustive — this is one moment in one season, not a
 * specification. A lookup table or check constraint can codify it later.
 *
 * `lastSeenAt` is how a player who leaves the competition is told apart from one who
 * is simply not in a squad: the row stays, and its age says so.
 */
export const players = pgTable("players", {
  id: text("id").primaryKey(),
  nickname: text("nickname").notNull(),
  position: text("position").notNull(),
  realTeamId: text("real_team_id").notNull(),
  status: text("status").notNull(),
  imageUrl: text("image_url"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Points for one player in one gameweek — backfilled from `weekPoints` on the first
 * sweep, extended by every sweep after it.
 *
 * `gameweek` deliberately does NOT reference `gameweeks.number`. The two cadences are
 * independent: a player sweep must not fail because the standings chain has not
 * recorded a week yet, and the catalogue's own points are truthful without it.
 */
export const playerGameweekPoints = pgTable(
  "player_gameweek_points",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    gameweek: integer("gameweek").notNull(),
    points: integer("points").notNull(),
  },
  (table) => [primaryKey({ columns: [table.playerId, table.gameweek] })],
);

/**
 * One market value, on one day.
 *
 * The API has no value history — `marketValue` is current state, the same trap as
 * team value — so the series can only be accumulated forward. `takenOn` is a DATE and
 * not a timestamp on purpose: one snapshot a day is the resolution the daily cadence
 * can honestly claim, and the primary key is what makes a second sweep on the same
 * day correct the day's reading rather than duplicate it.
 */
export const playerValueSnapshots = pgTable(
  "player_value_snapshots",
  {
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    takenOn: date("taken_on", { mode: "string" }).notNull(),
    value: bigint("value", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.playerId, table.takenOn] }),
    // The catalogue's `DISTINCT ON (player_id) … ORDER BY player_id ASC, taken_on
    // DESC` cannot be satisfied by the primary key above, which is ascending on both
    // columns — a mixed-direction ORDER BY needs its own index, or every `/players`
    // load plans a full scan plus a sort of the whole table. Snapshots accrue per
    // player per DAY, not per gameweek, so this table is ~225,000 rows by May.
    index("player_value_snapshots_player_id_taken_on_desc_idx").on(
      table.playerId,
      table.takenOn.desc(),
    ),
  ],
);

/**
 * Who owns whom, right now.
 *
 * This is current state, replaced each sweep — NOT an event log. The fair-play slice
 * will read the activity endpoint for transfers, which catches operations the portal
 * never observed; diffing these snapshots would not. `firstSeenAt` survives a sweep
 * that finds the player still there, so it means "in this squad since", and a
 * transfer resets it by deleting the old row.
 */
export const squadMembers = pgTable(
  "squad_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.playerId] })],
);

/**
 * A LaLiga club, learned from `playerMaster.team` on the squad response the sweep
 * already fetches for ownership. Costs no extra API call.
 *
 * Accumulated, never seeded. A club nobody in this league owns a player from simply
 * has no row, and the views say so by omission rather than by guessing — the same
 * refusal to invent that keeps `gameweeks.opensAt` null for a backfilled week.
 *
 * Deliberately NOT the target of a foreign key from `players.real_team_id`. Inside
 * `runPlayerSweep` the catalogue is written before a single squad is read, so on the
 * first sweep all ~836 players are written at a moment when no club is known at all.
 * A foreign key would fail the whole sweep, and every retry after it, for ever — the
 * same trap `squad_members.player_id` documents from the other side.
 *
 * `slug` and `badgeUrl` are stored and rendered by nothing: they arrive in a response
 * already being parsed, so keeping them costs two columns, while recovering them
 * later would cost a migration and a full sweep.
 */
export const realTeams = pgTable("real_teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  badgeUrl: text("badge_url"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});
