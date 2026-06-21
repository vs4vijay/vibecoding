import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (url) =>
          url.startsWith("postgresql://") || url.startsWith("postgres://"),
        {
          message:
            "DATABASE_URL must be a valid PostgreSQL connection string (postgresql://...)",
        },
      ),
    PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
    HOST: z.string().default("0.0.0.0"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    CORS_ORIGIN: z
      .string()
      .default("http://localhost:5173")
      .transform((val) => val.split(",").map((o) => o.trim())),
    APP_NAME: z.string().default("Subway Surfers Clone"),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
    JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  })
  .transform((data) => ({
    databaseUrl: data.DATABASE_URL,
    port: data.PORT,
    host: data.HOST,
    nodeEnv: data.NODE_ENV,
    corsOrigins: data.CORS_ORIGIN,
    appName: data.APP_NAME,
    workerPollIntervalMs: data.WORKER_POLL_INTERVAL_MS,
    jwtSecret: data.JWT_SECRET,
  }));

type EnvConfig = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues;
  // For transform errors, the issues array is empty; check inner errors
  const errors =
    issues.length > 0
      ? issues.map((e) => `  ✗ ${e.path.join(".")}: ${e.message}`).join("\n")
      : `  ✗ Validation failed: ${parsed.error.message}`;
  console.error("\n❌ Environment validation failed:\n");
  console.error(errors);
  console.error(
    "\n💡 Copy .env.example to .env and fill in the required values.\n",
  );
  process.exit(1);
}

export const config: EnvConfig = parsed.data;
export type AppConfig = EnvConfig;
