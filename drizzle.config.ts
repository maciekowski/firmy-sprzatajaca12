import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/lib/env/load';

loadEnv();

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/serviceflow',
  },
  strict: true,
  verbose: true,
});
