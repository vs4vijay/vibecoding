import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
} satisfies Config;
