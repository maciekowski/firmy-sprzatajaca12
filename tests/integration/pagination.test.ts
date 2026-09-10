import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countCustomers, listCustomers } from '@/lib/data/customers';
import { countInvoices, createInvoice, listInvoices } from '@/lib/services/invoices';
import { countJobs, createJob, listJobs } from '@/lib/services/jobs';
import { countEstimates, listEstimates } from '@/lib/services/estimates';
import { countLeads, createLead, listLeads } from '@/lib/services/leads';
import { countRequests, createRequest, listRequests } from '@/lib/services/requests';
import { createTestCustomer, createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

/**
 * Paginacja: serwer MUSI ograniczać liczbę wierszy (limit/offset),
 * a liczniki muszą zgadzać się z filtrami (inaczej strony się nie zgadzają).
 */
describe('paginacja list', () => {
  let org: Fixture;
  const TOTAL = 30;

  beforeAll(async () => {
    org = await createTestOrganization('PAGE');
    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient Paginacja' });

    for (let index = 0; index < TOTAL - 1; index += 1) {
      await createTestCustomer(org.organizationId, { displayName: `Klient ${index}` });
      await createJob(org.ctx, {
        title: `Zlecenie ${index}`,
        customerId: customer.id,
        scheduledStart: new Date(Date.now() + index * 60_000),
        scheduledEnd: new Date(Date.now() + index * 60_000 + 3600_000),
        notes: null,
        crewId: null,
        addressId: null,
        estimatedMinutes: 60,
        assignedUserIds: [],
      });
      await createLead(org.ctx, { title: `Lead ${index}`, source: 'MANUAL' });
      await createRequest(org.ctx, { description: `Zapytanie ${index}`, channel: 'MANUAL' });
    }

    await createInvoice(org.ctx, {
      customerId: customer.id,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Usługa', quantity: 1, unitPriceCents: 5_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestUser(org.userId);
  });

  it('klienci: limit i offset działają, licznik zgadza się z danymi', async () => {
    const firstPage = await listCustomers(org.organizationId, { limit: 10, offset: 0 });
    const secondPage = await listCustomers(org.organizationId, { limit: 10, offset: 10 });
    const thirdPage = await listCustomers(org.organizationId, { limit: 10, offset: 20 });

    expect(firstPage).toHaveLength(10);
    expect(secondPage).toHaveLength(10);
    expect(thirdPage).toHaveLength(10);

    const ids = new Set([...firstPage, ...secondPage, ...thirdPage].map((row) => row.id));
    expect(ids.size).toBe(30);

    expect(await countCustomers(org.organizationId)).toBe(TOTAL);
  });

  it('klienci: filtr wyszukiwania jest uwzględniony w liczniku', async () => {
    const rows = await listCustomers(org.organizationId, { search: 'Paginacja', limit: 10, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(await countCustomers(org.organizationId, { search: 'Paginacja' })).toBe(1);
  });

  it('zlecenia: paginacja nie gubi rekordów', async () => {
    const page1 = await listJobs(org.organizationId, { limit: 10, offset: 0 });
    const page2 = await listJobs(org.organizationId, { limit: 10, offset: 10 });
    expect(page1).toHaveLength(10);
    expect(page2).toHaveLength(10);
    expect(page1.map((row) => row.id)).not.toEqual(page2.map((row) => row.id));
    expect(await countJobs(org.organizationId)).toBe(TOTAL - 1);
  });

  it('zlecenia: filtr statusu zawęża wynik i licznik', async () => {
    const [first] = await listJobs(org.organizationId, { limit: 1 });
    const { eq } = await import('drizzle-orm');
    const { jobs } = await import('@/lib/db/schema');
    const { db } = await import('@/lib/db/client');
    await db.update(jobs).set({ status: 'COMPLETED' }).where(eq(jobs.id, first!.id));

    const completed = await listJobs(org.organizationId, { status: 'COMPLETED', limit: 50 });
    expect(completed).toHaveLength(1);
    expect(await countJobs(org.organizationId, { status: 'COMPLETED' })).toBe(1);
  });

  it('faktury: paginacja i licznik', async () => {
    const rows = await listInvoices(org.organizationId, { limit: 10, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(await countInvoices(org.organizationId)).toBe(1);
    expect(await countInvoices(org.organizationId, { status: 'PAID' })).toBe(0);
  });

  it('leady i zapytania: paginacja', async () => {
    const leadsPage = await listLeads(org.organizationId, { limit: 10, offset: 0 });
    expect(leadsPage).toHaveLength(10);
    expect(await countLeads(org.organizationId)).toBe(TOTAL - 1);

    const requestsPage = await listRequests(org.organizationId, { limit: 10, offset: 10 });
    expect(requestsPage).toHaveLength(10);
    expect(await countRequests(org.organizationId)).toBe(TOTAL - 1);
  });

  it('wyceny: paginacja przez limit/offset', async () => {
    const page = await listEstimates(org.organizationId, 10, 0);
    expect(Array.isArray(page)).toBe(true);
    expect(await countEstimates(org.organizationId)).toBe(0);
  });

  it('zapytanie o nieistniejącą stronę zwraca pusty wynik (bez błędu)', async () => {
    const far = await listCustomers(org.organizationId, { limit: 10, offset: 500 });
    expect(far).toHaveLength(0);
  });
});
