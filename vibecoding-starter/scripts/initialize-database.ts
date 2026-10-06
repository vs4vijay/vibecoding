#!/usr/bin/env bun

import { executeQuery } from '../src/lib/db';
import { schemaSql } from '../src/lib/schema';
import { withDatabase } from './local-database';

await withDatabase(async () => {
  await executeQuery(schemaSql);
  console.log('✅ Database schema initialized');
}).catch((error) => {
  console.error('❌ Database initialization failed:', error);
  process.exit(1);
});
