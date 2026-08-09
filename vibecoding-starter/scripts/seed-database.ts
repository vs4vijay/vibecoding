#!/usr/bin/env bun

import { PGlite } from '@electric-sql/pglite';

function generateCuid() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `c${timestamp}${random}`;
}

async function main() {
  console.log('🌱 Seeding database...');

  const dbPath = process.env.PGLITE_DATA_DIR || './dev.db';
  const pglite = await PGlite.create(dbPath);

  try {
    await pglite.exec('DELETE FROM items;');

    const items = [
      ['Sample Item 1', 'This is a sample item to demonstrate the system'],
      ['Sample Item 2', 'Another sample item with a background job trigger'],
      ['Sample Item 3', 'Third sample item for testing'],
    ] as const;

    for (const [name, description] of items) {
      await pglite.query(
        'INSERT INTO items (id, name, description) VALUES ($1, $2, $3)',
        [generateCuid(), name, description]
      );
    }

    console.log(`✅ Seeded ${items.length} sample items`);
  } finally {
    await pglite.close();
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
