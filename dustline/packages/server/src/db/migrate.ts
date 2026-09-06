import { client } from './index.js';

// Idempotent DDL mirroring db/schema.ts. Created at server boot so a fresh
// (in-memory) PGLite always starts with the full schema, and safe to re-run
// on every restart (CREATE TABLE IF NOT EXISTS).
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS players (
  id serial PRIMARY KEY,
  username varchar(32) NOT NULL UNIQUE,
  total_kills integer NOT NULL DEFAULT 0,
  total_deaths integer NOT NULL DEFAULT 0,
  total_matches integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  headshots integer NOT NULL DEFAULT 0,
  shots_fired integer NOT NULL DEFAULT 0,
  shots_hit integer NOT NULL DEFAULT 0,
  damage_dealt integer NOT NULL DEFAULT 0,
  kd_ratio real NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS matches (
  id serial PRIMARY KEY,
  match_uuid varchar(36) NOT NULL UNIQUE,
  map_name varchar(32) NOT NULL DEFAULT 'de_dust',
  status varchar(16) NOT NULL DEFAULT 'warmup',
  t_score integer NOT NULL DEFAULT 0,
  ct_score integer NOT NULL DEFAULT 0,
  winner varchar(4),
  started_at timestamp,
  ended_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS match_players (
  id serial PRIMARY KEY,
  match_id integer NOT NULL REFERENCES matches(id),
  player_id integer NOT NULL REFERENCES players(id),
  team varchar(4) NOT NULL,
  kills integer NOT NULL DEFAULT 0,
  deaths integer NOT NULL DEFAULT 0,
  assists integer NOT NULL DEFAULT 0,
  headshots integer NOT NULL DEFAULT 0,
  shots_fired integer NOT NULL DEFAULT 0,
  shots_hit integer NOT NULL DEFAULT 0,
  damage_dealt integer NOT NULL DEFAULT 0,
  score integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kills (
  id serial PRIMARY KEY,
  match_id integer NOT NULL REFERENCES matches(id),
  killer_id integer NOT NULL REFERENCES players(id),
  victim_id integer NOT NULL REFERENCES players(id),
  weapon varchar(32) NOT NULL,
  headshot boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
`;

/** Create all tables if they do not exist yet. Safe to call repeatedly. */
export async function ensureSchema(): Promise<void> {
  await client.waitReady;
  await client.exec(SCHEMA_DDL);
}

// CLI entry: `bun src/db/migrate.ts` (the db:migrate script)
if (import.meta.main) {
  ensureSchema()
    .then(() => {
      console.log('✅ Schema ensured');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Schema creation failed:', err);
      process.exit(1);
    });
}
