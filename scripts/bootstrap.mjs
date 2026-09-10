#!/usr/bin/env node
/**
 * Przywrócenie środowiska developerskiego w jednym kroku:
 *  npm run setup
 *
 * Kolejność:
 *  1) zależności (jeśli brak node_modules),
 *  2) plik .env z losowymi sekretami (jeśli brak),
 *  3) lokalny PostgreSQL (init + start),
 *  4) migracje bazy (drizzle-kit).
 *
 * Skrypt jest bezpieczny do wielokrotnego uruchomienia — niczego nie niszczy.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  console.log(`▸ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) {
    console.error(`✗ Polecenie nie powiodło się: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

function ensureEnv() {
  const envPath = path.join(ROOT, '.env');
  if (existsSync(envPath)) {
    console.log('✓ .env już istnieje');
    return;
  }
  const example = path.join(ROOT, '.env.example');
  if (!existsSync(example)) {
    console.error('✗ Brak .env.example — nie można utworzyć .env');
    process.exit(1);
  }
  let content = readFileSync(example, 'utf8');
  content = content
    .replace(/^APP_SECRET=.*$/m, `APP_SECRET="${randomBytes(36).toString('base64url')}"`)
    .replace(/^CRON_SECRET=.*$/m, `CRON_SECRET="${randomBytes(36).toString('base64url')}"`);
  writeFileSync(envPath, content, 'utf8');
  console.log('✓ Utworzono .env z losowymi sekretami (NIE commituj tego pliku)');
}

function portOpen(port, host = '127.0.0.1', timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function ensureDatabase() {
  const port = Number(readEnvValue('PGPORT') ?? 5433);
  if (existsSync(path.join(ROOT, 'node_modules'))) {
    if (await portOpen(port)) {
      console.log(`✓ PostgreSQL działa na porcie ${port}`);
    } else {
      run(process.execPath, ['scripts/pg.mjs', 'init']);
      run(process.execPath, ['scripts/pg.mjs', 'start']);
    }
    run('npx', ['drizzle-kit', 'migrate']);
  } else {
    console.log('! Pomijam bazę — najpierw instalacja zależności');
  }
}

function readEnvValue(key) {
  for (const file of ['.env.local', '.env']) {
    const filePath = path.join(ROOT, file);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && match[1] === key) return (match[2] ?? '').replace(/^["']|["']$/g, '');
    }
  }
  return process.env[key];
}

console.log('ServiceFlow — przygotowanie środowiska\n');

if (!existsSync(path.join(ROOT, 'node_modules'))) {
  run('npm', ['install', '--no-audit', '--no-fund']);
} else {
  console.log('✓ node_modules już istnieje');
}

ensureEnv();
await ensureDatabase();

console.log('\n✓ Gotowe. Uruchom: npm run dev');
