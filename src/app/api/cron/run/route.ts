import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { automationRuns, customers, invoices, jobs, organizations } from '@/lib/db/schema';
import { rateLimit } from '@/lib/rate-limit';
import { enqueueAutomations, processDueRuns } from '@/lib/automation/engine';
import { writeAuditLog } from '@/lib/audit';

/**
 * Cron / worker — jedno wejście dla zadań cyklicznych:
 *  1) oznaczanie przeterminowanych faktur (status OVERDUE + trigger INVOICE_OVERDUE),
 *  2) wykrywanie nieaktywnych klientów (trigger CUSTOMER_INACTIVE),
 *  3) przetwarzanie kolejki automatyzacji (processDueRuns).
 *
 * Autoryzacja: nagłówek `x-cron-secret` lub `?secret=`.
 * Brak CRON_SECRET w konfiguracji = 503 i jawny komunikat (żadnego „udawanego” uruchomienia).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INACTIVE_DAYS = Number(process.env.CRON_INACTIVE_CUSTOMER_DAYS ?? 90);
const INACTIVE_REPEAT_DAYS = 30;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const provided =
    request.headers.get('x-cron-secret') ??
    request.nextUrl.searchParams.get('secret') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';
  return provided.length > 0 && provided === secret;
}

async function markOverdueInvoices(): Promise<number> {
  const updated = await db
    .update(invoices)
    .set({ status: 'OVERDUE', updatedAt: new Date() })
    .where(
      and(
        inArray(invoices.status, ['SENT', 'PARTIALLY_PAID']),
        lt(invoices.dueDate, new Date()),
      ),
    )
    .returning({ id: invoices.id, organizationId: invoices.organizationId });

  for (const invoice of updated) {
    await enqueueAutomations({
      organizationId: invoice.organizationId,
      trigger: 'INVOICE_OVERDUE',
      targetType: 'invoice',
      targetId: invoice.id,
    });
  }

  return updated.length;
}

/**
 * Klient „nieaktywny” = ma zakończone zlecenie, ale od `INACTIVE_DAYS` dni
 * nie było żadnego nowego zlecenia. Aby nie spamować, dla tego samego klienta
 * nie kolejkujemy triggera częściej niż co `INACTIVE_REPEAT_DAYS` dni.
 */
async function detectInactiveCustomers(): Promise<number> {
  const inactiveBefore = new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ id: customers.id, organizationId: customers.organizationId })
    .from(customers)
    .where(
      sql`exists (
        select 1 from ${jobs}
        where ${jobs.customerId} = ${customers.id}
          and ${jobs.status} = 'COMPLETED'
      )
      and not exists (
        select 1 from ${jobs}
        where ${jobs.customerId} = ${customers.id}
          and ${jobs.createdAt} > ${inactiveBefore}
      )`,
    );

  if (rows.length === 0) return 0;

  const recentRuns = await db
    .select({ targetId: automationRuns.targetId })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.targetType, 'customer'),
        inArray(automationRuns.targetId, rows.map((row) => row.id)),
        sql`${automationRuns.createdAt} > now() - interval '${sql.raw(String(INACTIVE_REPEAT_DAYS))} days'`,
      ),
    );

  const skip = new Set(recentRuns.map((row) => row.targetId));
  const targets = rows.filter((row) => !skip.has(row.id));

  for (const target of targets) {
    await enqueueAutomations({
      organizationId: target.organizationId,
      trigger: 'CUSTOMER_INACTIVE',
      targetType: 'customer',
      targetId: target.id,
    });
  }

  return targets.length;
}

async function run(): Promise<NextResponse> {
  const startedAt = Date.now();

  const overdue = await markOverdueInvoices();
  const inactive = await detectInactiveCustomers();
  const processed = await processDueRuns(100);

  await writeAuditLog({
    organizationId: null,
    userId: null,
    action: 'cron.run',
    entityType: 'system',
    entityId: null,
    meta: { overdue, inactive, ...processed },
  });

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    overdueInvoices: overdue,
    inactiveCustomers: inactive,
    automations: processed,
  });
}

export async function GET(request: NextRequest) {
  const ip = clientIp(request);
  const limit = rateLimit(`cron:${ip}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Zbyt wiele żądań.' }, { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } });
  }

  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { error: 'Integracja nie jest jeszcze skonfigurowana', detail: 'Brak zmiennej CRON_SECRET — zadania cykliczne są nieaktywne.' },
      { status: 503 },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json({ error: 'Nieprawidłowy sekret crona.' }, { status: 401 });
  }

  return run();
}

export const POST = GET;
