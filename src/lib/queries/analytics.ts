/**
 * Analityka — wszystkie wskaźniki liczone z bazy (SQL), żadnych stałych.
 * Każdy wzór jest jawny i policzalny ręcznie.
 */
import { and, desc, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { customers, invoices, jobItems, jobs, quotes, services, timeEntries } from '@/lib/db/schema';

export type Analytics = {
  revenuePaidCents: number;
  revenueInvoicedCents: number;
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  avgJobValueCents: number;
  jobsCompleted: number;
  jobsTotal: number;
  conversionRate: number | null;
  quotesSent: number;
  quotesAccepted: number;
  repeatCustomers: number;
  customersTotal: number;
  workedHours: number;
  revenueByMonth: { month: string; amountCents: number }[];
  topServices: { name: string; count: number; valueCents: number }[];
  /**
   * Przychód w podziale na waluty dokumentów.
   * System NIE przelicza walut po kursie — sumowanie różnych walut byłoby kłamstwem,
   * dlatego kwoty są raportowane osobno dla każdej z nich.
   */
  revenueByCurrency: { currency: string; invoicedCents: number; paidCents: number }[];
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getAnalytics(organizationId: string, months = 6): Promise<Analytics> {
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [invoiceTotals] = await db
    .select({
      invoiced: sql<string>`coalesce(sum(case when ${invoices.status} <> 'CANCELLED' then ${invoices.totalCents} else 0 end), 0)::text`,
      paid: sql<string>`coalesce(sum(case when ${invoices.status} <> 'CANCELLED' then ${invoices.paidCents} else 0 end), 0)::text`,
      outstanding: sql<string>`coalesce(sum(case when ${invoices.status} in ('SENT','PARTIALLY_PAID','OVERDUE','DRAFT') then ${invoices.totalCents} - ${invoices.paidCents} else 0 end), 0)::text`,
      overdue: sql<string>`coalesce(sum(case when ${invoices.status} = 'OVERDUE' then ${invoices.totalCents} - ${invoices.paidCents} else 0 end), 0)::text`,
      overdueCount: sql<string>`coalesce(sum(case when ${invoices.status} = 'OVERDUE' then 1 else 0 end), 0)::text`,
    })
    .from(invoices)
    .where(eq(invoices.organizationId, organizationId));

  // przychód w podziale na waluty (bez przeliczania kursami)
  const perCurrency = await db
    .select({
      currency: invoices.currency,
      invoiced: sql<string>`coalesce(sum(${invoices.totalCents}), 0)::text`,
      paid: sql<string>`coalesce(sum(${invoices.paidCents}), 0)::text`,
    })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), ne(invoices.status, 'CANCELLED')))
    .groupBy(invoices.currency);

  const [jobTotals] = await db
    .select({
      completed: sql<string>`coalesce(sum(case when ${jobs.status} = 'COMPLETED' then 1 else 0 end), 0)::text`,
      total: sql<string>`count(*)::text`,
      completedValue: sql<string>`coalesce(sum(case when ${jobs.status} = 'COMPLETED' then ${jobs.totalCents} else 0 end), 0)::text`,
    })
    .from(jobs)
    .where(eq(jobs.organizationId, organizationId));

  const [quoteTotals] = await db
    .select({
      sent: sql<string>`coalesce(sum(case when ${quotes.status} in ('SENT','VIEWED','ACCEPTED','REJECTED','EXPIRED') then 1 else 0 end), 0)::text`,
      accepted: sql<string>`coalesce(sum(case when ${quotes.status} = 'ACCEPTED' then 1 else 0 end), 0)::text`,
    })
    .from(quotes)
    .where(eq(quotes.organizationId, organizationId));

  const [timeTotals] = await db
    .select({
      seconds: sql<string>`coalesce(sum(${timeEntries.durationSeconds}), 0)::text`,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.organizationId, organizationId), eq(timeEntries.status, 'STOPPED')));

  // klienci powracający: mają więcej niż jedno zlecenie
  const [customerTotals] = await db
    .select({
      total: sql<string>`count(*)::text`,
      repeat: sql<string>`coalesce(sum(case when (select count(*) from jobs j where j.customer_id = ${customers.id} and j.organization_id = ${organizationId}) > 1 then 1 else 0 end), 0)::text`,
    })
    .from(customers)
    .where(eq(customers.organizationId, organizationId));

  const monthlyRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${invoices.issueDate}), 'YYYY-MM')`,
      amount: sql<string>`coalesce(sum(${invoices.totalCents}), 0)::text`,
    })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), gte(invoices.issueDate, since), ne(invoices.status, 'CANCELLED')))
    .groupBy(sql`date_trunc('month', ${invoices.issueDate})`)
    .orderBy(sql`date_trunc('month', ${invoices.issueDate})`);

  // najczęściej realizowane usługi — po pozycjach zleceń
  const topServiceRows = await db
    .select({
      name: sql<string>`coalesce(${services.name}, ${jobItems.name})`,
      count: sql<string>`count(*)::text`,
      value: sql<string>`coalesce(sum(${jobItems.grossCents}), 0)::text`,
    })
    .from(jobItems)
    .innerJoin(jobs, eq(jobs.id, jobItems.jobId))
    .leftJoin(services, eq(services.id, jobItems.serviceId))
    .where(and(eq(jobs.organizationId, organizationId), eq(jobs.status, 'COMPLETED')))
    .groupBy(sql`coalesce(${services.name}, ${jobItems.name})`)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  const jobsCompleted = toNumber(jobTotals?.completed);
  const quotesSent = toNumber(quoteTotals?.sent);
  const quotesAccepted = toNumber(quoteTotals?.accepted);

  return {
    revenuePaidCents: toNumber(invoiceTotals?.paid),
    revenueInvoicedCents: toNumber(invoiceTotals?.invoiced),
    outstandingCents: toNumber(invoiceTotals?.outstanding),
    overdueCents: toNumber(invoiceTotals?.overdue),
    overdueCount: toNumber(invoiceTotals?.overdueCount),
    avgJobValueCents: jobsCompleted > 0 ? Math.round(toNumber(jobTotals?.completedValue) / jobsCompleted) : 0,
    jobsCompleted,
    jobsTotal: toNumber(jobTotals?.total),
    conversionRate: quotesSent > 0 ? quotesAccepted / quotesSent : null,
    quotesSent,
    quotesAccepted,
    repeatCustomers: toNumber(customerTotals?.repeat),
    customersTotal: toNumber(customerTotals?.total),
    workedHours: Math.round((toNumber(timeTotals?.seconds) / 3600) * 10) / 10,
    revenueByMonth: monthlyRows.map((row) => ({ month: row.month, amountCents: toNumber(row.amount) })),
    topServices: topServiceRows.map((row) => ({ name: row.name, count: toNumber(row.count), valueCents: toNumber(row.value) })),
    revenueByCurrency: perCurrency.map((row) => ({
      currency: row.currency ?? 'PLN',
      invoicedCents: toNumber(row.invoiced),
      paidCents: toNumber(row.paid),
    })),
  };
}

/** Zestawienie należności do ściągnięcia (tylko realne rekordy). */
export async function getAging(organizationId: string) {
  return db
    .select({
      id: invoices.id,
      number: invoices.number,
      buyerName: invoices.buyerName,
      dueDate: invoices.dueDate,
      totalCents: invoices.totalCents,
      paidCents: invoices.paidCents,
      status: invoices.status,
    })
    .from(invoices)
    .where(and(eq(invoices.organizationId, organizationId), sql`${invoices.totalCents} - ${invoices.paidCents} > 0`, ne(invoices.status, 'CANCELLED')))
    .orderBy(invoices.dueDate);
}

export async function getUpcomingJobs(organizationId: string, days = 7) {
  const to = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return db
    .select({ id: jobs.id, number: jobs.number, title: jobs.title, scheduledStart: jobs.scheduledStart, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.organizationId, organizationId), gte(jobs.scheduledStart, new Date()), lte(jobs.scheduledStart, to)))
    .orderBy(jobs.scheduledStart);
}

export async function getUnassignedJobs(organizationId: string) {
  return db
    .select({ id: jobs.id, number: jobs.number, title: jobs.title, scheduledStart: jobs.scheduledStart })
    .from(jobs)
    .where(and(eq(jobs.organizationId, organizationId), isNull(jobs.crewId), sql`${jobs.status} in ('UNSCHEDULED','SCHEDULED','CONFIRMED')`))
    .orderBy(jobs.scheduledStart);
}
