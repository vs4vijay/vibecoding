#!/usr/bin/env bun

import { PGlite } from '@electric-sql/pglite';
import { schemaSql } from '../src/lib/schema';

async function main() {
  const dbPath = process.env.PGLITE_DATA_DIR || './dev.db';
  console.log(`🗄️  Initializing PGlite database at ${dbPath}...`);

  const pglite = await PGlite.create(dbPath);

  try {
    await pglite.exec(schemaSql);
    console.log('✅ Database schema initialized');
  } finally {
    await pglite.close();
  }
}

main().catch((error) => {
  console.error('❌ Database initialization failed:', error);
  process.exit(1);
});
