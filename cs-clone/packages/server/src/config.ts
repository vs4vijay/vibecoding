import dotenv from 'dotenv';
import { z } from 'zod';
import { resolve } from 'path';

// Load .env file
dotenv.config({ path: resolve(process.cwd(), '../../.env') });

const configSchema = z.object({
  // Server
  serverPort: z.coerce.number().int().min(1).max(65535).default(3000),
  serverHost: z.string().default('0.0.0.0'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  databaseUrl: z.string().default('./data/cs-clone.db'),

  // Game
  maxPlayers: z.coerce.number().int().min(2).max(64).default(16),
  tickRate: z.coerce.number().int().min(20).max(128).default(60),
  matchDurationMs: z.coerce.number().int().min(60000).default(120000),
  warmupDurationMs: z.coerce.number().int().min(5000).default(30000),
});

const envVars = {
  serverPort: process.env.SERVER_PORT,
  serverHost: process.env.SERVER_HOST,
  nodeEnv: process.env.NODE_ENV,
  databaseUrl: process.env.DATABASE_URL,
  maxPlayers: process.env.MAX_PLAYERS,
  tickRate: process.env.TICK_RATE,
  matchDurationMs: process.env.MATCH_DURATION_MS,
  warmupDurationMs: process.env.WARMUP_DURATION_MS,
};

const parsed = configSchema.safeParse(envVars);

if (!parsed.success) {
  console.error('❌ Invalid configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const config = parsed.data;

export default config;
