/**
 * Minimalny loader plików .env dla skryptów Node/TS i testów.
 * Next.js ładuje .env samodzielnie — tutaj obsługujemy procesy CLI (migracje, seed, testy).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let loaded = false;

export function loadEnv(cwd = process.cwd()): void {
  if (loaded) return;
  loaded = true;
  for (const file of ['.env.local', '.env']) {
    const p = path.resolve(cwd, file);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      let value = line.slice(eq + 1).trim();
      if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (!value) throw new Error(`Brak wymaganej zmiennej środowiskowej: ${name}`);
  return value;
}

export function getEnv(name: string, fallback = ''): string {
  loadEnv();
  return process.env[name] ?? fallback;
}
