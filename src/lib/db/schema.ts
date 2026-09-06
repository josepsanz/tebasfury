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

export const gameweeks = pgTable("gameweeks", {
  number: integer("number").primaryKey(),
  opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
  isLive: boolean("is_live").notNull().default(false),
});

/**
 * One row per team per gameweek, holding only what the API states for that week.
 *
 * Cumulative points and table position are NOT stored: they are a pure function of
 * this series, and keeping both would let them drift. `roundPosition` is the rank
 * WITHIN the week, which is what the API's `position` means here — it is not the
 * table position after that week.
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
    roundPosition: integer("round_position").notNull(),
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
