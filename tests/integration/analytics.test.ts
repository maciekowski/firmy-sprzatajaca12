import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/client';
import { timeEntries } from '@/lib/db/schema';
import { getAging, getAnalytics, getUnassignedJobs, getUpcomingJobs } from '@/lib/queries/analytics';
import { createJob, completeJob, startTimeEntry, stopTimeEntry } from '@/lib/services/jobs';
import { createInvoice, recordPayment } from '@/lib/services/invoices';
import { createEstimate, createQuoteFromEstimate } from '@/lib/services/estimates';
import { createTestCustomer, createTestOrganization, createTestService, deleteTestOrganization, deleteTestUser } from '../helpers';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

/**
 * Analityka liczona w SQL — test sprawdza, że liczby zgadzają się
 * z danymi w bazie (żadnego „wymyślania” wyników).
 */
describe('analityka (prawdziwe agregaty SQL)', () => {
  let empty: Fixture;
  let org: Fixture;

  beforeAll(async () => {
    empty = await createTestOrganization('AN-EMPTY');
    org = await createTestOrganization('AN-DATA');

    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient Analityka' });
    const service = await createTestService(org.organizationId, { name: 'Sprzątanie analityka', basePriceCents: 10_000 });

    // 1) wycena → oferta → akceptacja (konwersja 100% w tej organizacji)
    const estimate = await createEstimate(org.ctx, {
      customerId: customer.id,
      lines: [
        {
          serviceId: service.id,
          name: 'Sprzątanie analityka',
          quantity: 2,
          unit: 'VISIT',
          customUnitLabel: null,
          description: null,
          unitPriceCents: 10_000,
          taxRateBps: 2300,
        },
      ],
      travelFeeType: 'NONE',
      travelDistanceKm: null,
      isUrgent: false,
      notes: null,
      terms: null,
    });

    const quote = await createQuoteFromEstimate(org.ctx, estimate.id, { validDays: 14 });
    if (!quote) throw new Error('Nie utworzono oferty');

    const { eq } = await import('drizzle-orm');
    const { quotes } = await import('@/lib/db/schema');
    // oferta wysłana, a następnie zaakceptowana przez klienta (portal)
    await db.update(quotes).set({ status: 'SENT', sentAt: new Date() }).where(eq(quotes.id, quote.id));
    const { acceptQuoteByToken } = await import('@/lib/services/quotes');
    const accepted = await acceptQuoteByToken(quote.publicToken, { actorName: 'Klient Analityka' });
    if (!accepted.ok) throw new Error(accepted.error);

    // 2) zlecenie z zaakceptowanej oferty (ma pozycje i wartość)
    const { createJobFromQuote } = await import('@/lib/services/jobs');
    const job = await createJobFromQuote(org.ctx, quote.id);
    if (!job.ok) throw new Error(job.error);

    const completed = await completeJob(org.ctx, job.data!.id, { note: 'Zrobione' });
    if (!completed.ok) throw new Error(completed.error);

    // 3) czas pracy: 2 godziny (liczone serwerowo przy zatrzymaniu licznika)
    const started = await startTimeEntry(org.ctx, job.data!.id);
    if (!started.ok) throw new Error(started.error);
    await db
      .update(timeEntries)
      .set({ startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(timeEntries.id, started.data!.id));
    const stopped = await stopTimeEntry(org.ctx, job.data!.id);
    if (!stopped.ok) throw new Error(stopped.error);
    expect(stopped.data!.durationSeconds).toBeGreaterThan(7_000);

    // 4) faktura + częściowa wpłata
    const invoice = await createInvoice(org.ctx, {
      customerId: customer.id,
      jobId: job.data!.id,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Sprzątanie analityka', quantity: 2, unitPriceCents: 10_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    if (!invoice.ok) throw new Error(invoice.error);

    const payment = await recordPayment(org.ctx, invoice.data!.id, { amountCents: 5_000, method: 'BANK_TRANSFER' });
    if (!payment.ok) throw new Error(payment.error);
  });

  afterAll(async () => {
    await deleteTestOrganization(empty.organizationId);
    await deleteTestOrganization(org.organizationId);
    await deleteTestUser(empty.userId);
    await deleteTestUser(org.userId);
  });

  it('pusta organizacja zwraca zera (brak wymyślonych danych)', async () => {
    const analytics = await getAnalytics(empty.organizationId);

    expect(analytics.revenueInvoicedCents).toBe(0);
    expect(analytics.revenuePaidCents).toBe(0);
    expect(analytics.outstandingCents).toBe(0);
    expect(analytics.jobsCompleted).toBe(0);
    // brak ofert → konwersja jest NIEZNANA (null), a nie sztuczne 0%
    expect(analytics.conversionRate).toBeNull();
    expect(analytics.customersTotal).toBe(0);
    expect(analytics.repeatCustomers).toBe(0);
    expect(analytics.workedHours).toBe(0);
    expect(Array.isArray(analytics.revenueByMonth)).toBe(true);
    expect(analytics.topServices).toHaveLength(0);
  });

  it('organizacja z danymi: faktury, wpłaty i zaległości liczą się z bazy', async () => {
    const analytics = await getAnalytics(org.organizationId);

    expect(analytics.revenueInvoicedCents).toBeGreaterThan(0);
    expect(analytics.revenuePaidCents).toBe(5_000);
    expect(analytics.outstandingCents).toBe(analytics.revenueInvoicedCents - 5_000);
    expect(analytics.overdueCents).toBe(0);
  });

  it('zakończone zlecenia i średnia wartość są liczone poprawnie', async () => {
    const analytics = await getAnalytics(org.organizationId);
    expect(analytics.jobsCompleted).toBe(1);
    expect(analytics.avgJobValueCents).toBeGreaterThan(0);
    expect(analytics.jobsTotal).toBeGreaterThanOrEqual(1);
    expect(analytics.workedHours).toBeGreaterThan(0);
  });

  it('konwersja ofert = zaakceptowane / wysłane', async () => {
    const analytics = await getAnalytics(org.organizationId);
    expect(Array.isArray(analytics.revenueByMonth)).toBe(true);
    expect(analytics.quotesSent).toBeGreaterThanOrEqual(1);
    expect(analytics.quotesAccepted).toBe(1);
    expect(analytics.conversionRate).toBeGreaterThan(0);
    expect(analytics.conversionRate).toBeLessThanOrEqual(100);
  });

  it('własne zapytania pomocnicze działają dla obu organizacji', async () => {
    const aging = await getAging(org.organizationId);
    expect(Array.isArray(aging)).toBe(true);

    const upcoming = await getUpcomingJobs(org.organizationId, 7);
    expect(Array.isArray(upcoming)).toBe(true);

    const unassigned = await getUnassignedJobs(org.organizationId);
    expect(Array.isArray(unassigned)).toBe(true);

    const emptyAging = await getAging(empty.organizationId);
    expect(emptyAging).toHaveLength(0);
  });
});
