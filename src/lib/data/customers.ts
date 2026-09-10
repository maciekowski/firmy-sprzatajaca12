/**
 * Dostęp do danych klientów.
 * KAŻDA funkcja przyjmuje organizationId i filtruje po nim dane —
 * to jedyny sposób, w jaki dane klientów opuszczają bazę.
 */
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  customerAddresses,
  customerContacts,
  customers,
  estimates,
  invoices,
  jobs,
  leads,
  quotes,
  type Customer,
} from '@/lib/db/schema';

export type CustomerListItem = Customer & {
  lastJobAt: Date | null;
  jobsCount: number;
  totalJobsValueCents: number;
  unpaidInvoicesCents: number;
  unpaidInvoicesCount: number;
};

export async function listCustomers(
  organizationId: string,
  options: { search?: string; status?: string; tag?: string; limit?: number } = {},
): Promise<CustomerListItem[]> {
  const filters: SQL[] = [eq(customers.organizationId, organizationId)];

  if (options.search) {
    const pattern = `%${options.search}%`;
    const searchFilter = or(
      ilike(customers.displayName, pattern),
      ilike(customers.email ?? '', pattern),
      ilike(customers.phone ?? '', pattern),
      ilike(customers.city ?? '', pattern),
      ilike(customers.companyName ?? '', pattern),
    );
    if (searchFilter) filters.push(searchFilter);
  }
  if (options.status && options.status !== 'ALL') {
    filters.push(eq(customers.status, options.status as never));
  }
  if (options.tag) {
    filters.push(sql`${options.tag} = any(${customers.tags})`);
  }

  const rows = await db
    .select({
      customer: customers,
      lastJobAt: sql<Date | null>`(select max(j.created_at) from jobs j where j.customer_id = ${customers.id})`,
      jobsCount: sql<number>`(select count(*)::int from jobs j where j.customer_id = ${customers.id})`,
      totalJobsValueCents: sql<number>`(select coalesce(sum(j.total_cents), 0)::int from jobs j where j.customer_id = ${customers.id})`,
      unpaidInvoicesCents: sql<number>`(select coalesce(sum(i.total_cents - i.paid_cents), 0)::int from invoices i where i.customer_id = ${customers.id} and i.status in ('SENT','PARTIALLY_PAID','OVERDUE'))`,
      unpaidInvoicesCount: sql<number>`(select count(*)::int from invoices i where i.customer_id = ${customers.id} and i.status in ('SENT','PARTIALLY_PAID','OVERDUE'))`,
    })
    .from(customers)
    .where(and(...filters))
    .orderBy(desc(customers.createdAt))
    .limit(options.limit ?? 200);

  return rows.map((row) => ({
    ...row.customer,
    lastJobAt: row.lastJobAt ?? null,
    jobsCount: Number(row.jobsCount ?? 0),
    totalJobsValueCents: Number(row.totalJobsValueCents ?? 0),
    unpaidInvoicesCents: Number(row.unpaidInvoicesCents ?? 0),
    unpaidInvoicesCount: Number(row.unpaidInvoicesCount ?? 0),
  }));
}

/** Pobranie klienta z kontrolą organizacji (zwraca null, gdy klient jest z innej firmy). */
export async function getCustomer(organizationId: string, customerId: string): Promise<Customer | null> {
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listAddresses(organizationId: string, customerId: string) {
  // dołączamy warunek organizacji poprzez klienta — ochrona przed IDOR
  return db
    .select({ address: customerAddresses })
    .from(customerAddresses)
    .innerJoin(customers, eq(customers.id, customerAddresses.customerId))
    .where(and(eq(customers.organizationId, organizationId), eq(customerAddresses.customerId, customerId)))
    .orderBy(asc(customerAddresses.isDefault), asc(customerAddresses.createdAt))
    .then((rows) => rows.map((row) => row.address));
}

export async function listContacts(organizationId: string, customerId: string) {
  return db
    .select({ contact: customerContacts })
    .from(customerContacts)
    .innerJoin(customers, eq(customers.id, customerContacts.customerId))
    .where(and(eq(customers.organizationId, organizationId), eq(customerContacts.customerId, customerId)))
    .orderBy(asc(customerContacts.createdAt))
    .then((rows) => rows.map((row) => row.contact));
}

export async function getCustomerTimeline(organizationId: string, customerId: string) {
  const [customerJobs, customerQuotes, customerInvoices, customerLeads, customerEstimates] = await Promise.all([
    db
      .select({ id: jobs.id, number: jobs.number, title: jobs.title, status: jobs.status, totalCents: jobs.totalCents, createdAt: jobs.createdAt, scheduledStart: jobs.scheduledStart })
      .from(jobs)
      .where(and(eq(jobs.organizationId, organizationId), eq(jobs.customerId, customerId)))
      .orderBy(desc(jobs.createdAt))
      .limit(20),
    db
      .select({ id: quotes.id, number: quotes.number, status: quotes.status, totalCents: quotes.totalCents, createdAt: quotes.createdAt, publicToken: quotes.publicToken })
      .from(quotes)
      .where(and(eq(quotes.organizationId, organizationId), eq(quotes.customerId, customerId)))
      .orderBy(desc(quotes.createdAt))
      .limit(20),
    db
      .select({ id: invoices.id, number: invoices.number, status: invoices.status, totalCents: invoices.totalCents, paidCents: invoices.paidCents, dueDate: invoices.dueDate, createdAt: invoices.createdAt })
      .from(invoices)
      .where(and(eq(invoices.organizationId, organizationId), eq(invoices.customerId, customerId)))
      .orderBy(desc(invoices.createdAt))
      .limit(20),
    db
      .select({ id: leads.id, title: leads.title, status: leads.status, createdAt: leads.createdAt })
      .from(leads)
      .where(and(eq(leads.organizationId, organizationId), eq(leads.customerId, customerId)))
      .orderBy(desc(leads.createdAt))
      .limit(10),
    db
      .select({ id: estimates.id, number: estimates.number, status: estimates.status, totalCents: estimates.totalCents, createdAt: estimates.createdAt })
      .from(estimates)
      .where(and(eq(estimates.organizationId, organizationId), eq(estimates.customerId, customerId)))
      .orderBy(desc(estimates.createdAt))
      .limit(10),
  ]);

  return { jobs: customerJobs, quotes: customerQuotes, invoices: customerInvoices, leads: customerLeads, estimates: customerEstimates };
}

export async function countCustomers(organizationId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customers)
    .where(eq(customers.organizationId, organizationId));
  return Number(rows[0]?.count ?? 0);
}
