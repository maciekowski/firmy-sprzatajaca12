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

export async function listInvoices(organizationId: string, options: { status?: string } = {}) {
  const filters = [eq(invoices.organizationId, organizationId)];
  if (options.status && options.status !== 'ALL') filters.push(eq(invoices.status, options.status as never));

  return db
    .select({ invoice: invoices, customerName: customers.displayName })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(and(...filters))
    .orderBy(desc(invoices.createdAt))
    .limit(200)
    .then((rows) => rows.map((row) => ({ ...row.invoice, customerName: row.customerName })));
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
