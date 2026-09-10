import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { customers, invoices, jobs, quotes } from '@/lib/db/schema';
import { ensureCustomerPortalToken, getCustomerPortalData, revokeCustomerPortalToken } from '@/lib/services/portal';
import { createInvoice, sendInvoiceEmail } from '@/lib/services/invoices';
import { createEstimate, createQuoteFromEstimate, type DocumentDraft } from '@/lib/services/estimates';
import { createJobFromQuote } from '@/lib/services/jobs';
import { acceptQuoteByToken } from '@/lib/services/quotes';
import { createTestCustomer, createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

/**
 * Konto klienta (portal publiczny):
 *  - dostęp wyłącznie tokenem,
 *  - dokumenty robocze (DRAFT) NIE są widoczne,
 *  - dane innej firmy NIE przenikają do portalu.
 */
describe('konto klienta (portal publiczny)', () => {
  let org: Fixture;
  let otherOrg: Fixture;
  let customerId: string;
  let otherCustomerId: string;

  beforeAll(async () => {
    org = await createTestOrganization('PORTAL-A');
    otherOrg = await createTestOrganization('PORTAL-B');
    customerId = (await createTestCustomer(org.organizationId, { displayName: 'Klient portalu', email: 'portal@example.com' })).id;
    otherCustomerId = (await createTestCustomer(otherOrg.organizationId, { displayName: 'Klient obcy' })).id;
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestOrganization(otherOrg.organizationId);
    await deleteTestUser(org.userId);
    await deleteTestUser(otherOrg.userId);
  });

  it('link jest generowany, a po odwołaniu przestaje działać', async () => {
    expect(await getCustomerPortalData('ptok_nie-ma-takiego-tokenu')).toBeNull();

    const created = await ensureCustomerPortalToken(org.ctx, customerId);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // ten sam token przy kolejnym wywołaniu (link klienta się nie zmienia)
    const again = await ensureCustomerPortalToken(org.ctx, customerId);
    expect(again.ok && again.data.token).toBe(created.data.token);

    const data = await getCustomerPortalData(created.data.token);
    expect(data).not.toBeNull();
    expect(data!.customer.displayName).toBe('Klient portalu');
    expect(data!.organizationName).toContain('PORTAL-A');

    const revoked = await revokeCustomerPortalToken(org.ctx, customerId);
    expect(revoked.ok).toBe(true);
    expect(await getCustomerPortalData(created.data.token)).toBeNull();
  });

  it('nie można wygenerować linku do klienta innej firmy', async () => {
    const result = await ensureCustomerPortalToken(org.ctx, otherCustomerId);
    expect(result.ok).toBe(false);
  });

  it('robocze dokumenty nie są widoczne w portalu, wysłane — tak', async () => {
    const tokenResult = await ensureCustomerPortalToken(org.ctx, customerId);
    if (!tokenResult.ok) throw new Error('brak tokenu');
    const token = tokenResult.data.token;

    const draft: DocumentDraft = {
      customerId,
      lines: [{ name: 'Sprzątanie', quantity: 1, unitPriceCents: 20_000, unit: 'VISIT', taxRateBps: 2300 }],
    };
    const estimate = await createEstimate(org.ctx, draft);
    const quote = await createQuoteFromEstimate(org.ctx, estimate.id, { validDays: 14 });
    if (!quote) throw new Error('nie utworzono oferty');

    // oferta robocza — niewidoczna
    let data = await getCustomerPortalData(token);
    expect(data!.quotes.some((row) => row.id === quote.id)).toBe(false);

    // po wysłaniu — widoczna
    await db.update(quotes).set({ status: 'SENT' }).where(eq(quotes.id, quote.id));
    data = await getCustomerPortalData(token);
    const visibleQuote = data!.quotes.find((row) => row.id === quote.id);
    expect(visibleQuote).toBeTruthy();
    expect(visibleQuote!.publicToken).toBeTruthy();

    // faktura robocza — niewidoczna; po wysłaniu — widoczna
    const invoice = await createInvoice(org.ctx, {
      customerId,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Sprzątanie', quantity: 1, unitPriceCents: 20_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    if (!invoice.ok) throw new Error(invoice.error);

    data = await getCustomerPortalData(token);
    expect(data!.invoices.some((row) => row.id === invoice.data!.id)).toBe(false);

    await sendInvoiceEmail(org.ctx, invoice.data!.id);
    data = await getCustomerPortalData(token);
    expect(data!.invoices.some((row) => row.id === invoice.data!.id)).toBe(true);

    // zlecenie powstałe z zaakceptowanej oferty jest widoczne
    await acceptQuoteByToken(quote.publicToken, { actorName: 'Klient portalu' });
    const job = await createJobFromQuote(org.ctx, quote.id);
    expect(job.ok).toBe(true);
    if (!job.ok) return;
    await db
      .update(jobs)
      .set({ status: 'SCHEDULED', scheduledStart: new Date(Date.now() + 86_400_000) })
      .where(eq(jobs.id, job.data!.id));

    data = await getCustomerPortalData(token);
    expect(data!.jobs.some((row) => row.id === job.data!.id)).toBe(true);
  });

  it('portal pokazuje wyłącznie dane jednej firmy', async () => {
    const tokenResult = await ensureCustomerPortalToken(org.ctx, customerId);
    if (!tokenResult.ok) throw new Error('brak tokenu');

    const data = await getCustomerPortalData(tokenResult.data.token);
    const invoiceIds = data!.invoices.map((row) => row.id);

    const foreignInvoice = await db.select().from(invoices).where(eq(invoices.organizationId, otherOrg.organizationId));
    for (const foreign of foreignInvoice) {
      expect(invoiceIds).not.toContain(foreign.id);
    }

    const jobRows = await db.select().from(jobs).where(eq(jobs.organizationId, otherOrg.organizationId));
    const jobIds = data!.jobs.map((row) => row.id);
    for (const foreign of jobRows) {
      expect(jobIds).not.toContain(foreign.id);
    }
  });

  it('odwołanie linku nie usuwa klienta', async () => {
    await revokeCustomerPortalToken(org.ctx, customerId);
    const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    expect(customer).toBeTruthy();
    expect(customer!.portalToken).toBeNull();
  });
});
