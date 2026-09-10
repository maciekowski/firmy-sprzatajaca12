import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { invoices, payments } from '@/lib/db/schema';
import { createInvoice, getInvoice, recordPayment, recordStripePayment } from '@/lib/services/invoices';
import { createTestCustomer, createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

/**
 * Płatności — testy księgowania, idempotencji i izolacji danych.
 * Płatność online powstaje WYŁĄCZNIE po podpisanym webhooku (recordStripePayment),
 * dlatego jej reguły muszą być przetestowane bardzo dokładnie.
 */
describe('płatności i webhook Stripe', () => {
  let org: Fixture;
  let otherOrg: Fixture;
  let invoiceId: string;

  beforeAll(async () => {
    org = await createTestOrganization('PAY-A');
    otherOrg = await createTestOrganization('PAY-B');

    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient Płatności' });
    const created = await createInvoice(org.ctx, {
      customerId: customer.id,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: [
        { name: 'Sprzątanie', quantity: 2, unitPriceCents: 15_000, unit: 'VISIT', taxRateBps: 2300 },
      ],
    });
    if (!created.ok) throw new Error(created.error);
    invoiceId = created.data!.id;
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestOrganization(otherOrg.organizationId);
    await deleteTestUser(org.userId);
    await deleteTestUser(otherOrg.userId);
  });

  it('ręczna wpłata aktualizuje kwotę i status faktury', async () => {
    const before = await getInvoice(org.organizationId, invoiceId);
    const result = await recordPayment(org.ctx, invoiceId, { amountCents: 15_000, method: 'BANK_TRANSFER' });

    expect(result.ok).toBe(true);
    expect(result.data!.paidCents).toBe(15_000);
    expect(result.data!.status).toBe('PARTIALLY_PAID');
    expect(before!.paidCents).toBe(0);
  });

  it('odrzuca wpłatę większą niż pozostała należność', async () => {
    const result = await recordPayment(org.ctx, invoiceId, { amountCents: 999_999, method: 'CASH' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('przewyższa');
  });

  it('odrzuca wpłatę o nieprawidłowej kwocie', async () => {
    expect((await recordPayment(org.ctx, invoiceId, { amountCents: 0, method: 'CASH' })).ok).toBe(false);
    expect((await recordPayment(org.ctx, invoiceId, { amountCents: -500, method: 'CASH' })).ok).toBe(false);
    expect((await recordPayment(org.ctx, invoiceId, { amountCents: 12.5, method: 'CASH' })).ok).toBe(false);
  });

  it('nie pozwala księgować płatności do faktury innej firmy', async () => {
    const result = await recordStripePayment({
      organizationId: otherOrg.organizationId,
      invoiceId,
      amountCents: 1000,
      stripePaymentIntentId: 'pi_foreign_attempt',
    });
    expect(result.ok).toBe(false);
  });

  it('webhook Stripe księguje płatność i oznacza fakturę jako opłaconą', async () => {
    const before = await getInvoice(org.organizationId, invoiceId);
    const remaining = before!.totalCents - before!.paidCents;

    const result = await recordStripeFromWebhook(invoiceId, remaining, 'pi_test_success_1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(result.invoice.status).toBe('PAID');
    expect(result.invoice.paidCents).toBe(before!.totalCents);
  });

  it('ponowne dostarczenie tego samego webhooka nie księguje płatności dwa razy', async () => {
    const result = await recordStripeFromWebhook(invoiceId, 5_000, 'pi_test_success_1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(true);

    const invoice = await getInvoice(org.organizationId, invoiceId);
    const rows = await db.select().from(payments).where(eq(payments.invoiceId, invoiceId));
    const stripeRows = rows.filter((row) => row.stripePaymentIntentId === 'pi_test_success_1');

    expect(stripeRows).toHaveLength(1);
    expect(invoice!.paidCents).toBe(invoice!.totalCents);
  });

  it('nadpłata z webhooka jest przycinana do pozostałej należności (nie przepisujemy kwoty faktury)', async () => {
    const orgX = await createTestOrganization('PAY-C');
    const customer = await createTestCustomer(orgX.organizationId, { displayName: 'Klient C' });
    const created = await createInvoice(orgX.ctx, {
      customerId: customer.id,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Usługa', quantity: 1, unitPriceCents: 10_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    const id = created.data!.id;

    const result = await recordStripePayment({
      organizationId: orgX.organizationId,
      invoiceId: id,
      amountCents: 999_999,
      stripePaymentIntentId: 'pi_test_overpay',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invoice.paidCents).toBe(result.invoice.totalCents);
    expect(result.invoice.status).toBe('PAID');

    await deleteTestOrganization(orgX.organizationId);
    await deleteTestUser(orgX.userId);
  });

  it('anulowanej faktury nie można opłacić przez webhook', async () => {
    const orgX = await createTestOrganization('PAY-D');
    const customer = await createTestCustomer(orgX.organizationId, { displayName: 'Klient D' });
    const created = await createInvoice(orgX.ctx, {
      customerId: customer.id,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Usługa', quantity: 1, unitPriceCents: 5_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    const id = created.data!.id;

    await db.update(invoices).set({ status: 'CANCELLED' }).where(eq(invoices.id, id));

    const result = await recordStripePayment({
      organizationId: orgX.organizationId,
      invoiceId: id,
      amountCents: 100,
      stripePaymentIntentId: 'pi_test_cancelled',
    });

    expect(result.ok).toBe(false);

    await deleteTestOrganization(orgX.organizationId);
    await deleteTestUser(orgX.userId);
  });

  it('płatność zapisana przez webhook ma metodę STRIPE i brak autora (system)', async () => {
    const [row] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), eq(payments.stripePaymentIntentId, 'pi_test_success_1')))
      .limit(1);

    expect(row).toBeTruthy();
    expect(row!.method).toBe('STRIPE');
    expect(row!.recordedById).toBeNull();
  });

  /** Pomocnik: księgowanie płatności z webhooka dla głównej organizacji. */
  async function recordStripeFromWebhook(invoice: string, amountCents: number, paymentIntentId: string) {
    return recordStripePayment({
      organizationId: org.organizationId,
      invoiceId: invoice,
      amountCents,
      stripePaymentIntentId: paymentIntentId,
    });
  }
});
