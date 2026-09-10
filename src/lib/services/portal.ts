/**
 * Publiczne konto klienta (bez logowania).
 *
 * Dostęp odbywa się na podstawie losowego tokenu przypisanego do klienta.
 * Widać wyłącznie dane tej jednej organizacji i tego jednego klienta,
 * a dokumenty w statusie ROBOCZYM (DRAFT) nie są publikowane.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db/client';
import { customers, invoices, jobs, organizations, quotes } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';

export type ServiceContext = { organizationId: string; userId: string; userName?: string | null };
export type OperationResult<T> = { ok: true; data: T } | { ok: false; error: string };

function newPortalToken(): string {
  return `ptok_${randomBytes(16).toString('base64url')}`;
}

/** Tworzy (lub zwraca istniejący) link do konta klienta. */
export async function ensureCustomerPortalToken(
  ctx: ServiceContext,
  customerId: string,
): Promise<OperationResult<{ token: string }>> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)))
    .limit(1);

  if (!customer) return { ok: false, error: 'Nie znaleziono klienta.' };
  if (customer.portalToken) return { ok: true, data: { token: customer.portalToken } };

  const token = newPortalToken();
  await db
    .update(customers)
    .set({ portalToken: token, portalTokenCreatedAt: new Date(), updatedAt: new Date() })
    .where(eq(customers.id, customerId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'customer.portal_link_created',
    entityType: 'customer',
    entityId: customerId,
  });

  return { ok: true, data: { token } };
}

/** Odwołuje dostęp — stary link przestaje działać (404). */
export async function revokeCustomerPortalToken(ctx: ServiceContext, customerId: string): Promise<OperationResult<null>> {
  const [updated] = await db
    .update(customers)
    .set({ portalToken: null, portalTokenCreatedAt: null, updatedAt: new Date() })
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, ctx.organizationId)))
    .returning();

  if (!updated) return { ok: false, error: 'Nie znaleziono klienta.' };

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'customer.portal_link_revoked',
    entityType: 'customer',
    entityId: customerId,
  });

  return { ok: true, data: null };
}

export type PortalData = {
  organizationName: string;
  customer: { id: string; displayName: string; email: string | null; phone: string | null };
  quotes: {
    id: string;
    number: string;
    status: string;
    totalCents: number;
    currency: string;
    createdAt: Date;
    validUntil: Date | null;
    publicToken: string;
  }[];
  jobs: {
    id: string;
    number: string;
    title: string;
    status: string;
    scheduledStart: Date | null;
    address: string | null;
  }[];
  invoices: {
    id: string;
    number: string;
    status: string;
    totalCents: number;
    paidCents: number;
    currency: string;
    dueDate: Date | null;
    publicToken: string;
  }[];
};

/**
 * Dane konta klienta. Zwraca null, gdy token nie istnieje — strona wtedy zwraca 404.
 * Dokumenty robocze (DRAFT) nie są widoczne dla klienta.
 */
export async function getCustomerPortalData(token: string): Promise<PortalData | null> {
  const rows = await db
    .select({ customer: customers, organizationName: organizations.name })
    .from(customers)
    .innerJoin(organizations, eq(organizations.id, customers.organizationId))
    .where(eq(customers.portalToken, token))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const { customer } = row;

  const quoteRows = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.organizationId, customer.organizationId), eq(quotes.customerId, customer.id), inArray(quotes.status, ['SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED'])))
    .orderBy(desc(quotes.createdAt));

  const jobRows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.organizationId, customer.organizationId), eq(jobs.customerId, customer.id), inArray(jobs.status, ['SCHEDULED', 'CONFIRMED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])))
    .orderBy(desc(jobs.createdAt));

  const invoiceRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, customer.organizationId), eq(invoices.customerId, customer.id), inArray(invoices.status, ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'])))
    .orderBy(desc(invoices.createdAt));

  return {
    organizationName: row.organizationName,
    customer: {
      id: customer.id,
      displayName: customer.displayName,
      email: customer.email,
      phone: customer.phone,
    },
    quotes: quoteRows.map((quote) => ({
      id: quote.id,
      number: quote.number,
      status: quote.status,
      totalCents: quote.totalCents,
      currency: quote.currency ?? 'PLN',
      createdAt: quote.createdAt,
      validUntil: quote.validUntil,
      publicToken: quote.publicToken,
    })),
    jobs: jobRows.map((job) => ({
      id: job.id,
      number: job.number,
      title: job.title,
      status: job.status,
      scheduledStart: job.scheduledStart,
      address: [job.addressStreet, job.addressCity].filter(Boolean).join(', ') || null,
    })),
    invoices: invoiceRows.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      totalCents: invoice.totalCents,
      paidCents: invoice.paidCents,
      currency: invoice.currency ?? 'PLN',
      dueDate: invoice.dueDate,
      publicToken: invoice.publicToken,
    })),
  };
}
