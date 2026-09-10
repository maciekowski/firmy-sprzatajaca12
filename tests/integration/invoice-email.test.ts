import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { communications } from '@/lib/db/schema';
import { createInvoice, getInvoice, sendInvoiceEmail } from '@/lib/services/invoices';
import { createTestCustomer, createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

/**
 * Wysyłka faktury — testy uczciwości statusów.
 * Kluczowe: brak providera (lub brak adresu klienta) NIE może zostać
 * pokazany jako „wysłano”. Faktura może zmienić status, ale powód musi być jawny.
 */
describe('wysyłka faktury e-mailem', () => {
  let org: Fixture;
  let otherOrg: Fixture;
  let invoiceWithEmailId: string;
  let invoiceWithoutEmailId: string;

  beforeAll(async () => {
    org = await createTestOrganization('MAIL-A');
    otherOrg = await createTestOrganization('MAIL-B');

    const withEmail = await createTestCustomer(org.organizationId, {
      displayName: 'Klient z mailem',
      email: 'klient@example.com',
    });
    const withoutEmail = await createTestCustomer(org.organizationId, { displayName: 'Klient bez maila' });

    const first = await createInvoice(org.ctx, {
      customerId: withEmail.id,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Usługa', quantity: 1, unitPriceCents: 12_300, unit: 'VISIT', taxRateBps: 2300 }],
    });
    if (!first.ok) throw new Error(first.error);
    invoiceWithEmailId = first.data!.id;

    const second = await createInvoice(org.ctx, {
      customerId: withoutEmail.id,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Usługa', quantity: 1, unitPriceCents: 5_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    if (!second.ok) throw new Error(second.error);
    invoiceWithoutEmailId = second.data!.id;
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestOrganization(otherOrg.organizationId);
    await deleteTestUser(org.userId);
    await deleteTestUser(otherOrg.userId);
  });

  it('wysyłka zapisuje komunikat w bazie z prawdziwym statusem', async () => {
    const result = await sendInvoiceEmail(org.ctx, invoiceWithEmailId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await db
      .select()
      .from(communications)
      .where(and(eq(communications.organizationId, org.organizationId), eq(communications.invoiceId, invoiceWithEmailId)));

    expect(rows).toHaveLength(1);
    const message = rows[0]!;
    expect(message.toAddress).toBe('klient@example.com');
    expect(message.templateKey).toBe('invoice_ready');
    expect(message.body).toContain('f/');

    // bez providera wiadomość NIE mogła zostać oznaczona jako wysłana
    const providerMissing = message.status === 'SKIPPED_NO_PROVIDER';
    if (providerMissing) {
      expect(message.sentAt).toBeNull();
      expect(message.error).toBeTruthy();
      expect(result.data?.deliveryNote).toBeTruthy();
    } else {
      expect(['SENT', 'DELIVERED']).toContain(message.status);
    }
  });

  it('faktura zmienia status na wysłaną niezależnie od wyniku wysyłki (z jawną uwagą)', async () => {
    const invoice = await getInvoice(org.organizationId, invoiceWithEmailId);
    expect(invoice!.status).toBe('SENT');
    expect(invoice!.sentAt).toBeTruthy();
  });

  it('klient bez adresu e-mail — faktura wysłana „linkiem”, bez udawanej wysyłki', async () => {
    const result = await sendInvoiceEmail(org.ctx, invoiceWithoutEmailId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.deliveryNote).toContain('nie ma adresu e-mail');

    const messages = await db
      .select()
      .from(communications)
      .where(eq(communications.invoiceId, invoiceWithoutEmailId));
    expect(messages).toHaveLength(0);
  });

  it('SMS bez numeru telefonu — jawna informacja, brak rekordu wysyłki', async () => {
    const result = await sendInvoiceEmail(org.ctx, invoiceWithEmailId, { channel: 'SMS' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.deliveryNote).toContain('telefonu');
  });

  it('klucz idempotencji nie tworzy drugiej wiadomości', async () => {
    const key = `invoice-mail-test-${Date.now()}`;
    const first = await sendInvoiceEmail(org.ctx, invoiceWithEmailId, { idempotencyKey: key });
    const second = await sendInvoiceEmail(org.ctx, invoiceWithEmailId, { idempotencyKey: key });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data?.deliveryNote).toContain('już wysłana');

    const rows = await db.select().from(communications).where(eq(communications.idempotencyKey, key));
    expect(rows).toHaveLength(1);
  });

  it('nie można wysłać faktury innej firmy', async () => {
    const result = await sendInvoiceEmail(otherOrg.ctx, invoiceWithEmailId);
    expect(result.ok).toBe(false);
  });

  it('anulowanej faktury nie można wysłać', async () => {
    const { invoices } = await import('@/lib/db/schema');
    const created = await createInvoice(org.ctx, {
      customerId: (await createTestCustomer(org.organizationId, { displayName: 'Anulowana', email: 'a@example.com' })).id,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Usługa', quantity: 1, unitPriceCents: 1_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    if (!created.ok) throw new Error(created.error);

    await db.update(invoices).set({ status: 'CANCELLED' }).where(eq(invoices.id, created.data!.id));

    const result = await sendInvoiceEmail(org.ctx, created.data!.id);
    expect(result.ok).toBe(false);
  });
});
