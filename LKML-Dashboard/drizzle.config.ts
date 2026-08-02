import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/lkml';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  migrations: { table: 'drizzle_migrations', schema: 'public' },
});
