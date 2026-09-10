import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { communications } from '@/lib/db/schema';
import { verifyResendSignature } from '@/lib/comms/resend';
import { claimWebhookEvent, markWebhookError } from '@/lib/webhooks';

/**
 * Webhook Resend — aktualizuje status wiadomości na podstawie zdarzeń providera.
 *
 * Zasady:
 *  - podpis jest weryfikowany (standard Svix); nieufny request nie zmienia danych,
 *  - zdarzenie jest przetwarzane raz (idempotencja po externalId),
 *  - status DELIVERED ustawiamy wyłącznie po zdarzeniu „delivered”,
 *    a nie po samym przyjęciu requestu przez API.
 */

type ResendEvent = {
  type?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    to?: string[];
    subject?: string;
    bounce?: { message?: string };
    reason?: string;
  };
};

const STATUS_BY_EVENT: Record<string, 'SENT' | 'DELIVERED' | 'FAILED' | 'BOUNCED' | 'SUPPRESSED'> = {
  'email.sent': 'SENT',
  'email.delivered': 'DELIVERED',
  'email.delivery_delayed': 'SENT',
  'email.failed': 'FAILED',
  'email.bounced': 'BOUNCED',
  'email.suppressed': 'SUPPRESSED',
  'email.opened': 'SENT',
};

export async function POST(request: NextRequest) {
  const payload = await request.text();

  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');

  const verification = verifyResendSignature({
    payload,
    id,
    timestamp,
    signatureHeader: signature,
    secret: process.env.RESEND_WEBHOOK_SECRET,
  });

  let event: ResendEvent = {};
  try {
    event = payload ? JSON.parse(payload) : {};
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowy JSON.' }, { status: 400 });
  }

  const externalId = id ?? event.data?.email_id ?? null;
  if (!externalId) {
    return NextResponse.json({ error: 'Brak identyfikatora zdarzenia.' }, { status: 400 });
  }

  if (!verification.valid) {
    await claimWebhookEvent({
      provider: 'RESEND',
      externalId,
      type: event.type ?? 'unknown',
      payload: event as Record<string, unknown>,
      signatureValid: false,
    }).catch(() => ({ claimed: false }));
    await markWebhookError(externalId, 'RESEND', verification.reason ?? 'Nieprawidłowy podpis.');
    // 401, bo request nie został uwierzytelniony — dane nie są zmieniane
    return NextResponse.json({ error: 'Podpis webhooka nie został zweryfikowany.' }, { status: 401 });
  }

  const claim = await claimWebhookEvent({
    provider: 'RESEND',
    externalId,
    type: event.type ?? 'unknown',
    payload: event as Record<string, unknown>,
    signatureValid: true,
  });

  if (!claim.claimed) {
    return NextResponse.json({ ok: true, duplicated: true });
  }

  const providerMessageId = event.data?.email_id;
  const newStatus = STATUS_BY_EVENT[event.type ?? ''];
  if (!providerMessageId || !newStatus) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const now = new Date();
  const patch: Record<string, unknown> = {
    status: newStatus,
    externalStatus: event.type,
    lastEventAt: now,
  };

  if (newStatus === 'DELIVERED') patch.deliveredAt = now;
  if (newStatus === 'BOUNCED') patch.bouncedAt = now;
  if (newStatus === 'SUPPRESSED') patch.suppressedAt = now;
  if (event.type === 'email.opened') patch.openedAt = now;
  if (newStatus === 'FAILED' || newStatus === 'BOUNCED' || newStatus === 'SUPPRESSED') {
    patch.error = event.data?.bounce?.message ?? event.data?.reason ?? 'Wiadomość nie została dostarczona.';
  }

  await db
    .update(communications)
    .set(patch)
    .where(and(eq(communications.provider, 'resend'), eq(communications.providerMessageId, providerMessageId)));

  return NextResponse.json({ ok: true });
}
