import 'server-only';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/**
 * Jeden pool na proces (w dev Next.js przeładowuje moduły — trzymamy w globalThis).
 */
const globalForDb = globalThis as unknown as {
  __serviceflowPool?: Pool;
  __serviceflowDb?: NodePgDatabase<typeof schema>;
};

function createPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Brak DATABASE_URL — skonfiguruj bazę PostgreSQL (.env).');
  }
  return new Pool({
    connectionString: url,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
}

export const pool: Pool = globalForDb.__serviceflowPool ?? createPool();
export const db: NodePgDatabase<typeof schema> = globalForDb.__serviceflowDb ?? drizzle(pool, { schema });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__serviceflowPool = pool;
  globalForDb.__serviceflowDb = db;
}

export type DB = NodePgDatabase<typeof schema>;
export { schema };
