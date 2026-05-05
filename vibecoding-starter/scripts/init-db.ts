#!/usr/bin/env bun

import { PGlite } from '@electric-sql/pglite';

function generateCuid() {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 15);
  return `c${timestamp}${randomStr}`;
}

async function main() {
  console.log('🗄️  Initializing PGlite database...');

  const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';

  if (!databaseUrl.startsWith('file:')) {
    console.error('❌ This script is for PGlite initialization only.');
    console.error('   For PostgreSQL, use: bun run db:migrate');
    process.exit(1);
  }

  const dbPath = databaseUrl.replace('file:', '');

  const pglite = new PGlite(dbPath);
  await pglite.waitReady;

  try {
    console.log('📋 Creating tables...');

    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('⚙️  Creating Jobs table...');

    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        task_identifier TEXT NOT NULL,
        payload JSON DEFAULT '{}'::JSON NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        priority INTEGER DEFAULT 0 NOT NULL,
        run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        attempts INTEGER DEFAULT 0 NOT NULL,
        max_attempts INTEGER DEFAULT 25 NOT NULL,
        last_error TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        locked_at TIMESTAMP,
        locked_by TEXT,
        completed_at TIMESTAMP,
        key TEXT UNIQUE,
        queue TEXT
      );

      CREATE INDEX IF NOT EXISTS jobs_status_run_at_idx ON jobs (status, run_at);
      CREATE INDEX IF NOT EXISTS jobs_priority_run_at_idx ON jobs (priority, run_at);
      CREATE INDEX IF NOT EXISTS jobs_key_idx ON jobs (key);
    `);

    console.log('✅ Database schema created successfully');

    console.log('🌱 Seeding database...');

    await pglite.exec('DELETE FROM items;');

    const item1Id = generateCuid();
    const item2Id = generateCuid();
    const item3Id = generateCuid();

    await pglite.exec(`
      INSERT INTO items (id, name, description) VALUES
        ('${item1Id}', 'Sample Item 1', 'This is a sample item to demonstrate the system'),
        ('${item2Id}', 'Sample Item 2', 'Another sample item with a background job trigger'),
        ('${item3Id}', 'Sample Item 3', 'Third sample item for testing');
    `);

    console.log('✅ Created 3 sample items');
    console.log('🎉 Database initialization complete!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run: bun run dev');
    console.log('  2. Visit: http://localhost:7070');
    console.log('  3. Check jobs: http://localhost:7070/jobs');

    await pglite.close();
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    await pglite.close();
    process.exit(1);
  }
}

main();