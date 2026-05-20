import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://drishti:drishti@localhost:5432/drishti",
  },
  strict: true,
  verbose: false,
} satisfies Config;
