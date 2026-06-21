import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema.js';

// In-memory database (PGLite)
// For persistence, pass a directory path: new PGlite('./data/cs-db')
export const client = new PGlite();

export const db = drizzle(client, { schema });

export async function initDatabase() {
  await client.waitReady;
  console.log('✅ PGLite database initialized (in-memory)');
}
