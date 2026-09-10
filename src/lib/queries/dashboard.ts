/**
 * Dane dashboardu — wyłącznie z rzeczywistej bazy, bez żadnych stałych.
 */
import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  crews,
  customers,
  invoices,
  jobs,
  leads,
  quotes,
  serviceRequests,
  timeEntries,
} from '@/lib/db/schema';

export type DashboardData = {
  revenuePaidCents: number;
  revenueMonthCents: number;
  revenueInvoiceTotalCents: number;
  openQuotes: number;
  openQuotesValueCents: number;
  quotesAccepted: number;
  quotesDecided: number;
  conversionRate: number | null;
  jobsToday: number;
  unpaidInvoices: number;
  unpaidInvoicesCents: number;
  overdueInvoices: number;
  overdueInvoicesCents: number;
  newLeads: number;
  newRequests: number;
  todayJobs: {
    id: string;
    number: string;
    title: string;
    status: string;
    scheduledStart: Date | null;
    customerName: string;
    city: string | null;
    crewName: string | null;
  }[];
  availableCrews: { id: string; name: string; color: string }[];
  conflicts: number;
  latestJobs: {
    id: string;
    number: string;
    title: string;
    status: string;
    customerName: string;
    scheduledStart: Date | null;
  }[];
  jobsByStatus: { status: string; count: number }[];
  revenueByMonth: { month: string; amountCents: number }[];
  workedSeconds: number;
};

function monthStart(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export async function getDashboardData(organizationId: string): Promise<DashboardData> {
  const now = new Date();
  const startOfMonth = monthStart(now);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  // --- przychód: suma zapłaconych kwot (płatności) ---
  const paymentsAgg = await db.execute<{ total: string | null }>(sql`
    select coalesce(sum(p.amount_cents), 0)::text as total
    from payments p
    where p.organization_id = ${organizationId}
  `);
  const revenuePaidCents = Number(paymentsAgg.rows[0]?.total ?? 0);

  const paymentsMonth = await db.execute<{ total: string | null }>(sql`
    select coalesce(sum(p.amount_cents), 0)::text as total
    from payments p
    where p.organization_id = ${organizationId} and p.paid_at >= ${startOfMonth}
  `);
  const revenueMonthCents = Number(paymentsMonth.rows[0]?.total ?? 0);

  const invoicesAgg = await db.execute<{ total: string | null }>(sql`
    select coalesce(sum(i.total_cents), 0)::text as total
    from invoices i
    where i.organization_id = ${organizationId} and i.status <> 'CANCELLED'
  `);
  const revenueInvoiceTotalCents = Number(invoicesAgg.rows[0]?.total ?? 0);

  // --- oferty otwarte ---
  const openQuoteRows = await db
    .select({ count: sql<number>`count(*)::int`, sum: sql<string>`coalesce(sum(${quotes.totalCents}), 0)::text` })
    .from(quotes)
    .where(and(eq(quotes.organizationId, organizationId), inArray(quotes.status, ['SENT', 'VIEWED'])));
  const openQuotes = Number(openQuoteRows[0]?.count ?? 0);
  const openQuotesValueCents = Number(openQuoteRows[0]?.sum ?? 0);

  const quoteStats = await db.execute<{ accepted: string; decided: string }>(sql`
    select
      coalesce(sum(case when status = 'ACCEPTED' then 1 else 0 end), 0)::text as accepted,
      coalesce(sum(case when status in ('ACCEPTED','REJECTED','EXPIRED') then 1 else 0 end), 0)::text as decided
    from quotes
    where organization_id = ${organizationId}
  `);
  const quotesAccepted = Number(quoteStats.rows[0]?.accepted ?? 0);
  const quotesDecided = Number(quoteStats.rows[0]?.decided ?? 0);
  const conversionRate = quotesDecided > 0 ? Math.round((quotesAccepted / quotesDecided) * 1000) / 10 : null;

  // --- zlecenia dzisiaj ---
  const todayRows = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      title: jobs.title,
      status: jobs.status,
      scheduledStart: jobs.scheduledStart,
      customerName: customers.displayName,
      city: jobs.addressCity,
      crewName: crews.name,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .leftJoin(crews, eq(crews.id, jobs.crewId))
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        gte(jobs.scheduledStart, startOfToday),
        lte(jobs.scheduledStart, endOfToday),
        sql`${jobs.status} not in ('CANCELLED')`,
      ),
    )
    .orderBy(jobs.scheduledStart);

  // --- faktury nieopłacone i przeterminowane ---
  const unpaidRows = await db.execute<{ count: string; sum: string }>(sql`
    select count(*)::text as count, coalesce(sum(total_cents - paid_cents), 0)::text as sum
    from invoices
    where organization_id = ${organizationId}
      and status in ('SENT','PARTIALLY_PAID','OVERDUE')
      and paid_cents < total_cents
  `);
  const unpaidInvoices = Number(unpaidRows.rows[0]?.count ?? 0);
  const unpaidInvoicesCents = Number(unpaidRows.rows[0]?.sum ?? 0);

  const overdueRows = await db.execute<{ count: string; sum: string }>(sql`
    select count(*)::text as count, coalesce(sum(total_cents - paid_cents), 0)::text as sum
    from invoices
    where organization_id = ${organizationId}
      and status in ('SENT','PARTIALLY_PAID','OVERDUE')
      and paid_cents < total_cents
      and due_date < now()
  `);
  const overdueInvoices = Number(overdueRows.rows[0]?.count ?? 0);
  const overdueInvoicesCents = Number(overdueRows.rows[0]?.sum ?? 0);

  // --- leady i zapytania ---
  const newLeadsRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, startOfMonth)));
  const newLeads = Number(newLeadsRows[0]?.count ?? 0);

  const newRequestsRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(serviceRequests)
    .where(and(eq(serviceRequests.organizationId, organizationId), eq(serviceRequests.status, 'NEW')));
  const newRequests = Number(newRequestsRows[0]?.count ?? 0);

  // --- dostępne ekipy (bez zlecenia w tym samym czasie dzisiaj) ---
  const busyCrewIds = new Set(todayRows.map((row) => row.crewName).filter(Boolean));
  const crewRows = await db
    .select({ id: crews.id, name: crews.name, color: crews.color })
    .from(crews)
    .where(and(eq(crews.organizationId, organizationId), eq(crews.isActive, true)));
  const availableCrews = crewRows.filter((crew) => !busyCrewIds.has(crew.name));

  // --- konflikty: ta sama ekipa ma dwa zlecenia w tym samym czasie ---
  const conflictRows = await db.execute<{ count: string }>(sql`
    with overlapping as (
      select a.id
      from jobs a
      join jobs b on a.organization_id = b.organization_id
        and a.id <> b.id
        and a.crew_id = b.crew_id
        and a.crew_id is not null
        and a.scheduled_start is not null
        and b.scheduled_start is not null
        and a.status not in ('CANCELLED','COMPLETED','NO_SHOW')
        and b.status not in ('CANCELLED','COMPLETED','NO_SHOW')
        and tstzrange(a.scheduled_start, coalesce(a.scheduled_end, a.scheduled_start + interval '1 hour'), '[)') &&
            tstzrange(b.scheduled_start, coalesce(b.scheduled_end, b.scheduled_start + interval '1 hour'), '[)')
      where a.organization_id = ${organizationId}
    )
    select (count(distinct id) / 2)::text as count from overlapping
  `);
  const conflicts = Number(conflictRows.rows[0]?.count ?? 0);

  // --- najnowsze zlecenia ---
  const latestJobs = await db
    .select({
      id: jobs.id,
      number: jobs.number,
      title: jobs.title,
      status: jobs.status,
      customerName: customers.displayName,
      scheduledStart: jobs.scheduledStart,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(eq(jobs.organizationId, organizationId))
    .orderBy(desc(jobs.createdAt))
    .limit(8);

  // --- rozkład statusów ---
  const statusRows = await db
    .select({ status: jobs.status, count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.organizationId, organizationId))
    .groupBy(jobs.status);
  const jobsByStatus = statusRows.map((row) => ({ status: row.status, count: Number(row.count) }));

  // --- przychód wg miesięcy (ostatnie 6) ---
  const revenueRows = await db.execute<{ month: string; amount: string }>(sql`
    select to_char(date_trunc('month', p.paid_at), 'YYYY-MM') as month,
           coalesce(sum(p.amount_cents), 0)::text as amount
    from payments p
    where p.organization_id = ${organizationId}
      and p.paid_at >= (date_trunc('month', now()) - interval '5 months')
    group by 1
    order by 1
  `);
  const revenueByMonth = revenueRows.rows.map((row) => ({ month: row.month, amountCents: Number(row.amount) }));

  // --- czas pracy (zakończone wpisy) ---
  const timeRows = await db
    .select({ total: sql<string>`coalesce(sum(${timeEntries.durationSeconds}), 0)::text` })
    .from(timeEntries)
    .where(and(eq(timeEntries.organizationId, organizationId), eq(timeEntries.status, 'STOPPED')));
  const workedSeconds = Number(timeRows[0]?.total ?? 0);

  return {
    revenuePaidCents,
    revenueMonthCents,
    revenueInvoiceTotalCents,
    openQuotes,
    openQuotesValueCents,
    quotesAccepted,
    quotesDecided,
    conversionRate,
    jobsToday: todayRows.length,
    unpaidInvoices,
    unpaidInvoicesCents,
    overdueInvoices,
    overdueInvoicesCents,
    newLeads,
    newRequests,
    todayJobs: todayRows,
    availableCrews,
    conflicts,
    latestJobs,
    jobsByStatus,
    revenueByMonth,
    workedSeconds,
  };
}
