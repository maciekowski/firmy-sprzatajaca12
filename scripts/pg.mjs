#!/usr/bin/env node
/**
 * Lokalny serwer PostgreSQL (prawdziwy silnik Postgres 16 dostarczany przez npm).
 *
 * W środowisku produkcyjnym nie używamy tego skryptu — wystarczy ustawić
 * DATABASE_URL na zewnętrzną bazę (Neon / Supabase / Railway / własny serwer)
 * i wykonać `npm run db:deploy && npm run db:seed`.
 *
 * Komendy: init | start | stop | restart | status | reset
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT, file);
    if (existsSync(p)) {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (!m) continue;
        const key = m[1];
        if (process.env[key] !== undefined) continue;
        let value = (m[2] ?? '').trim();
        if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
}

loadEnv();

const DATA_DIR = path.resolve(ROOT, process.env.PGDATA_DIR ?? '.pgdata');
const PORT = Number(process.env.PGPORT ?? new URL(process.env.DATABASE_URL ?? '').port ?? 5433);
const USER = process.env.PGUSER ?? 'postgres';
const DB_NAME = process.env.PGDATABASE ?? 'serviceflow';
const LOG_FILE = path.join(DATA_DIR, 'server.log');

function pgBinDir() {
  const candidates = [
    path.join(ROOT, 'node_modules', '@embedded-postgres', 'linux-x64', 'native', 'bin'),
    '/usr/lib/postgresql/16/bin',
    '/usr/lib/postgresql/15/bin',
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'initdb'))) return dir;
  }
  return null;
}

const BIN = pgBinDir();
if (!BIN) {
  console.error('[pg] Brak binariów PostgreSQL. Uruchom: npm install');
  process.exit(1);
}

const bin = (name) => path.join(BIN, name);

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1200);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (res.error) throw res.error;
  return { code: res.status ?? 0, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

async function waitForServer(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(PORT)) return true;
    await sleep(400);
  }
  return isPortOpen(PORT);
}

function readPostmasterPid() {
  const pidFile = path.join(DATA_DIR, 'postmaster.pid');
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, 'utf8').split('\n')[0]?.trim());
  if (!Number.isInteger(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    try {
      rmSync(pidFile, { force: true });
    } catch {}
    return null;
  }
}

async function initCluster() {
  if (existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    console.log(`[pg] Katalog danych już istnieje: ${DATA_DIR}`);
    return;
  }
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  console.log(`[pg] Inicjalizacja klastra w ${DATA_DIR} ...`);
  const res = run(bin('initdb'), [
    '-D', DATA_DIR,
    '-U', USER,
    '--auth=trust',
    '--auth-local=trust',
    '--auth-host=trust',
    '-E', 'UTF8',
    '--locale=C',
  ]);
  if (res.code !== 0) {
    console.error(res.stderr || res.stdout);
    throw new Error('initdb nie powiodło się');
  }
  // Ogranicz nasłuch do localhosta — lokalny serwer developerski.
  const confPath = path.join(DATA_DIR, 'postgresql.conf');
  writeFileSync(
    confPath,
    `\n# --- serviceflow local dev ---\nlisten_addresses = '127.0.0.1'\nport = ${PORT}\nmax_connections = 100\nshared_buffers = 128MB\nfsync = off\nsynchronous_commit = off\nfull_page_writes = off\n`,
    { flag: 'a' },
  );
  console.log('[pg] Klaster zainicjowany.');
}

async function startServer() {
  const existing = readPostmasterPid();
  if (existing && (await isPortOpen(PORT))) {
    console.log(`[pg] Serwer już działa (pid ${existing}) na porcie ${PORT}.`);
    await ensureDatabase();
    return;
  }
  if (!existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    await initCluster();
  }
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  console.log(`[pg] Uruchamianie PostgreSQL na porcie ${PORT} ...`);
  const child = spawn(bin('postgres'), ['-D', DATA_DIR], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    cwd: DATA_DIR,
    env: { ...process.env, PGPORT: String(PORT) },
  });
  child.unref();
  const ok = await waitForServer();
  if (!ok) {
    console.error('[pg] Serwer nie wystartował. Sprawdź log:', LOG_FILE, path.join(DATA_DIR, 'log'));
    process.exit(1);
  }
  console.log(`[pg] Serwer działa na porcie ${PORT} (pid ${readPostmasterPid()}).`);
  await ensureDatabase();
}

async function ensureDatabase() {
  const { Client } = await import('pg');
  const admin = new Client({ host: '127.0.0.1', port: PORT, user: USER, database: 'postgres' });
  try {
    await admin.connect();
    const { rows } = await admin.query('select 1 from pg_database where datname = $1', [DB_NAME]);
    if (rows.length === 0) {
      await admin.query(`create database "${DB_NAME}"`);
      console.log(`[pg] Utworzono bazę danych: ${DB_NAME}`);
    } else {
      console.log(`[pg] Baza danych gotowa: ${DB_NAME}`);
    }
  } finally {
    await admin.end().catch(() => {});
  }
}

async function stopServer() {
  const pid = readPostmasterPid();
  if (!pid) {
    console.log('[pg] Serwer nie działa.');
    return;
  }
  const res = run(bin('pg_ctl'), ['-D', DATA_DIR, '-m', 'fast', '-w', 'stop']);
  if (res.code !== 0) {
    console.error(res.stderr || res.stdout);
    process.exit(1);
  }
  console.log('[pg] Serwer zatrzymany.');
}

async function resetCluster() {
  await stopServer();
  rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('[pg] Usunięto dane lokalnej bazy.');
  await initCluster();
  await startServer();
}

async function status() {
  const pid = readPostmasterPid();
  const open = await isPortOpen(PORT);
  console.log(`[pg] port=${PORT} pid=${pid ?? '-'} nasłuch=${open ? 'TAK' : 'NIE'} dane=${existsSync(path.join(DATA_DIR, 'PG_VERSION')) ? 'OK' : 'brak'}`);
  process.exit(open ? 0 : 1);
}

const cmd = process.argv[2] ?? 'status';

switch (cmd) {
  case 'init':
    await initCluster();
    break;
  case 'start':
    await startServer();
    break;
  case 'stop':
    await stopServer();
    break;
  case 'restart':
    await stopServer();
    await startServer();
    break;
  case 'reset':
    await resetCluster();
    break;
  case 'status':
    await status();
    break;
  default:
    console.log('Użycie: node scripts/pg.mjs <init|start|stop|restart|status|reset>');
    process.exit(1);
}

process.exit(0);
