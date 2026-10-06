#!/usr/bin/env bun

import { randomUUID } from 'node:crypto';
import { executeQuery } from '../src/lib/db';
import { withDatabase } from './local-database';

const items = [
  ['Sample Item 1', 'This is a sample item to demonstrate the system'],
  ['Sample Item 2', 'Another sample item with a background job trigger'],
  ['Sample Item 3', 'Third sample item for testing'],
] as const;

await withDatabase(async () => {
  console.log('🌱 Seeding database...');

  await executeQuery('DELETE FROM items');

  for (const [name, description] of items) {
    await executeQuery(
      'INSERT INTO items (id, name, description) VALUES ($1, $2, $3)',
      [randomUUID(), name, description]
    );
  }

  console.log(`✅ Seeded ${items.length} sample items`);
}).catch((error) => {
  console.error('❌ Seed failed:', error);
  process.exit(1);
});
