import { pgTable, serial, varchar, integer, timestamp, text, boolean, real } from 'drizzle-orm/pg-core';

export const players = pgTable('players', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 32 }).notNull().unique(),
  totalKills: integer('total_kills').notNull().default(0),
  totalDeaths: integer('total_deaths').notNull().default(0),
  totalMatches: integer('total_matches').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  headshots: integer('headshots').notNull().default(0),
  shotsFired: integer('shots_fired').notNull().default(0),
  shotsHit: integer('shots_hit').notNull().default(0),
  damageDealt: integer('damage_dealt').notNull().default(0),
  kdRatio: real('kd_ratio').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const matches = pgTable('matches', {
  id: serial('id').primaryKey(),
  matchUuid: varchar('match_uuid', { length: 36 }).notNull().unique(),
  mapName: varchar('map_name', { length: 32 }).notNull().default('de_dust'),
  status: varchar('status', { length: 16 }).notNull().default('warmup'),
  tScore: integer('t_score').notNull().default(0),
  ctScore: integer('ct_score').notNull().default(0),
  winner: varchar('winner', { length: 4 }),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const matchPlayers = pgTable('match_players', {
  id: serial('id').primaryKey(),
  matchId: integer('match_id').notNull().references(() => matches.id),
  playerId: integer('player_id').notNull().references(() => players.id),
  team: varchar('team', { length: 4 }).notNull(),
  kills: integer('kills').notNull().default(0),
  deaths: integer('deaths').notNull().default(0),
  assists: integer('assists').notNull().default(0),
  headshots: integer('headshots').notNull().default(0),
  shotsFired: integer('shots_fired').notNull().default(0),
  shotsHit: integer('shots_hit').notNull().default(0),
  damageDealt: integer('damage_dealt').notNull().default(0),
  score: integer('score').notNull().default(0),
});

export const kills = pgTable('kills', {
  id: serial('id').primaryKey(),
  matchId: integer('match_id').notNull().references(() => matches.id),
  killerId: integer('killer_id').notNull().references(() => players.id),
  victimId: integer('victim_id').notNull().references(() => players.id),
  weapon: varchar('weapon', { length: 32 }).notNull(),
  headshot: boolean('headshot').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
