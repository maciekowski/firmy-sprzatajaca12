import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { estimates, quotes } from '@/lib/db/schema';
import {
  createEstimate,
  createQuoteFromEstimate,
  getEstimate,
  getEstimateItems,
  getQuote,
  getQuoteItems,
  previewPricing,
  updateEstimate,
  type DocumentDraft,
} from '@/lib/services/estimates';
import { createTestCustomer, createTestOrganization, createTestService, deleteTestOrganization, deleteTestUser } from '../helpers';
import { computeDocumentPricing } from '@/lib/pricing/engine';

describe('wyceny i oferty (integracja z bazą)', () => {
  let orgId = '';
  let userId = '';
  let customerId = '';
  let serviceId = '';
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const org = await createTestOrganization('Wyceny', { taxRateBps: 2300 });
    orgId = org.organizationId;
    userId = org.userId;
    createdUserIds.push(userId);

    const customer = await createTestCustomer(orgId, { displayName: 'Anna Testowa' });
    customerId = customer.id;

    const service = await createTestService(
      orgId,
      { name: 'Mycie kostki', pricingMode: 'TIERED', unit: 'SQM', basePriceCents: 500 },
      [
        { minQuantity: '0', maxQuantity: '50', unitPriceCents: 500 },
        { minQuantity: '51', maxQuantity: '150', unitPriceCents: 400 },
        { minQuantity: '151', maxQuantity: null, unitPriceCents: 350 },
      ],
    );
    serviceId = service.id;
  });

  afterAll(async () => {
    await deleteTestOrganization(orgId);
    for (const id of createdUserIds) await deleteTestUser(id);
  });

  const draft = (overrides: Partial<DocumentDraft> = {}): DocumentDraft => ({
    customerId,
    lines: [
      {
        serviceId,
        name: 'Mycie kostki',
        quantity: 100,
        unitPriceCents: 400,
        unit: 'SQM',
        taxRateBps: 2300,
      },
    ],
    ...overrides,
  });

  it('podgląd wyceny liczy to samo co silnik cenowy', async () => {
    const preview = await previewPricing(orgId, draft());
    expect(preview.subtotalCents).toBe(40000); // 100 m² × 4 zł
    expect(preview.taxCents).toBe(9200);
    expect(preview.totalCents).toBe(49200);
  });

  it('tworzy wycenę i zapisuje pozycje oraz sumy', async () => {
    const estimate = await createEstimate({ organizationId: orgId, userId, userName: 'Test' }, draft());

    expect(estimate.number).toMatch(/^WY\/\d{4}\/\d{2}\/\d{4}$/);
    expect(estimate.subtotalCents).toBe(40000);
    expect(estimate.taxCents).toBe(9200);
    expect(estimate.totalCents).toBe(49200);

    const items = await getEstimateItems(estimate.id);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe('100.000');
    expect(items[0].netCents).toBe(40000);

    const stored = await getEstimate(orgId, estimate.id);
    expect(stored?.totalCents).toBe(49200);
  });

  it('stosuje progi cenowe dla dużej powierzchni', async () => {
    const estimate = await createEstimate(
      { organizationId: orgId, userId, userName: 'Test' },
      draft({
        lines: [{ serviceId, name: 'Mycie kostki', quantity: 200, unitPriceCents: 350, unit: 'SQM', taxRateBps: 2300 }],
      }),
    );
    expect(estimate.subtotalCents).toBe(70000); // 200 × 3,50 zł
    expect(estimate.totalCents).toBe(70000 + 16100);
  });

  it('aktualizuje wycenę i przelicza sumy', async () => {
    const estimate = await createEstimate({ organizationId: orgId, userId, userName: 'Test' }, draft());
    const updated = await updateEstimate({ organizationId: orgId, userId, userName: 'Test' }, estimate.id, draft({ discountBps: 1000 }));

    expect(updated?.discountCents).toBe(4000); // 10% z 400 zł
    expect(updated?.taxCents).toBe(8280); // 23% z 360 zł
    expect(updated?.totalCents).toBe(44280);

    const items = await getEstimateItems(estimate.id);
    expect(items).toHaveLength(1);
  });

  it('nie pozwala zaktualizować wyceny z innej firmy', async () => {
    const other = await createTestOrganization('Inna');
    createdUserIds.push(other.userId);
    const estimate = await createEstimate({ organizationId: orgId, userId, userName: 'Test' }, draft());

    const result = await updateEstimate(
      { organizationId: other.organizationId, userId: other.userId, userName: 'Inny' },
      estimate.id,
      draft(),
    );
    expect(result).toBeNull();

    await deleteTestOrganization(other.organizationId);
  });

  it('tworzy ofertę z wyceny i kopiuje pozycje', async () => {
    const estimate = await createEstimate({ organizationId: orgId, userId, userName: 'Test' }, draft());
    const quote = await createQuoteFromEstimate({ organizationId: orgId, userId, userName: 'Test' }, estimate.id, { validDays: 14 });

    expect(quote).not.toBeNull();
    expect(quote!.version).toBe(1);
    expect(quote!.status).toBe('DRAFT');
    expect(quote!.publicToken).toBeTruthy();
    expect(quote!.totalCents).toBe(estimate.totalCents);

    const items = await getQuoteItems(quote!.id);
    expect(items).toHaveLength(1);
    expect(items[0].netCents).toBe(40000);

    // druga wersja tej samej oferty
    const second = await createQuoteFromEstimate({ organizationId: orgId, userId, userName: 'Test' }, estimate.id);
    expect(second!.version).toBe(2);
    expect(second!.number).not.toBe(quote!.number);
  });

  it('nie utworzy oferty do wyceny z innej firmy', async () => {
    const other = await createTestOrganization('Inna2');
    createdUserIds.push(other.userId);
    const estimate = await createEstimate({ organizationId: orgId, userId, userName: 'Test' }, draft());

    const quote = await createQuoteFromEstimate(
      { organizationId: other.organizationId, userId: other.userId, userName: 'Inny' },
      estimate.id,
    );
    expect(quote).toBeNull();

    await deleteTestOrganization(other.organizationId);
  });

  it('sumy w bazie zgadzają się z silnikiem cenowym (spójność finansowa)', async () => {
    const estimate = await createEstimate(
      { organizationId: orgId, userId, userName: 'Test' },
      draft({
        discountBps: 750,
        isUrgent: true,
        lines: [
          { serviceId, name: 'Mycie kostki', quantity: 120, unitPriceCents: 400, unit: 'SQM', taxRateBps: 2300 },
          { name: 'Usługa własna', quantity: 2, unitPriceCents: 12500, unit: 'VISIT', taxRateBps: 2300, isCustom: true },
        ],
      }),
    );

    // oczekiwany wynik liczymy tym samym silnikiem — z tymi samymi danymi,
    // które serwis pobiera z bazy (usługa ma progi: 0-50 -> 5 zł, 51-150 -> 4 zł, 151+ -> 3,50 zł)
    const expected = computeDocumentPricing({
      lines: [
        {
          serviceId,
          name: 'Mycie kostki',
          quantity: 120,
          unitPriceCents: 400,
          basePriceCents: 500,
          unit: 'SQM',
          taxRateBps: 2300,
          pricingMode: 'TIERED',
          tiers: [
            { minQuantity: '0', maxQuantity: '50', unitPriceCents: 500 },
            { minQuantity: '51', maxQuantity: '150', unitPriceCents: 400 },
            { minQuantity: '151', maxQuantity: null, unitPriceCents: 350 },
          ],
        },
        { name: 'Usługa własna', quantity: 2, unitPriceCents: 12500, unit: 'VISIT', taxRateBps: 2300, pricingMode: 'PER_UNIT' },
      ],
      discountBps: 750,
      defaultTaxRateBps: 2300,
      isUrgent: true,
      urgencySurchargeBps: 0,
    });

    expect(estimate.subtotalCents).toBe(expected.subtotalCents);
    expect(estimate.discountCents).toBe(expected.discountCents);
    expect(estimate.totalCents).toBe(expected.totalCents);

    const items = await getEstimateItems(estimate.id);
    const sumNet = items.reduce((sum, item) => sum + item.netCents, 0);
    expect(sumNet).toBe(estimate.subtotalCents);
  });

  it('nie zostawia osieroconych wycen po usunięciu (kaskada)', async () => {
    const estimate = await createEstimate({ organizationId: orgId, userId, userName: 'Test' }, draft());
    await db.delete(estimates).where(eq(estimates.id, estimate.id));
    const rows = await db.select().from(quotes).where(eq(quotes.estimateId, estimate.id));
    const items = await getEstimateItems(estimate.id);
    expect(items).toHaveLength(0);
    expect(rows.every((row) => row.estimateId === null)).toBe(true);
  });
});
