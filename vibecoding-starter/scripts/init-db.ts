#!/usr/bin/env bun

import { PGlite } from '@electric-sql/pglite';
import { schemaSql } from '../src/lib/schema';

function generateCuid() {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 15);
  return `c${timestamp}${randomStr}`;
}

async function main() {
  const dbPath = process.env.PGLITE_DATA_DIR || './dev.db';
  console.log(`🗄️  Initializing PGlite database at ${dbPath}...`);

  const pglite = await PGlite.create(dbPath);

  try {
    await pglite.exec(schemaSql);
    await pglite.exec('DELETE FROM items;');

    for (const [name, description] of [
      ['Sample Item 1', 'This is a sample item to demonstrate the system'],
      ['Sample Item 2', 'Another sample item with a background job trigger'],
      ['Sample Item 3', 'Third sample item for testing'],
    ]) {
      await pglite.query(
        'INSERT INTO items (id, name, description) VALUES ($1, $2, $3)',
        [generateCuid(), name, description]
      );
    }

    console.log('✅ Database schema created and 3 sample items seeded');
  } finally {
    await pglite.close();
  }
}

main().catch((error) => {
  console.error('❌ Database initialization failed:', error);
  process.exit(1);
});
