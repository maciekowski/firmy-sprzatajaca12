import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import { rateLimit } from '@/lib/rate-limit';
import { createInvoiceCheckoutSession } from '@/lib/billing/stripe';
import { getInvoiceByToken } from '@/lib/services/invoices';

/**
 * Płatność online z linku publicznego (bez logowania).
 *
 * Tworzy prawdziwą sesję płatności w Stripe i zwraca adres przekierowania.
 * Bez kluczy API endpoint zwraca 503 i jawną informację — płatności NIE są symulowane.
 * Samo przekierowanie na stronę Stripe nie oznacza zapłaty: fakt zostaje
 * zaksięgowany dopiero po podpisanym webhooku (patrz /api/webhooks/stripe).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = clientIp(request);
  const limit = rateLimit(`pay:${ip}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Zbyt wiele prób płatności. Spróbuj ponownie za chwilę.' }, { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } });
  }

  const { token } = await params;
  const invoice = await getInvoiceByToken(token);
  if (!invoice) {
    return NextResponse.json({ error: 'Nie znaleziono faktury.' }, { status: 404 });
  }

  const remaining = invoice.totalCents - invoice.paidCents;
  if (invoice.status === 'CANCELLED' || remaining <= 0) {
    return NextResponse.json({ error: 'Ta faktura nie wymaga płatności.' }, { status: 409 });
  }

  const [organization] = await db.select().from(organizations).where(eq(organizations.id, invoice.organizationId)).limit(1);
  const base = (process.env.APP_URL ?? '').replace(/\/$/, '') || '';

  const result = await createInvoiceCheckoutSession({
    organizationId: invoice.organizationId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    amountCents: remaining,
    currency: organization?.currency ?? 'PLN',
    successUrl: `${base}/f/${token}?platnosc=oczekuje`,
    cancelUrl: `${base}/f/${token}?platnosc=anulowana`,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, notConfigured: result.notConfigured },
      { status: result.notConfigured ? 503 : 502 },
    );
  }

  return NextResponse.json({ ok: true, url: result.url });
}
