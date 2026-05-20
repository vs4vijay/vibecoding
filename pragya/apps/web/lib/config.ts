import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

function loadMonorepoEnv() {
  // Walk up from cwd looking for a .env file; populate process.env if not already set.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, "utf-8");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  WEB_HOST: z.string().default("localhost"),

  DB_DRIVER: z.enum(["pglite", "postgres"]).default("pglite"),
  DATABASE_URL: z.string().min(1),
  PGLITE_DATA_DIR: z.string().default("./pglite-data"),

  ML_BASE_URL: z.string().url(),
  ML_VERSION: z.string().default("0.1.0"),

  INTERNAL_SHARED_SECRET: z.string().min(8),
  WEB_INTERNAL_BASE_URL: z.string().url().default("http://localhost:3000"),

  DEFAULT_SEED: z.coerce.number().int().default(42),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  loadMonorepoEnv();
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Fail fast: surface the misconfiguration immediately.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const config = new Proxy({} as AppConfig, {
  get(_target, prop) {
    return getConfig()[prop as keyof AppConfig];
  },
});
