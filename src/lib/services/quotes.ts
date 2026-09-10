/**
 * Usługi domenowe: cykl życia oferty (wysyłka, decyzja klienta, wygaśnięcie).
 *
 * Decyzja klienta zapada w portalu na podstawie tokenu — system zapisuje
 * czas, wersję oferty i dane audytowe (bez polegania na danych z frontendu).
 */
import { and, eq, inArray, lte } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  activities,
  customers,
  notifications,
  organizations,
  quoteEvents,
  quotes,
  type Quote,
} from '@/lib/db/schema';
import { sendCommunication } from '@/lib/comms/service';
import { DEFAULT_TEMPLATES, getTemplate } from '@/lib/comms/service';
import { renderTemplate } from '@/lib/comms/templates';
import { formatMoney } from '@/lib/money';
import { writeAuditLog } from '@/lib/audit';
import { enqueueAutomations, cancelPendingRuns } from '@/lib/automation/engine';
import type { OperationResult, ServiceContext } from './jobs';
import { getQuote, getQuoteByToken, markQuoteViewed } from './estimates';

export { getQuote, getQuoteByToken, markQuoteViewed };

function publicQuoteUrl(token: string): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/p/${token}`;
}

/**
 * Wysłanie oferty do klienta.
 * Wiadomość jest wysyłana tylko przez skonfigurowanego providera —
 * bez providera zapisujemy status SKIPPED_NO_PROVIDER (brak udawanej wysyłki).
 */
export async function sendQuote(
  ctx: ServiceContext,
  quoteId: string,
  options: { channel?: 'EMAIL' | 'SMS'; message?: string | null } = {},
): Promise<OperationResult<Quote & { deliveryNote?: string }>> {
  const quote = await getQuote(ctx.organizationId, quoteId);
  if (!quote) return { ok: false, error: 'Nie znaleziono oferty.' };
  if (quote.status === 'CANCELLED') return { ok: false, error: 'Oferta jest anulowana.' };

  const orgRows = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const organization = orgRows[0];

  const customerRows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, quote.customerId), eq(customers.organizationId, ctx.organizationId)))
    .limit(1);
  const customer = customerRows[0];

  const link = publicQuoteUrl(quote.publicToken);
  const template = await getTemplate(ctx.organizationId, 'quote_ready');
  const fallback = DEFAULT_TEMPLATES.quote_ready;

  const variables = {
    klient: customer?.displayName ?? 'Kliencie',
    firma: organization?.name ?? 'ServiceFlow',
    numer: quote.number,
    kwota: formatMoney(quote.totalCents, organization?.currency ?? 'PLN'),
    link,
    termin: quote.validUntil ? quote.validUntil.toLocaleDateString('pl-PL') : '',
  };

  let deliveryNote: string | undefined;
  const channel = options.channel ?? 'EMAIL';
  const recipient = channel === 'EMAIL' ? customer?.email : customer?.phone;

  if (recipient) {
    const result = await sendCommunication({
      organizationId: ctx.organizationId,
      channel,
      to: recipient,
      subject: template?.subject ?? fallback.subject,
      body: options.message ?? template?.body ?? fallback.body,
      templateKey: 'quote_ready',
      variables,
      customerId: quote.customerId,
      quoteId: quote.id,
      userId: ctx.userId,
      emailOptIn: customer?.emailOptIn ?? true,
      smsOptIn: customer?.smsOptIn ?? false,
    });
    if (!result.delivered) {
      deliveryNote = result.reason ?? 'Wiadomość nie została wysłana.';
    }
  } else {
    deliveryNote =
      channel === 'EMAIL'
        ? 'Klient nie ma adresu e-mail — ofertę można przekazać linkiem.'
        : 'Klient nie ma numeru telefonu — ofertę można przekazać linkiem.';
  }

  const [updated] = await db
    .update(quotes)
    .set({
      status: 'SENT',
      sentAt: quote.sentAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, ctx.organizationId)))
    .returning();

  await db.insert(quoteEvents).values({
    quoteId,
    type: 'SENT',
    message: deliveryNote ? `Ofertę oznaczono jako wysłaną. ${deliveryNote}` : 'Ofertę wysłano do klienta.',
    actorName: ctx.userName,
    meta: { channel, link, deliveryNote: deliveryNote ?? null },
  });

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'quote',
    entityId: quoteId,
    type: 'sent',
    message: `Wysłano ofertę ${quote.number}`,
    userId: ctx.userId,
    userName: ctx.userName,
  });

  // automatyzacje follow-up (kolejkowane z opóźnieniem zdefiniowanym w regule)
  await enqueueAutomations({
    organizationId: ctx.organizationId,
    trigger: 'QUOTE_SENT',
    targetType: 'quote',
    targetId: quoteId,
  });

  return { ok: true, data: { ...updated, deliveryNote } };
}

async function recordDecision(
  quote: Quote,
  decision: 'ACCEPTED' | 'REJECTED' | 'CHANGE_REQUESTED',
  input: { actorName?: string | null; note?: string | null; ip?: string | null; userAgent?: string | null },
): Promise<Quote> {
  const [updated] = await db
    .update(quotes)
    .set({
      status: decision === 'ACCEPTED' ? 'ACCEPTED' : decision === 'REJECTED' ? 'REJECTED' : quote.status,
      decidedAt: decision === 'CHANGE_REQUESTED' ? quote.decidedAt : new Date(),
      rejectionReason: decision === 'REJECTED' ? (input.note ?? null) : quote.rejectionReason,
      changeRequest: decision === 'CHANGE_REQUESTED' ? (input.note ?? null) : quote.changeRequest,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quote.id))
    .returning();

  await db.insert(quoteEvents).values({
    quoteId: quote.id,
    type: decision,
    message:
      decision === 'ACCEPTED'
        ? 'Klient zaakceptował ofertę'
        : decision === 'REJECTED'
          ? 'Klient odrzucił ofertę'
          : 'Klient poprosił o zmiany',
    actorName: input.actorName ?? 'Klient',
    ip: input.ip ?? null,
    meta: { note: input.note ?? null, version: quote.version, userAgent: input.userAgent ?? null },
  });

  await db.insert(activities).values({
    organizationId: quote.organizationId,
    entityType: 'quote',
    entityId: quote.id,
    type: decision.toLowerCase(),
    message:
      decision === 'ACCEPTED'
        ? `Zaakceptowano ofertę ${quote.number}`
        : decision === 'REJECTED'
          ? `Odrzucono ofertę ${quote.number}`
          : `Klient poprosił o zmiany w ofercie ${quote.number}`,
    meta: { note: input.note ?? null },
  });

  await writeAuditLog({
    organizationId: quote.organizationId,
    action: `quote.${decision.toLowerCase()}`,
    entityType: 'quote',
    entityId: quote.id,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    meta: { version: quote.version, totalCents: quote.totalCents },
  });

  // po decyzji nie wysyłamy już zaplanowanych follow-upów
  if (decision !== 'CHANGE_REQUESTED') {
    await cancelPendingRuns(quote.organizationId, quote.id);
  }

  // powiadomienie wewnętrzne dla zespołu
  await db.insert(notifications).values({
    organizationId: quote.organizationId,
    userId: null,
    title:
      decision === 'ACCEPTED'
        ? `Oferta ${quote.number} zaakceptowana`
        : decision === 'REJECTED'
          ? `Oferta ${quote.number} odrzucona`
          : `Oferta ${quote.number} — prośba o zmiany`,
    body: input.note ?? null,
    type: 'QUOTE',
    link: `/oferty/${quote.id}`,
  });

  return updated;
}

/** Akceptacja oferty przez klienta (portal — bez logowania, na podstawie tokenu). */
export async function acceptQuoteByToken(
  token: string,
  input: { actorName?: string | null; note?: string | null; ip?: string | null; userAgent?: string | null } = {},
): Promise<OperationResult<Quote>> {
  const quote = await getQuoteByToken(token);
  if (!quote) return { ok: false, error: 'Oferta nie istnieje lub link wygasł.' };
  if (quote.status === 'ACCEPTED') return { ok: false, error: 'Oferta została już zaakceptowana.' };
  if (quote.status === 'CANCELLED') return { ok: false, error: 'Oferta została anulowana.' };
  if (quote.status === 'REJECTED') return { ok: false, error: 'Oferta została odrzucona.' };
  if (quote.validUntil && quote.validUntil < new Date()) {
    await db.update(quotes).set({ status: 'EXPIRED', updatedAt: new Date() }).where(eq(quotes.id, quote.id));
    return { ok: false, error: 'Oferta wygasła — skontaktuj się z nami po aktualną wycenę.' };
  }

  const updated = await recordDecision(quote, 'ACCEPTED', input);

  await enqueueAutomations({
    organizationId: quote.organizationId,
    trigger: 'QUOTE_ACCEPTED',
    targetType: 'quote',
    targetId: quote.id,
  });

  return { ok: true, data: updated };
}

export async function rejectQuoteByToken(
  token: string,
  input: { actorName?: string | null; note?: string | null; ip?: string | null; userAgent?: string | null } = {},
): Promise<OperationResult<Quote>> {
  const quote = await getQuoteByToken(token);
  if (!quote) return { ok: false, error: 'Oferta nie istnieje lub link wygasł.' };
  if (quote.status === 'ACCEPTED') return { ok: false, error: 'Oferta została już zaakceptowana — skontaktuj się z nami.' };
  if (quote.status === 'REJECTED') return { ok: false, error: 'Oferta została już odrzucona.' };

  const updated = await recordDecision(quote, 'REJECTED', input);
  return { ok: true, data: updated };
}

export async function requestQuoteChangesByToken(
  token: string,
  input: { actorName?: string | null; note?: string | null; ip?: string | null; userAgent?: string | null } = {},
): Promise<OperationResult<Quote>> {
  const quote = await getQuoteByToken(token);
  if (!quote) return { ok: false, error: 'Oferta nie istnieje lub link wygasł.' };
  if (quote.status === 'ACCEPTED') return { ok: false, error: 'Oferta została już zaakceptowana.' };

  const updated = await recordDecision(quote, 'CHANGE_REQUESTED', input);
  return { ok: true, data: updated };
}

/** Akceptacja „z panelu” (np. decyzja telefoniczna odnotowana przez pracownika). */
export async function acceptQuoteManually(
  ctx: ServiceContext,
  quoteId: string,
  note?: string | null,
): Promise<OperationResult<Quote>> {
  const quote = await getQuote(ctx.organizationId, quoteId);
  if (!quote) return { ok: false, error: 'Nie znaleziono oferty.' };
  if (quote.status === 'ACCEPTED') return { ok: false, error: 'Oferta jest już zaakceptowana.' };

  const updated = await recordDecision(quote, 'ACCEPTED', { actorName: ctx.userName, note });

  await enqueueAutomations({
    organizationId: ctx.organizationId,
    trigger: 'QUOTE_ACCEPTED',
    targetType: 'quote',
    targetId: quoteId,
  });

  return { ok: true, data: updated };
}

export async function cancelQuote(ctx: ServiceContext, quoteId: string): Promise<OperationResult<Quote>> {
  const quote = await getQuote(ctx.organizationId, quoteId);
  if (!quote) return { ok: false, error: 'Nie znaleziono oferty.' };
  if (quote.status === 'ACCEPTED') return { ok: false, error: 'Zaakceptowanej oferty nie można anulować.' };

  const [updated] = await db
    .update(quotes)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, ctx.organizationId)))
    .returning();

  await db.insert(quoteEvents).values({
    quoteId,
    type: 'CANCELLED',
    message: 'Ofertę anulowano',
    actorName: ctx.userName,
  });

  await cancelPendingRuns(ctx.organizationId, quoteId);

  return { ok: true, data: updated };
}

/** Oznaczenie wygasłych ofert (uruchamiane cyklicznie). */
export async function expireQuotes(organizationId?: string): Promise<number> {
  const filters = [inArray(quotes.status, ['SENT', 'VIEWED']), lte(quotes.validUntil, new Date())];
  if (organizationId) filters.push(eq(quotes.organizationId, organizationId));

  const rows = await db
    .update(quotes)
    .set({ status: 'EXPIRED', updatedAt: new Date() })
    .where(and(...filters))
    .returning({ id: quotes.id, organizationId: quotes.organizationId });

  for (const row of rows) {
    await db.insert(quoteEvents).values({
      quoteId: row.id,
      type: 'EXPIRED',
      message: 'Oferta wygasła (minął termin ważności)',
      actorName: 'System',
    });
    await cancelPendingRuns(row.organizationId, row.id);
  }

  return rows.length;
}

export { renderTemplate };
