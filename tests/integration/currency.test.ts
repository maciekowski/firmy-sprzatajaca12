/**
 * Wielowalutowość — migawka waluty na dokumencie.
 *
 * Zasada: system NIE przelicza walut po kursie (nie wymyślamy kursów).
 * Dokument zapamiętuje walutę z chwili utworzenia, a raporty sumują
 * kwoty osobno dla każdej waluty.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { invoices, organizations, quotes } from '@/lib/db/schema';
import { formatMoney, isSupportedCurrency, normalizeCurrency } from '@/lib/money';
import { createEstimate, createQuoteFromEstimate, type DocumentDraft } from '@/lib/services/estimates';
import { acceptQuoteByToken } from '@/lib/services/quotes';
import { createInvoice } from '@/lib/services/invoices';
import { getAnalytics } from '@/lib/queries/analytics';
import { getCustomerPortalData, ensureCustomerPortalToken } from '@/lib/services/portal';
import { createTestCustomer, createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

describe('wielowalutowość', () => {
  let org: Fixture;
  let customerId: string;

  beforeAll(async () => {
    org = await createTestOrganization('WALUTA', { currency: 'EUR' });
    customerId = (await createTestCustomer(org.organizationId, { displayName: 'Klient EUR' })).id;
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestUser(org.userId);
  });

  it('formatowanie kwot uwzględnia walutę', () => {
    expect(formatMoney(12_300, 'PLN')).toContain('zł');
    expect(formatMoney(12_300, 'EUR')).toContain('€');
    expect(formatMoney(12_300, 'USD')).toContain('$');
    // nieznany kod waluty jest pokazywany wprost (bez zgadywania)
    expect(formatMoney(12_300, 'JPY')).toContain('JPY');
  });

  it('waluta jest walidowana — nieznane kody nie przechodzą', () => {
    expect(isSupportedCurrency('PLN')).toBe(true);
    expect(isSupportedCurrency('EUR')).toBe(true);
    expect(isSupportedCurrency('JPY')).toBe(false);
    expect(isSupportedCurrency('')).toBe(false);
    expect(normalizeCurrency('eur')).toBe('EUR');
    expect(normalizeCurrency('JPY')).toBe('PLN'); // bez wymyślania obsługi walut bez groszy
    expect(normalizeCurrency(null)).toBe('PLN');
  });

  it('dokumenty zapamiętują walutę z chwili utworzenia', async () => {
    const draft: DocumentDraft = {
      customerId,
      lines: [{ name: 'Usługa', quantity: 1, unitPriceCents: 20_000, unit: 'VISIT', taxRateBps: 2300 }],
    };
    const estimate = await createEstimate(org.ctx, draft);
    const quote = await createQuoteFromEstimate(org.ctx, estimate.id, { validDays: 14 });
    if (!quote) throw new Error('brak oferty');

    expect(quote.currency).toBe('EUR');

    const invoice = await createInvoice(org.ctx, {
      customerId,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Usługa', quantity: 1, unitPriceCents: 20_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    if (!invoice.ok) throw new Error(invoice.error);
    expect(invoice.data!.currency).toBe('EUR');
    expect(invoice.data!.totalCents).toBe(24_600);
  });

  it('zmiana waluty firmy nie zmienia już wystawionych dokumentów (migawka)', async () => {
    await db.update(organizations).set({ currency: 'PLN' }).where(eq(organizations.id, org.organizationId));

    const [invoice] = await db.select().from(invoices).where(eq(invoices.organizationId, org.organizationId)).limit(1);
    expect(invoice!.currency).toBe('EUR');

    // nowy dokument dostaje nową walutę
    const next = await createInvoice(org.ctx, {
      customerId,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Usługa PLN', quantity: 1, unitPriceCents: 10_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    if (!next.ok) throw new Error(next.error);
    expect(next.data!.currency).toBe('PLN');
  });

  it('analityka raportuje przychód osobno dla każdej waluty (bez kursów)', async () => {
    const analytics = await getAnalytics(org.organizationId);
    const byCurrency = analytics.revenueByCurrency;

    expect(byCurrency.length).toBeGreaterThanOrEqual(2);
    const eur = byCurrency.find((row) => row.currency === 'EUR');
    const pln = byCurrency.find((row) => row.currency === 'PLN');
    expect(eur).toBeTruthy();
    expect(pln).toBeTruthy();

    // sumy w różnych walutach nie są ze sobą mieszane
    expect(eur!.invoicedCents).toBeGreaterThan(0);
    expect(pln!.invoicedCents).toBeGreaterThan(0);
  });

  it('konto klienta pokazuje kwoty w walucie dokumentu', async () => {
    // faktura PLN musi zostać wysłana, żeby była widoczna w portalu
    const draftInvoice = await createInvoice(org.ctx, {
      customerId,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Usługa PLN', quantity: 1, unitPriceCents: 5_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    if (!draftInvoice.ok) throw new Error(draftInvoice.error);
    const { sendInvoiceEmail } = await import('@/lib/services/invoices');
    await sendInvoiceEmail(org.ctx, draftInvoice.data!.id);

    // oferta widoczna w portalu dopiero po wysłaniu
    await db.update(quotes).set({ status: 'SENT' }).where(eq(quotes.organizationId, org.organizationId));

    const portal = await ensureCustomerPortalToken(org.ctx, customerId);
    if (!portal.ok) throw new Error(portal.error);

    const data = await getCustomerPortalData(portal.data.token);
    expect(data).not.toBeNull();
    expect(data!.quotes.some((quote) => quote.currency === 'EUR')).toBe(true);
    expect(data!.invoices.some((invoice) => invoice.currency === 'PLN')).toBe(true);
  });

  it('akceptacja oferty w innej walucie nie zmienia jej kwoty', async () => {
    const [quote] = await db.select().from(quotes).where(eq(quotes.organizationId, org.organizationId)).limit(1);
    const before = quote!.totalCents;

    const accepted = await acceptQuoteByToken(quote!.publicToken, { actorName: 'Klient EUR' });
    expect(accepted.ok).toBe(true);

    const [after] = await db.select().from(quotes).where(eq(quotes.id, quote!.id)).limit(1);
    expect(after!.totalCents).toBe(before);
    expect(after!.currency).toBe('EUR');
  });
});
