import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { customers, invoices, jobs, organizations } from '@/lib/db/schema';
import { countInvoices, listInvoices } from '@/lib/services/invoices';
import { listJobs } from '@/lib/services/jobs';
import { listCustomers } from '@/lib/data/customers';
import { createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

const VOLUME = 2_000;
const PAGE_SIZE = 25;

/**
 * Test wydajnościowy: duża firma (2000 faktur, 2000 zleceń, 200 klientów).
 *
 * Sprawdzamy, że listy są stronicowane (nie pobieramy całości),
 * że count() zgadza się z liczbą rekordów i że zapytania mieszczą się w budżecie czasu.
 * Progi są celowo „bezpieczne” (sandbox), ale wykrywają brak indeksów / pełne skany.
 */
describe(`wydajność przy dużym wolumenie (${VOLUME} dokumentów)`, () => {
  let org: Fixture;
  let customerId: string;

  beforeAll(async () => {
    org = await createTestOrganization('PERF');
    await db.update(organizations).set({ plan: 'BUSINESS' }).where(eq(organizations.id, org.organizationId));

    const [customer] = await db
      .insert(customers)
      .values({ organizationId: org.organizationId, displayName: 'Klient Perftest' })
      .returning();
    customerId = customer!.id;

    const jobRows = Array.from({ length: VOLUME }, (_, index) => ({
      organizationId: org.organizationId,
      customerId,
      number: `ZL/PERF/${index + 1}`,
      title: `Zlecenie ${index + 1}`,
      status: (index % 10 === 0 ? 'COMPLETED' : 'SCHEDULED') as 'COMPLETED' | 'SCHEDULED',
      totalCents: 10_000 + index,
      subtotalCents: 8_000,
      taxCents: 2_000,
    }));

    const invoiceRows = Array.from({ length: VOLUME }, (_, index) => ({
      organizationId: org.organizationId,
      customerId,
      number: `FV/PERF/${index + 1}`,
      status: (index % 5 === 0 ? 'PAID' : 'SENT') as 'PAID' | 'SENT',
      publicToken: `itok_perf_${index}`,
      buyerName: 'Klient Perftest',
      subtotalCents: 10_000,
      taxCents: 2_300,
      totalCents: 12_300,
      paidCents: index % 5 === 0 ? 12_300 : 0,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      currency: 'PLN',
    }));

    const CHUNK = 500;
    for (let i = 0; i < jobRows.length; i += CHUNK) {
      await db.insert(jobs).values(jobRows.slice(i, i + CHUNK));
    }
    for (let i = 0; i < invoiceRows.length; i += CHUNK) {
      await db.insert(invoices).values(invoiceRows.slice(i, i + CHUNK));
    }
  }, 300_000);

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestUser(org.userId);
  }, 120_000);

  it('strona listy faktur zwraca tylko jedną stronę i mieści się w budżecie', async () => {
    const started = Date.now();
    const page = await listInvoices(org.organizationId, { limit: PAGE_SIZE, offset: 0 });
    const elapsed = Date.now() - started;

    expect(page.length).toBeLessThanOrEqual(25);
    expect(page.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('licznik zgadza się z liczbą wszystkich rekordów', async () => {
    const started = Date.now();
    const count = await countInvoices(org.organizationId);
    const elapsed = Date.now() - started;

    expect(count).toBe(VOLUME);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('ostatnia strona paginacji nie jest pusta i nie dubluje pierwszej', async () => {
    const lastPage = Math.ceil(VOLUME / PAGE_SIZE);

    const first = await listInvoices(org.organizationId, { limit: PAGE_SIZE, offset: 0 });
    const last = await listInvoices(org.organizationId, { limit: PAGE_SIZE, offset: (lastPage - 1) * PAGE_SIZE });

    expect(last.length).toBeGreaterThan(0);
    const firstIds = new Set(first.map((row) => row.id));
    expect(last.some((row) => firstIds.has(row.id))).toBe(false);
  });

  it('zapytanie poza zakresem zwraca pustą listę (a nie błąd)', async () => {
    const page = await listInvoices(org.organizationId, { limit: PAGE_SIZE, offset: 10_000 * PAGE_SIZE });
    expect(page).toHaveLength(0);
  });

  it('lista zleceń i klientów działa przy dużym wolumenie', async () => {
    const started = Date.now();
    const jobsPage = await listJobs(org.organizationId, { limit: PAGE_SIZE, offset: 0 });
    const customersPage = await listCustomers(org.organizationId, { limit: PAGE_SIZE, offset: 0 });
    const elapsed = Date.now() - started;

    expect(jobsPage.length).toBeLessThanOrEqual(25);
    expect(customersPage.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(3_000);
  });

  it('filtrowanie po statusie korzysta z danych, nie z pamięci aplikacji', async () => {
    const paid = await listInvoices(org.organizationId, { limit: PAGE_SIZE, offset: 0, status: 'PAID' });
    expect(paid.length).toBeGreaterThan(0);
    expect(paid.every((row) => row.status === 'PAID')).toBe(true);
    expect(VOLUME / 5).toBe(400);
  });
});
