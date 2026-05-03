import { PrismaClient } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

declare global {
  var prisma: PrismaClient | undefined;
  var pglite: PGlite | undefined;
  var prismaPromise: Promise<PrismaClient> | undefined;
}

/**
 * Database client that supports both PostgreSQL (production) and PGlite (local development)
 *
 * Environment Detection:
 * - Uses PGlite when DATABASE_URL starts with "file:" (e.g., "file:./dev.db")
 * - Uses standard Postgres for all other DATABASE_URL formats
 *
 * For PGlite, Prisma connects through the raw query interface.
 * The database schema must be initialized first using `bun run db:init`.
 */
async function getPrismaClient(): Promise<PrismaClient> {
  if (global.prisma) {
    return global.prisma;
  }

  if (global.prismaPromise) {
    return await global.prismaPromise;
  }

  global.prismaPromise = createPrismaClient();
  global.prisma = await global.prismaPromise;
  return global.prisma;
}

async function createPrismaClient(): Promise<PrismaClient> {
  const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';

  // Use PGlite for local development (when DATABASE_URL starts with "file:")
  if (databaseUrl.startsWith('file:')) {
    console.log('🗄️  Using PGlite for local development');

    // Initialize PGlite instance (singleton)
    if (!global.pglite) {
      const dbPath = databaseUrl.replace('file:', '');
      global.pglite = new PGlite(dbPath);
      await global.pglite.waitReady;
    }

    // Create a Prisma client (not actually used for PGlite, but needed for type compatibility)
    const prismaClient = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });

    return prismaClient;
  }

  // Use standard Postgres for production
  console.log('🐘 Using PostgreSQL');

  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

// Helper to get direct PGlite instance (for direct queries or Graphile Worker)
export async function getPGliteInstance(): Promise<PGlite | null> {
  const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db';

  if (databaseUrl.startsWith('file:')) {
    if (!global.pglite) {
      const dbPath = databaseUrl.replace('file:', '');
      global.pglite = new PGlite(dbPath);
      await global.pglite.waitReady;
    }
    return global.pglite;
  }

  return null;
}

/**
 * Execute a query using PGlite or Prisma depending on environment
 */
export async function executeQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const pglite = await getPGliteInstance();

  if (pglite) {
    // Use PGlite directly
    const result = await pglite.query(sql, params);
    return result.rows as T[];
  }

  // Use Prisma's raw query for PostgreSQL
  const prisma = await getPrismaClient();
  return await prisma.$queryRawUnsafe<T[]>(sql, ...params);
}

// Export a function to get prisma client (for compatibility)
export async function getPrisma(): Promise<PrismaClient> {
  return await getPrismaClient();
}
