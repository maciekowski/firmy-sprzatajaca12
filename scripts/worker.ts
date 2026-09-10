/**
 * Worker — pętla przetwarzająca kolejkę automatyzacji i zadania cykliczne:
 *   npm run worker
 *
 * Co `WORKER_INTERVAL_SECONDS` (domyślnie 60) wywołuje /api/cron/run,
 * który: oznacza przeterminowane faktury, wykrywa nieaktywnych klientów
 * i wykonuje uruchomienia automatyzacji, których czas nadszedł.
 */
import 'dotenv/config';

const BASE_URL = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const SECRET = process.env.CRON_SECRET ?? '';
const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_SECONDS ?? 60) * 1000;

let running = true;

async function tick(): Promise<void> {
  try {
    const response = await fetch(`${BASE_URL}/api/cron/run`, {
      method: 'POST',
      headers: { 'x-cron-secret': SECRET },
    });
    const body = await response.text();
    console.log(`[worker] ${new Date().toISOString()} HTTP ${response.status} ${body.slice(0, 400)}`);
  } catch (error) {
    console.error('[worker] błąd połączenia:', error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  if (!SECRET) {
    console.error('✗ Brak CRON_SECRET w konfiguracji (.env). Worker nie może działać.');
    process.exit(1);
  }

  console.log(`[worker] start — ${BASE_URL}/api/cron/run co ${INTERVAL_MS / 1000}s`);
  await tick();

  const timer = setInterval(() => {
    if (running) void tick();
  }, INTERVAL_MS);

  const stop = () => {
    running = false;
    clearInterval(timer);
    console.log('[worker] zatrzymany');
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

void main();
