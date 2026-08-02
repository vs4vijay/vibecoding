import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { z } from 'zod';

const BOOL_TRUE = new Set(['true', '1', 'yes', 'on']);
const BOOL_FALSE = new Set(['false', '0', 'no', 'off', '']);

function boolFromEnv(dflt: boolean) {
  return z
    .string()
    .trim()
    .optional()
    .default(dflt ? 'true' : 'false')
    .transform((v) => {
      const low = v.toLowerCase();
      if (BOOL_FALSE.has(low)) return false;
      if (BOOL_TRUE.has(low)) return true;
      return dflt;
    });
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DB_BACKEND: z.enum(['pglite', 'postgres']).default('pglite'),
    PGLITE_DATA_DIR: z.string().min(1).default('.pglite'),
    DATABASE_URL: z.string().min(1).optional(),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(5174),
    LKML_SOURCE: z.enum(['patchwork', 'lore', 'sample']).default('patchwork'),
    LKML_FETCH_LIMIT: z.coerce.number().int().min(1).max(500).default(60),
    LKML_FETCH_INTERVAL_MS: z.coerce.number().int().min(1000).max(86400000).default(900_000),
    LKML_HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(30_000),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    WORKER_ID: z.string().trim().min(1).optional(),
    JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    SEED_ON_START: boolFromEnv(true),
    AUTO_INGEST: boolFromEnv(true),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((val, ctx) => {
    if (val.DB_BACKEND === 'postgres' && !val.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when DB_BACKEND=postgres',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`[config] Invalid environment configuration (fail-fast):\n${issues}`);
  }
  return parsed.data;
}

loadDotenv({ path: join(process.cwd(), '.env'), quiet: true });

export const config: AppConfig = loadConfig();
