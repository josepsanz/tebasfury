import { relations, sql } from "drizzle-orm";
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
  check,
} from "drizzle-orm/pg-core";

/**
 * A team as LaLiga Fantasy models it. The API gives teams no name — they are
 * identified by their manager — so the display identity is `managerName`.
 */
export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    managerId: integer("manager_id").notNull(),
    managerName: text("manager_name").notNull(),
    /**
     * The portal account that claims this team, or null while nobody has.
     *
     * Unique, so one person cannot hold two teams — and plainly unique, not
     * partially: Postgres treats NULLs as distinct in a unique index, so the
     * twelve unclaimed rows do not collide with each other.
     */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("teams_user_id_unique").on(table.userId)],
);

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
    /**
     * What it costs to take this player off this manager, as the API states it.
     *
     * NOT derivable from market value: an owner can raise their own clause to make a
     * player expensive to steal, and across one captured squad the ratio of clause to
     * market value ran from 1.00 to 7.15. Only the API knows it, and it is re-read every
     * sweep because the owner can change it.
     *
     * Null until the first sweep that carries it, and for any entry the API omits it on.
     */
    buyoutClause: bigint("buyout_clause", { mode: "number" }),
    /**
     * When this player stops being raid-proof, as the API states it.
     *
     * The league's rule is fourteen days from acquisition and the two agree wherever both
     * are known — but this is stated rather than deduced, so it does not depend on the
     * market log having witnessed the purchase. That dependency is why the portal derived
     * it first, and why it stopped.
     */
    clauseLockedUntil: timestamp("clause_locked_until", { withTimezone: true }),
    /** An extra 24-hour shield the owner may apply. The API gives no expiry for it. */
    shielded: boolean("shielded").notNull().default(false),
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

/**
 * Every market operation the league activity feed has reported.
 *
 * The primary key is the API's OWN operation id, which is what makes the daily capture
 * idempotent: consecutive sweeps overlap by six days, and re-reading an operation must
 * correct it rather than duplicate it.
 *
 * Deliberately the target of no foreign key and holding none. An operation can name a
 * player the catalogue has not swept yet, or a manager who joined between standings
 * syncs — the same trap `squad_members.player_id` documents, and `real_teams` documents
 * from the other side. A key here would fail the sweep and every retry after it.
 *
 * Rows arrive uninterpreted. Six `activity_type` values have been observed and three
 * have names; the other three are stored anyway, because the feed is a rolling
 * seven-day window and an unstored operation is unrecoverable a week later, while an
 * uninterpreted one costs a single insert.
 *
 * There is no violations table. A violation is arithmetic over two of these rows and a
 * threshold — computed, not measured — and a stored verdict can outlive the rule that
 * produced it. See Ruling 2.
 */
export const marketOperations = pgTable(
  "market_operations",
  {
    id: text("id").primaryKey(),
    activityType: integer("activity_type").notNull(),
    actorManagerId: integer("actor_manager_id").notNull(),
    counterpartyManagerId: integer("counterparty_manager_id"),
    playerId: text("player_id"),
    amount: bigint("amount", { mode: "number" }),
    weekNumber: integer("week_number"),
    /** The instant the API reported, offset included. Not a date: the rule is hourly. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** When our log first saw it — which is how far back the log can honestly reach. */
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The feed reads newest-first. A b-tree is scanned backwards for a DESC order, so
    // one ascending index serves both this and the "how far back do we reach" read.
    index("market_operations_occurred_at_idx").on(table.occurredAt),
  ],
);

/**
 * One week of the Necroporra: name the two teams you think finish the round last.
 *
 * Holds the deadline and nothing else. Who actually finished last is arithmetic over
 * `team_gameweek_stats`, computed on read — the same refusal that keeps a violations
 * table out of the fair-play slice, and for the same reason: a stored verdict can
 * outlive the rule that produced it, while a computed one is corrected for free by the
 * next sync that corrects the standings.
 *
 * The deadline is the exception because it is the one thing NOT derivable from what we
 * store. It is the round's own opening time, which the API reports three days ahead on
 * `week/current` — and which cannot live on `gameweeks.opensAt`, because `runSync`
 * writes a `gameweeks` row only once a week has been PLAYED. That is load-bearing:
 * `loadLeagueStatus` takes `max(gameweeks.number)` as the gameweek the whole portal
 * says it is showing, and naming a round the moment the API does would move that figure
 * to a week with no scores in it.
 *
 * So `gameweek` deliberately references nothing. Two cadences that must not be able to
 * fail each other — the same independence `player_gameweek_points` documents.
 */
export const necroporraRounds = pgTable("necroporra_rounds", {
  gameweek: integer("gameweek").primaryKey(),
  /** When voting shuts: the round's own kickoff, as the API reported it. */
  closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One voter's pair for one round.
 *
 * **Two columns, not two rows**, and that is a deliberate trade. Neon's HTTP driver has
 * no transactions, so replacing a pair as delete-then-insert has a window in which the
 * voter holds nothing — and the failure lands on the person who was mid-change. A pair
 * in one row makes a change a single `onConflictDoUpdate`: atomic without a transaction,
 * the same reasoning that made a team claim one conditional `UPDATE`.
 *
 * It also makes "at most two votes" a fact of the schema rather than a rule somebody has
 * to remember to enforce. The cost is that a rule change to three votes would be a
 * migration; the rules are settled, and this is what the no-transactions constraint buys.
 *
 * `secondTeamId` is nullable so a voter may name one team and mean it. Both columns
 * `set null` on a deleted team, which loses a vote rather than the row — the same choice
 * `teams.userId` makes about a deleted user.
 */
export const necroporraVotes = pgTable(
  "necroporra_votes",
  {
    gameweek: integer("gameweek").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    firstTeamId: text("first_team_id").references(() => teams.id, { onDelete: "set null" }),
    secondTeamId: text("second_team_id").references(() => teams.id, { onDelete: "set null" }),
    castAt: timestamp("cast_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.gameweek, table.userId] }),
    // Naming the same team twice is one vote wearing two hats, and would read on the
    // page as a voter who had used both picks. Checked here as well as in the domain:
    // the domain protects the person, this protects the table.
    check(
      "necroporra_votes_distinct_teams",
      sql`${table.firstTeamId} is null or ${table.secondTeamId} is null or ${table.firstTeamId} <> ${table.secondTeamId}`,
    ),
  ],
);

/**
 * Who may sign in, besides the owner.
 *
 * Started life as `LEAGUE_ALLOWLIST`, an environment variable, and moved here on
 * 2026-09-09 for one concrete reason: **a Vercel variable change needs a redeploy to
 * take effect**, and that friction lands exactly when it hurts most — the afternoon the
 * owner invites twelve people, one address at a time.
 *
 * There is deliberately no second source. Keeping the variable as well would be two
 * lists for one rule, and whoever was bounced would have to be looked up in both.
 *
 * `ADMIN_EMAIL` stays an environment variable and is still always admitted, which is
 * what makes this table safe to own the rule: it is checked BEFORE this table is read,
 * so a database that is unreachable — or a list somebody empties by accident — never
 * locks out the one person who could put it right.
 *
 * The email is the primary key, stored already normalised (trimmed, lower-cased) by
 * `parseAllowlist`, so the same address cannot be added twice in two capitalisations.
 */
export const allowedEmails = pgTable("allowed_emails", {
  email: text("email").primaryKey(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  /** The user id that added it. Not a foreign key: an admin may later be deleted, and
   *  losing the row's history would be worse than keeping an id that resolves to nobody. */
  addedBy: text("added_by").notNull(),
});
