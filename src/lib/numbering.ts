/**
 * Numeracja dokumentów — licznik atomowy w bazie.
 *
 * Numer ma postać: PREFIKS/ROK/MIESIĄC/NNNN, np. OF/2026/09/0007.
 * Zwiększanie licznika odbywa się w jednej instrukcji UPSERT, więc dwa
 * równoległe zlecenia nigdy nie dostaną tego samego numeru.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { documentCounters } from '@/lib/db/schema';

export function documentPeriod(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}/${month}`;
}

export async function nextDocumentNumber(
  organizationId: string,
  prefix: string,
  date = new Date(),
): Promise<string> {
  const period = documentPeriod(date);
  const safePrefix = (prefix || 'DOC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'DOC';

  const rows = await db
    .insert(documentCounters)
    .values({ organizationId, prefix: safePrefix, period, current: 1 })
    .onConflictDoUpdate({
      target: [documentCounters.organizationId, documentCounters.prefix, documentCounters.period],
      set: { current: sql`${documentCounters.current} + 1`, updatedAt: new Date() },
    })
    .returning({ current: documentCounters.current });

  const current = rows[0]?.current ?? 1;
  const [year, month] = period.split('/');
  return `${safePrefix}/${year}/${month}/${String(current).padStart(4, '0')}`;
}
