/**
 * Usługi domenowe: faktury i płatności.
 * Kwoty są zawsze liczone w groszach, a statusy wynikają z rzeczywistych danych.
 */
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  activities,
  customers,
  invoices,
  invoiceItems,
  jobs,
  jobItems,
  organizations,
  payments,
  type Invoice,
} from '@/lib/db/schema';
import { nextDocumentNumber } from '@/lib/numbering';
import { newId } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';
import { getTemplate, sendCommunication } from '@/lib/comms/service';
import { DEFAULT_TEMPLATES } from '@/lib/comms/templates';
import { formatMoney } from '@/lib/money';
import { enqueueAutomations } from '@/lib/automation/engine';
import type { ServiceContext, OperationResult } from './jobs';

export type InvoiceDraft = {
  customerId: string;
  jobId?: string | null;
  quoteId?: string | null;
  issueDate?: Date;
  dueDate?: Date;
  notes?: string | null;
  lines: {
    name: string;
    description?: string | null;
    quantity: number;
    unitPriceCents: number;
    unit: string;
    customUnitLabel?: string | null;
    taxRateBps: number;
  }[];
};

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export async function createInvoice(ctx: ServiceContext, draft: InvoiceDraft): Promise<OperationResult<Invoice>> {
  const orgRows = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const organization = orgRows[0];

  const customerRows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, draft.customerId), eq(customers.organizationId, ctx.organizationId)))
    .limit(1);
  const customer = customerRows[0];
  if (!customer) return { ok: false, error: 'Nie znaleziono klienta.' };

  if (draft.lines.length === 0) return { ok: false, error: 'Faktura musi mieć co najmniej jedną pozycję.' };

  // wyliczenie: netto i podatek per pozycja (deterministycznie)
  let subtotalCents = 0;
  let taxCents = 0;
  const computedLines = draft.lines.map((line, index) => {
    const netCents = Math.round(line.quantity * line.unitPriceCents);
    const lineTax = Math.round((netCents * line.taxRateBps) / 10_000);
    subtotalCents += netCents;
    taxCents += lineTax;
    return {
      name: line.name,
      description: line.description ?? null,
      unit: line.unit as never,
      customUnitLabel: line.customUnitLabel ?? null,
      quantity: String(line.quantity),
      unitPriceCents: line.unitPriceCents,
      taxRateBps: line.taxRateBps,
      netCents,
      taxCents: lineTax,
      grossCents: netCents + lineTax,
      sortOrder: index,
    };
  });

  const number = await nextDocumentNumber(ctx.organizationId, organization?.invoicePrefix ?? 'FV');
  const issueDate = draft.issueDate ?? new Date();
  const dueDate = draft.dueDate ?? addDays(issueDate, organization?.paymentTermsDays ?? 14);

  const [invoice] = await db
    .insert(invoices)
    .values({
      organizationId: ctx.organizationId,
      number,
      customerId: draft.customerId,
      jobId: draft.jobId ?? null,
      quoteId: draft.quoteId ?? null,
      status: 'DRAFT',
      publicToken: newId('itok'),
      issueDate,
      dueDate,
      buyerName: customer.displayName,
      buyerTaxId: customer.taxId,
      buyerStreet: customer.street,
      buyerCity: customer.city,
      buyerPostalCode: customer.postalCode,
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      paidCents: 0,
      notes: draft.notes ?? organization?.invoiceNotes ?? null,
      createdById: ctx.userId,
    })
    .returning();

  await db.insert(invoiceItems).values(computedLines.map((line) => ({ invoiceId: invoice.id, ...line })));

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'invoice',
    entityId: invoice.id,
    type: 'created',
    message: `Utworzono fakturę ${number}`,
    userId: ctx.userId,
    userName: ctx.userName,
  });

  // zdarzenie finansowe — musi być rozliczalne w logu audytowym
  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'invoice.created',
    entityType: 'invoice',
    entityId: invoice.id,
    meta: { number, totalCents: invoice.totalCents, jobId: draft.jobId ?? null },
  });

  return { ok: true, data: invoice };
}

/** Faktura ze zlecenia — pozycje i kwoty wynikają ze zrealizowanej pracy. */
export async function createInvoiceFromJob(ctx: ServiceContext, jobId: string): Promise<OperationResult<Invoice>> {
  const jobRows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, ctx.organizationId)))
    .limit(1);
  const job = jobRows[0];
  if (!job) return { ok: false, error: 'Nie znaleziono zlecenia.' };

  const items = await db.select().from(jobItems).where(eq(jobItems.jobId, jobId)).orderBy(asc(jobItems.sortOrder));
  if (items.length === 0) {
    return {
      ok: false,
      error:
        'Zlecenie nie ma pozycji do zafakturowania. Dodaj pozycje do zlecenia albo wystaw fakturę ręcznie z własnymi pozycjami.',
    };
  }

  return createInvoice(ctx, {
    customerId: job.customerId,
    jobId: job.id,
    quoteId: job.quoteId,
    lines: items.map((item) => ({
      name: item.name,
      description: item.description,
      quantity: Number(item.quantity),
      unitPriceCents: item.unitPriceCents,
      unit: item.unit,
      customUnitLabel: item.customUnitLabel,
      taxRateBps: item.taxRateBps,
    })),
  });
}

export function buildInvoiceFilters(organizationId: string, options: { status?: string } = {}) {
  const filters = [eq(invoices.organizationId, organizationId)];
  if (options.status && options.status !== 'ALL') filters.push(eq(invoices.status, options.status as never));
  return filters;
}

export async function listInvoices(
  organizationId: string,
  options: { status?: string; limit?: number; offset?: number } = {},
) {
  const filters = buildInvoiceFilters(organizationId, options);

  return db
    .select({ invoice: invoices, customerName: customers.displayName })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(...filters))
    .orderBy(desc(invoices.createdAt))
    .limit(options.limit ?? 200)
    .offset(options.offset ?? 0)
    .then((rows) => rows.map((row) => ({ ...row.invoice, customerName: row.customerName })));
}

/** Liczba faktur dla zadanych filtrów — potrzebna do paginacji. */
export async function countInvoices(organizationId: string, options: { status?: string } = {}): Promise<number> {
  const filters = buildInvoiceFilters(organizationId, options);
  const [{ value }] = await db.select({ value: sql<number>`count(*)::int` }).from(invoices).where(and(...filters));
  return Number(value ?? 0);
}

export async function getInvoice(organizationId: string, invoiceId: string) {
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getInvoiceByToken(token: string) {
  const rows = await db.select().from(invoices).where(eq(invoices.publicToken, token)).limit(1);
  return rows[0] ?? null;
}

/**
 * Wysyłka faktury do klienta (e-mail lub SMS).
 *
 * Zasady:
 *  - wiadomość idzie WYŁĄCZNIE przez skonfigurowanego providera — bez providera
 *    zapisujemy status SKIPPED_NO_PROVIDER i zwracamy jawną informację
 *    (brak „wysłano” na podstawie samego kliknięcia),
 *  - kategoria wiadomości to TRANSACTIONAL (wynika z realizacji usługi),
 *  - wysyłka jest idempotentna, gdy podano `idempotencyKey` (np. z automatyzacji).
 */
export async function sendInvoiceEmail(
  ctx: ServiceContext,
  invoiceId: string,
  options: { channel?: 'EMAIL' | 'SMS'; message?: string | null; idempotencyKey?: string | null } = {},
): Promise<OperationResult<Invoice & { deliveryNote?: string }>> {
  const invoice = await getInvoice(ctx.organizationId, invoiceId);
  if (!invoice) return { ok: false, error: 'Nie znaleziono faktury.' };
  if (invoice.status === 'CANCELLED') return { ok: false, error: 'Faktura jest anulowana.' };

  const [organization] = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, invoice.customerId), eq(customers.organizationId, ctx.organizationId)))
    .limit(1);

  const base = (process.env.APP_URL ?? '').replace(/\/$/, '');
  const link = `${base}/f/${invoice.publicToken}`;
  const template = await getTemplate(ctx.organizationId, 'invoice_ready');
  const fallback = DEFAULT_TEMPLATES.invoice_ready;
  const currency = organization?.currency ?? 'PLN';

  const variables = {
    klient: invoice.buyerName,
    firma: organization?.name ?? 'ServiceFlow',
    numer: invoice.number,
    kwota: formatMoney(invoice.totalCents, currency),
    link,
    termin: invoice.dueDate ? invoice.dueDate.toLocaleDateString('pl-PL') : '',
  };

  const channel = options.channel ?? 'EMAIL';
  const recipient = channel === 'EMAIL' ? customer?.email : customer?.phone;
  let deliveryNote: string | undefined;

  if (recipient) {
    const result = await sendCommunication({
      organizationId: ctx.organizationId,
      channel,
      to: recipient,
      subject: template?.subject ?? fallback.subject,
      body: options.message ?? template?.body ?? fallback.body,
      templateKey: 'invoice_ready',
      variables,
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      userId: ctx.userId,
      category: 'TRANSACTIONAL',
      emailOptIn: customer?.emailOptIn ?? true,
      smsOptIn: customer?.smsOptIn ?? false,
      transactionalOptIn: customer?.emailTransactionalOptIn ?? true,
      systemOptIn: customer?.emailSystemOptIn ?? true,
      automationOptIn: customer?.emailAutomationOptIn ?? true,
      marketingOptIn: customer?.emailMarketingOptIn ?? false,
      idempotencyKey: options.idempotencyKey ?? null,
    });

    if (!result.delivered) deliveryNote = result.reason ?? 'Wiadomość nie została wysłana.';
    if (result.deduplicated) deliveryNote = 'Wiadomość była już wysłana wcześniej (nie wysłano ponownie).';
  } else {
    deliveryNote =
      channel === 'EMAIL'
        ? 'Klient nie ma adresu e-mail — fakturę można przekazać linkiem.'
        : 'Klient nie ma numeru telefonu — fakturę można przekazać linkiem.';
  }

  const [updated] = await db
    .update(invoices)
    .set({
      status: invoice.paidCents > 0 ? 'PARTIALLY_PAID' : 'SENT',
      sentAt: invoice.sentAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, ctx.organizationId)))
    .returning();

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'invoice',
    entityId: invoiceId,
    type: 'sent',
    message: `Wysłano fakturę ${invoice.number}${deliveryNote ? ` — ${deliveryNote}` : ''}`,
    userId: ctx.userId,
    userName: ctx.userName,
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'invoice.sent_email',
    entityType: 'invoice',
    entityId: invoiceId,
    meta: { number: invoice.number, channel, delivered: !deliveryNote, deliveryNote: deliveryNote ?? null },
  });

  await enqueueAutomations({
    organizationId: ctx.organizationId,
    trigger: 'INVOICE_SENT',
    targetType: 'invoice',
    targetId: invoiceId,
  });

  return { ok: true, data: { ...updated, deliveryNote } };
}

export async function getInvoiceItems(invoiceId: string) {
  return db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId)).orderBy(asc(invoiceItems.sortOrder));
}

export async function getInvoicePayments(invoiceId: string) {
  return db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).orderBy(desc(payments.paidAt));
}

export async function markInvoiceSent(ctx: ServiceContext, invoiceId: string): Promise<OperationResult<Invoice>> {
  const invoice = await getInvoice(ctx.organizationId, invoiceId);
  if (!invoice) return { ok: false, error: 'Nie znaleziono faktury.' };
  if (invoice.status === 'CANCELLED') return { ok: false, error: 'Faktura jest anulowana.' };

  const [updated] = await db
    .update(invoices)
    .set({
      status: invoice.paidCents > 0 ? 'PARTIALLY_PAID' : 'SENT',
      sentAt: invoice.sentAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, ctx.organizationId)))
    .returning();

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'invoice.sent',
    entityType: 'invoice',
    entityId: invoiceId,
    meta: { number: invoice.number },
  });

  return { ok: true, data: updated };
}

/**
 * Rejestracja płatności.
 * Status faktury wynika z sumy zarejestrowanych płatności — nigdy z deklaracji klienta.
 */
export async function recordPayment(
  ctx: ServiceContext,
  invoiceId: string,
  input: { amountCents: number; method: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'STRIPE' | 'OTHER'; paidAt?: Date; reference?: string | null; note?: string | null },
): Promise<OperationResult<Invoice>> {
  const invoice = await getInvoice(ctx.organizationId, invoiceId);
  if (!invoice) return { ok: false, error: 'Nie znaleziono faktury.' };
  if (invoice.status === 'CANCELLED') return { ok: false, error: 'Nie można dodać płatności do anulowanej faktury.' };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: 'Kwota płatności musi być większa od zera.' };
  }
  if (input.amountCents > invoice.totalCents - invoice.paidCents) {
    return { ok: false, error: 'Kwota przewyższa pozostałą należność.' };
  }

  await db.insert(payments).values({
    organizationId: ctx.organizationId,
    invoiceId,
    amountCents: input.amountCents,
    method: input.method,
    paidAt: input.paidAt ?? new Date(),
    reference: input.reference ?? null,
    note: input.note ?? null,
    recordedById: ctx.userId,
  });

  const paidCents = invoice.paidCents + input.amountCents;
  let status: Invoice['status'] = invoice.status;
  if (paidCents >= invoice.totalCents) status = 'PAID';
  else if (paidCents > 0) status = 'PARTIALLY_PAID';

  const [updated] = await db
    .update(invoices)
    .set({
      paidCents,
      status,
      paidAt: status === 'PAID' ? (input.paidAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, ctx.organizationId)))
    .returning();

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'invoice',
    entityId: invoiceId,
    type: 'payment_recorded',
    message: `Zarejestrowano płatność ${(input.amountCents / 100).toFixed(2)} zł`,
    userId: ctx.userId,
    userName: ctx.userName,
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'payment.recorded',
    entityType: 'invoice',
    entityId: invoiceId,
    meta: { amountCents: input.amountCents, method: input.method, reference: input.reference ?? null, status },
  });

  return { ok: true, data: updated };
}

export async function cancelInvoice(ctx: ServiceContext, invoiceId: string): Promise<OperationResult<Invoice>> {
  const invoice = await getInvoice(ctx.organizationId, invoiceId);
  if (!invoice) return { ok: false, error: 'Nie znaleziono faktury.' };
  if (invoice.paidCents > 0) return { ok: false, error: 'Nie można anulować faktury z zarejestrowanymi płatnościami.' };

  const [updated] = await db
    .update(invoices)
    .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, ctx.organizationId)))
    .returning();

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'invoice.cancelled',
    entityType: 'invoice',
    entityId: invoiceId,
    meta: { number: invoice.number, totalCents: invoice.totalCents },
  });

  return { ok: true, data: updated };
}

/**
 * Aktualizacja statusów „przeterminowana”.
 * Wykonywana cyklicznie (worker/cron) oraz przy wejściu na listę faktur.
 */
export async function refreshOverdueInvoices(organizationId?: string): Promise<number> {
  const filters = [
    inArray(invoices.status, ['SENT', 'PARTIALLY_PAID']),
    lte(invoices.dueDate, new Date()),
    sql`${invoices.paidCents} < ${invoices.totalCents}`,
  ];
  if (organizationId) filters.push(eq(invoices.organizationId, organizationId));

  const rows = await db
    .update(invoices)
    .set({ status: 'OVERDUE', updatedAt: new Date() })
    .where(and(...filters))
    .returning({ id: invoices.id });

  return rows.length;
}

export async function getInvoiceSummary(organizationId: string) {
  const rows = await db.execute<{ total: string; paid: string; overdue: string; overdue_count: string }>(sql`
    select
      coalesce(sum(case when status <> 'CANCELLED' then total_cents else 0 end), 0)::text as total,
      coalesce(sum(paid_cents), 0)::text as paid,
      coalesce(sum(case when status = 'OVERDUE' then total_cents - paid_cents else 0 end), 0)::text as overdue,
      coalesce(sum(case when status = 'OVERDUE' then 1 else 0 end), 0)::text as overdue_count
    from invoices
    where organization_id = ${organizationId}
  `);
  const row = rows.rows[0];
  return {
    totalCents: Number(row?.total ?? 0),
    paidCents: Number(row?.paid ?? 0),
    overdueCents: Number(row?.overdue ?? 0),
    overdueCount: Number(row?.overdue_count ?? 0),
  };
}

/**
 * Księgowanie płatności z webhooka Stripe.
 *
 * Zasady:
 *  - wywoływane WYŁĄCZNIE po zweryfikowaniu podpisu webhooka (patrz /api/webhooks/stripe),
 *  - idempotentne: to samo payment_intent nie zostanie zaksięgowane dwa razy,
 *  - nie nadpisujemy kwoty faktury — księgujemy najwyżej pozostałą należność,
 *  - brak użytkownika (system/provider) jest jawnie oznaczony w logu audytowym.
 */
export type StripePaymentResult =
  | { ok: true; duplicate: boolean; invoice: Invoice }
  | { ok: false; error: string };

export async function recordStripePayment(input: {
  organizationId: string;
  invoiceId: string;
  amountCents: number;
  stripePaymentIntentId: string;
  sessionId?: string | null;
  paidAt?: Date;
}): Promise<StripePaymentResult> {
  const invoice = await getInvoice(input.organizationId, input.invoiceId);
  if (!invoice) return { ok: false, error: 'Nie znaleziono faktury.' };
  if (invoice.status === 'CANCELLED') return { ok: false, error: 'Faktura została anulowana.' };

  const [existing] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.organizationId, input.organizationId), eq(payments.stripePaymentIntentId, input.stripePaymentIntentId)))
    .limit(1);

  if (existing) return { ok: true, duplicate: true, invoice };

  const remaining = invoice.totalCents - invoice.paidCents;
  if (remaining <= 0) return { ok: true, duplicate: true, invoice };

  const amountCents = Math.min(input.amountCents, remaining);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: 'Kwota płatności z Stripe jest nieprawidłowa.' };
  }

  await db.insert(payments).values({
    organizationId: input.organizationId,
    invoiceId: invoice.id,
    amountCents,
    method: 'STRIPE',
    paidAt: input.paidAt ?? new Date(),
    reference: input.stripePaymentIntentId,
    note: input.sessionId ? `Stripe — sesja ${input.sessionId}` : 'Stripe — płatność online',
    recordedById: null,
    stripePaymentIntentId: input.stripePaymentIntentId,
  });

  const paidCents = invoice.paidCents + amountCents;
  const status: Invoice['status'] = paidCents >= invoice.totalCents ? 'PAID' : 'PARTIALLY_PAID';

  const [updated] = await db
    .update(invoices)
    .set({
      paidCents,
      status,
      paidAt: status === 'PAID' ? (input.paidAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, invoice.id), eq(invoices.organizationId, input.organizationId)))
    .returning();

  await db.insert(activities).values({
    organizationId: input.organizationId,
    entityType: 'invoice',
    entityId: invoice.id,
    type: 'payment_recorded',
    message: `Płatność online (Stripe): ${(amountCents / 100).toFixed(2)} zł`,
    userId: null,
    userName: 'Stripe (webhook)',
  });

  await writeAuditLog({
    organizationId: input.organizationId,
    userId: null,
    action: 'payment.stripe_recorded',
    entityType: 'invoice',
    entityId: invoice.id,
    meta: { paymentIntentId: input.stripePaymentIntentId, amountCents, method: 'STRIPE' },
  });

  if (status === 'PAID') {
    await enqueueAutomations({
      organizationId: input.organizationId,
      trigger: 'PAYMENT_RECEIVED',
      targetType: 'invoice',
      targetId: invoice.id,
    });
  }

  return { ok: true, duplicate: false, invoice: updated };
}
