import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

function loadMonorepoEnv() {
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

loadMonorepoEnv();

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  WORKER_ID: z.string().default(`worker-${Math.random().toString(36).slice(2, 8)}`),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_JOB_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  WEB_INTERNAL_BASE_URL: z.string().url().default("http://localhost:3000"),
  ML_BASE_URL: z.string().url(),
  INTERNAL_SHARED_SECRET: z.string().min(8),
  DEFAULT_SEED: z.coerce.number().int().default(42),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

let cached: WorkerConfig | undefined;
export function getConfig(): WorkerConfig {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid worker config:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
