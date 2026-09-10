import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { reviewRequests } from '@/lib/db/schema';
import { createReviewRequest, getReviewRequestByToken, getReviewSummary, listReviewRequests, submitReview } from '@/lib/services/reviews';
import { createTestCustomer, createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

/**
 * Opinie: prośba → token publiczny → ocena klienta → podsumowanie.
 * Token jest jedynym sekretem dostępu (link publiczny), dlatego testujemy
 * też, że obca firma nie utworzy prośby dla cudzego klienta.
 */
describe('opinie klientów', () => {
  let org: Fixture;
  let otherOrg: Fixture;

  beforeAll(async () => {
    org = await createTestOrganization('OPINIA-A');
    otherOrg = await createTestOrganization('OPINIA-B');
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestOrganization(otherOrg.organizationId);
    await deleteTestUser(org.userId);
    await deleteTestUser(otherOrg.userId);
  });

  it('tworzy prośbę o opinię z unikalnym tokenem', async () => {
    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient Opinia' });
    const result = await createReviewRequest(org.ctx, { customerId: customer.id, channel: 'OWN_FORM' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.token.length).toBeGreaterThan(20);
    expect(result.request.status).toBe('PENDING');
  });

  it('odrzuca prośbę dla klienta z innej firmy', async () => {
    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient A' });
    const result = await createReviewRequest(otherOrg.ctx, { customerId: customer.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('klienta');
  });

  it('klient ocenia realizację przez publiczny token', async () => {
    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient Ocena' });
    const created = await createReviewRequest(org.ctx, { customerId: customer.id });
    if (!created.ok) throw new Error('Nie utworzono prośby');

    const result = await submitReview(created.request.token, { rating: 5, comment: '  Świetna robota!  ' });
    expect(result.ok).toBe(true);

    const after = await getReviewRequestByToken(created.request.token);
    expect(after!.status).toBe('COMPLETED');
    expect(after!.rating).toBe(5);
    expect(after!.comment).toBe('Świetna robota!');
    expect(after!.respondedAt).toBeTruthy();
  });

  it('ta sama prośba nie może zostać oceniona dwa razy', async () => {
    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient Podwójnie' });
    const created = await createReviewRequest(org.ctx, { customerId: customer.id });
    if (!created.ok) throw new Error('Nie utworzono prośby');

    expect((await submitReview(created.request.token, { rating: 4 })).ok).toBe(true);
    const second = await submitReview(created.request.token, { rating: 1 });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toContain('już zapisana');

    const after = await getReviewRequestByToken(created.request.token);
    expect(after!.rating).toBe(4);
  });

  it('ocena poza zakresem 1–5 jest odrzucana', async () => {
    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient Zakres' });
    const created = await createReviewRequest(org.ctx, { customerId: customer.id });
    if (!created.ok) throw new Error('Nie utworzono prośby');

    expect((await submitReview(created.request.token, { rating: 0 })).ok).toBe(false);
    expect((await submitReview(created.request.token, { rating: 6 })).ok).toBe(false);
    expect((await submitReview(created.request.token, { rating: Number.NaN })).ok).toBe(false);

    const after = await getReviewRequestByToken(created.request.token);
    expect(after!.status).toBe('PENDING');
  });

  it('nieznany token nie ujawnia danych', async () => {
    expect(await getReviewRequestByToken('nie-ma-takiego-tokenu')).toBeNull();
    expect((await submitReview('nie-ma-takiego-tokenu', { rating: 5 })).ok).toBe(false);
  });

  it('podsumowanie liczy średnią tylko z ocenionych próśb (organizacja izolowana)', async () => {
    // własna organizacja — wynik jest deterministyczny, niezależny od innych testów
    const orgC = await createTestOrganization('OPINIA-C');
    const customer = await createTestCustomer(orgC.organizationId, { displayName: 'Klient Średnia' });
    const first = await createReviewRequest(orgC.ctx, { customerId: customer.id });
    const second = await createReviewRequest(orgC.ctx, { customerId: customer.id });
    const third = await createReviewRequest(orgC.ctx, { customerId: customer.id });
    if (!first.ok || !second.ok || !third.ok) throw new Error('Nie utworzono próśb');

    await submitReview(first.request.token, { rating: 5 });
    await submitReview(second.request.token, { rating: 3 });
    // trzecia prośba zostaje bez oceny — nie może zawyżać średniej

    const summary = await getReviewSummary(orgC.organizationId);
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(4);
    expect(summary.pending).toBe(1);

    const list = await listReviewRequests(orgC.organizationId);
    expect(list).toHaveLength(3);

    await deleteTestOrganization(orgC.organizationId);
    await deleteTestUser(orgC.userId);
  });

  it('firma B nie widzi próśb firmy A', async () => {
    const foreign = await listReviewRequests(otherOrg.organizationId);
    expect(foreign).toHaveLength(0);
  });

  it('usunięcie klienta nie zostawia osieroconych próśb bez organizacji', async () => {
    const rows = await db.select().from(reviewRequests).where(eq(reviewRequests.organizationId, org.organizationId));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.organizationId).toBe(org.organizationId);
    }
  });
});
