import {
  pgTable,
  uuid,
  varchar,
  integer,
  real,
  timestamp,
  text,
  pgEnum,
  boolean,
  index,
} from "drizzle-orm/pg-core";

// --- Enums ---
export const achievementTypeEnum = pgEnum("achievement_type", [
  "distance",
  "coins",
  "score",
  "combo",
  "powerup",
]);

export const powerupTypeEnum = pgEnum("powerup_type", [
  "magnet",
  "jetpack",
  "multiplier",
  "super_sneakers",
]);

// --- Players ---
export const players = pgTable(
  "players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: varchar("username", { length: 50 }).notNull().unique(),
    displayName: varchar("display_name", { length: 100 }).notNull(),
    avatarUrl: varchar("avatar_url", { length: 500 }),
    totalDistance: integer("total_distance").default(0).notNull(),
    totalCoins: integer("total_coins").default(0).notNull(),
    highScore: integer("high_score").default(0).notNull(),
    gamesPlayed: integer("games_played").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    usernameIdx: index("players_username_idx").on(table.username),
    highScoreIdx: index("players_high_score_idx").on(table.highScore),
  }),
);

// --- Game Runs ---
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    playerId: uuid("player_id")
      .references(() => players.id, { onDelete: "cascade" })
      .notNull(),
    score: integer("score").notNull(),
    distance: real("distance").notNull(),
    coinsCollected: integer("coins_collected").default(0).notNull(),
    multiplier: integer("multiplier").default(1).notNull(),
    obstaclesDodged: integer("obstacles_dodged").default(0).notNull(),
    powerupsUsed: integer("powerups_used").default(0).notNull(),
    maxCombo: integer("max_combo").default(0).notNull(),
    playTimeSeconds: real("play_time_seconds").notNull(),
    playedAt: timestamp("played_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    playerIdIdx: index("runs_player_id_idx").on(table.playerId),
    scoreIdx: index("runs_score_idx").on(table.score),
    playedAtIdx: index("runs_played_at_idx").on(table.playedAt),
  }),
);

// --- Achievements ---
export const achievements = pgTable("achievements", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull(),
  icon: varchar("icon", { length: 10 }).notNull(), // emoji
  type: achievementTypeEnum("type").notNull(),
  // Requirement: distance_meters, coin_count, score_value, combo_count, or powerup_count
  requirementDistance: integer("requirement_distance"),
  requirementCoins: integer("requirement_coins"),
  requirementScore: integer("requirement_score"),
  requirementCombo: integer("requirement_combo"),
  requirementPowerups: integer("requirement_powerups"),
});

// --- Player Achievements ---
export const playerAchievements = pgTable("player_achievements", {
  id: uuid("id").defaultRandom().primaryKey(),
  playerId: uuid("player_id")
    .references(() => players.id, { onDelete: "cascade" })
    .notNull(),
  achievementId: uuid("achievement_id")
    .references(() => achievements.id, { onDelete: "cascade" })
    .notNull(),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// --- Power-ups (persistent inventory) ---
export const playerPowerups = pgTable("player_powerups", {
  id: uuid("id").defaultRandom().primaryKey(),
  playerId: uuid("player_id")
    .references(() => players.id, { onDelete: "cascade" })
    .notNull(),
  type: powerupTypeEnum("type").notNull(),
  quantity: integer("quantity").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// --- Jobs Queue (LISTEN/NOTIFY with SKIP LOCKED) ---
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: varchar("type", { length: 50 }).notNull(), // e.g., "process_run", "check_achievements"
    payload: text("payload").notNull(), // JSON string
    status: varchar("status", { length: 20 })
      .default("pending")
      .notNull(), // pending, processing, completed, failed
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    statusTypeIdx: index("jobs_status_type_idx").on(
      table.status,
      table.type,
    ),
    createdAtIdx: index("jobs_created_at_idx").on(table.createdAt),
  }),
);

// --- Type exports for TypeScript ---
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Achievement = typeof achievements.$inferSelect;
export type PlayerAchievement = typeof playerAchievements.$inferSelect;
export type PlayerPowerup = typeof playerPowerups.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
