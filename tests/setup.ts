import { loadEnv } from '@/lib/env/load';

// Testy korzystają z prawdziwej bazy PostgreSQL (ta sama, którą używa aplikacja).
loadEnv();

if (!process.env.DATABASE_URL) {
  throw new Error('Brak DATABASE_URL — uruchom najpierw: npm run db:init && npm run db:start');
}
