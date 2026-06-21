import { migrate } from 'drizzle-orm/pglite/migrator';
import { db, client } from './index.js';

async function runMigrations() {
  await client.waitReady;
  console.log('🔄 Running migrations...');
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log('✅ Migrations complete');
  process.exit(0);
}

runMigrations().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
