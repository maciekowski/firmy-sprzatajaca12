/**
 * Jednorazowe uruchomienie zadań cyklicznych (np. z systemowego crona):
 *   npm run cron
 *
 * Skrypt wywołuje endpoint /api/cron/run z sekretem z pliku .env.
 * Bez CRON_SECRET serwer zwróci 503 — skrypt zgłosi to jawnie (brak udawanego sukcesu).
 */
import 'dotenv/config';

const BASE_URL = process.env.APP_URL ?? 'http://127.0.0.1:3000';
const SECRET = process.env.CRON_SECRET ?? '';

async function main(): Promise<void> {
  if (!SECRET) {
    console.error('✗ Brak CRON_SECRET w konfiguracji (.env). Zadania cykliczne są nieaktywne.');
    process.exit(1);
  }

  const response = await fetch(`${BASE_URL}/api/cron/run`, {
    method: 'POST',
    headers: { 'x-cron-secret': SECRET },
  });

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* odpowiedź nie jest JSON-em — wypisujemy surowy tekst */
  }

  console.log(`HTTP ${response.status}`, parsed);
  if (!response.ok) process.exit(1);
}

main().catch((error) => {
  console.error('✗ Cron nie powiódł się:', error instanceof Error ? error.message : error);
  process.exit(1);
});
