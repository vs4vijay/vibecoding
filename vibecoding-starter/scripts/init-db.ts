#!/usr/bin/env bun

/**
 * Initialize database for local development with PGlite
 * This creates the schema and seeds data
 */

import { PGlite } from '@electric-sql/pglite';

function generateCuid() {
  // Simple CUID-like generator for demo purposes
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

  // Initialize PGlite
  const pglite = new PGlite(dbPath);
  await pglite.waitReady;

  try {
    // Create tables using raw SQL (since db push doesn't work with PGlite)
    console.log('📋 Creating tables...');

    // Items table
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Graphile Worker tables
    console.log('⚙️  Creating Graphile Worker tables...');

    await pglite.exec(`
      CREATE SCHEMA IF NOT EXISTS graphile_worker;

      CREATE TABLE IF NOT EXISTS graphile_worker.migrations (
        id SERIAL PRIMARY KEY,
        ts TIMESTAMP DEFAULT now() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS graphile_worker.jobs (
        id BIGSERIAL PRIMARY KEY,
        job_queue_id INTEGER,
        task_identifier TEXT NOT NULL,
        payload JSON DEFAULT '{}'::JSON NOT NULL,
        priority INTEGER DEFAULT 0 NOT NULL,
        run_at TIMESTAMP DEFAULT now() NOT NULL,
        attempts INTEGER DEFAULT 0 NOT NULL,
        max_attempts INTEGER DEFAULT 25 NOT NULL,
        last_error TEXT,
        created_at TIMESTAMP DEFAULT now() NOT NULL,
        updated_at TIMESTAMP DEFAULT now() NOT NULL,
        key TEXT,
        locked_at TIMESTAMP,
        locked_by TEXT,
        revision INTEGER DEFAULT 0 NOT NULL,
        flags JSONB
      );

      CREATE INDEX IF NOT EXISTS jobs_priority_run_at_id_idx
        ON graphile_worker.jobs (priority, run_at, id);

      CREATE TABLE IF NOT EXISTS graphile_worker.known_crontabs (
        identifier TEXT PRIMARY KEY,
        known_since TIMESTAMP NOT NULL,
        last_execution TIMESTAMP
      );

      -- Add helper function for job queue
      CREATE OR REPLACE FUNCTION graphile_worker.add_job(
        identifier text,
        payload json DEFAULT NULL,
        queue_name text DEFAULT NULL,
        run_at timestamptz DEFAULT NULL,
        max_attempts integer DEFAULT 25,
        job_key text DEFAULT NULL,
        priority integer DEFAULT 0
      ) RETURNS graphile_worker.jobs AS $$
      DECLARE
        v_job graphile_worker.jobs;
      BEGIN
        INSERT INTO graphile_worker.jobs (
          task_identifier,
          payload,
          run_at,
          max_attempts,
          key,
          priority
        ) VALUES (
          identifier,
          COALESCE(payload, '{}'::json),
          COALESCE(run_at, now()),
          max_attempts,
          job_key,
          priority
        )
        RETURNING * INTO v_job;

        RETURN v_job;
      END;
      $$ LANGUAGE plpgsql VOLATILE;
    `);

    console.log('✅ Database schema created successfully');

    // Seed data
    console.log('🌱 Seeding database...');

    // Clear existing items
    await pglite.exec('DELETE FROM items;');

    // Insert sample items
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
    console.log('  2. Visit: http://localhost:3000');
    console.log('  3. Check jobs: http://localhost:3000/jobs');

    await pglite.close();
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    await pglite.close();
    process.exit(1);
  }
}

main();
