import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { customers, invoiceItems, invoices, organizations, sessions } from '@/lib/db/schema';
import { hashToken } from '@/lib/auth/tokens';
import { generateJpkFa } from '@/lib/exports/jpk';
import { createInvoice, sendInvoiceEmail } from '@/lib/services/invoices';
import { createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

/**
 * Eksport JPK_FA — plik dla urzędu skarbowego.
 * Testujemy: poprawność struktury, wyliczone sumy, wykluczenie faktur roboczych
 * oraz to, że eksport zawiera wyłącznie dane jednej firmy.
 */
describe('eksport JPK_FA', () => {
  let org: Fixture;
  let otherOrg: Fixture;
  let cookie: string;
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-12-31T23:59:59.999Z');

  beforeAll(async () => {
    org = await createTestOrganization('JPK-A');
    otherOrg = await createTestOrganization('JPK-B');

    await db
      .update(organizations)
      .set({ taxId: '1234567890', street: 'ul. Testowa 10', city: 'Kraków', postalCode: '30-001' })
      .where(eq(organizations.id, org.organizationId));

    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: org.organizationId,
        displayName: 'Klient JPK',
        email: 'jpk@example.com',
        street: 'ul. Klienta 5',
        city: 'Warszawa',
        postalCode: '00-001',
        taxId: '9876543210',
      })
      .returning();

    // faktura wysłana (wchodzi do JPK)
    const invoice = await createInvoice(org.ctx, {
      customerId: customer!.id,
      dueDate: new Date('2026-06-30T00:00:00.000Z'),
      lines: [
        { name: 'Sprzątanie biura', quantity: 2, unitPriceCents: 25_000, unit: 'VISIT', taxRateBps: 2300 },
        { name: 'Mycie okien', quantity: 1, unitPriceCents: 15_000, unit: 'VISIT', taxRateBps: 800 },
      ],
    });
    if (!invoice.ok) throw new Error(invoice.error);
    await sendInvoiceEmail(org.ctx, invoice.data!.id);
    await db.update(invoices).set({ issueDate: new Date('2026-06-01T00:00:00.000Z') }).where(eq(invoices.id, invoice.data!.id));

    // faktura robocza (NIE wchodzi do JPK)
    await createInvoice(org.ctx, {
      customerId: customer!.id,
      dueDate: new Date('2026-07-31T00:00:00.000Z'),
      lines: [{ name: 'Robocza', quantity: 1, unitPriceCents: 1_000, unit: 'VISIT', taxRateBps: 2300 }],
    });

    // faktura innej firmy (nie może się pojawić w eksporcie org A)
    const [otherCustomer] = await db
      .insert(customers)
      .values({ organizationId: otherOrg.organizationId, displayName: 'Klient obcy' })
      .returning();
    const foreign = await createInvoice(otherOrg.ctx, {
      customerId: otherCustomer!.id,
      dueDate: new Date('2026-06-30T00:00:00.000Z'),
      lines: [{ name: 'Obca usługa', quantity: 1, unitPriceCents: 99_900, unit: 'VISIT', taxRateBps: 2300 }],
    });
    if (!foreign.ok) throw new Error(foreign.error);
    await sendInvoiceEmail(otherOrg.ctx, foreign.data!.id);

    const token = randomBytes(32).toString('base64url');
    await db.insert(sessions).values({
      tokenHash: hashToken(token),
      userId: org.userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      userAgent: 'vitest-jpk',
    });
    cookie = `sf_session=${token}; sf_org=${org.organizationId}`;
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestOrganization(otherOrg.organizationId);
    await deleteTestUser(org.userId);
    await deleteTestUser(otherOrg.userId);
  });

  it('generuje XML z nagłówkiem, podmiotem i fakturą', async () => {
    const result = await generateJpkFa(org.organizationId, from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(result.xml).toContain('JPK_FA');
    expect(result.xml).toContain('<NIP>1234567890</NIP>');
    expect(result.xml).toContain('<Miejscowosc>Kraków</Miejscowosc>');
    expect(result.xml).toContain('<DataOd>2026-01-01</DataOd>');
    expect(result.xml).toContain('Sprzątanie biura');
    expect(result.invoiceCount).toBe(1);
    expect(result.fileName).toContain('JPK_FA_1234567890');
  });

  it('kwoty w pliku są zgodne z bazą (grosze → złote)', async () => {
    const result = await generateJpkFa(org.organizationId, from, to);
    if (!result.ok) throw new Error(result.error);

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(exportedInvoicesFilter(org.organizationId))
      .limit(1);

    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice!.id));
    const net = items.reduce((sum, item) => sum + Number(item.netCents ?? 0), 0);
    const tax = items.reduce((sum, item) => sum + Number(item.taxCents ?? 0), 0);

    expect(result.xml).toContain(`<P_13_1>${(Math.round(net) / 100).toFixed(2)}</P_13_1>`);
    expect(result.xml).toContain(`<P_14_1>${(Math.round(tax) / 100).toFixed(2)}</P_14_1>`);
    expect(result.xml).toContain(`<P_15>${(Math.round(net + tax) / 100).toFixed(2)}</P_15>`);
  });

  it('faktury robocze i cudze nie trafiają do eksportu', async () => {
    const result = await generateJpkFa(org.organizationId, from, to);
    if (!result.ok) throw new Error(result.error);

    expect(result.xml).not.toContain('Robocza');
    expect(result.xml).not.toContain('Obca usługa');
    expect(result.xml).not.toContain('999.00');
  });

  it('brak NIP firmy = jasny błąd (nie generujemy wadliwego pliku)', async () => {
    await db.update(organizations).set({ taxId: null }).where(eq(organizations.id, org.organizationId));
    const result = await generateJpkFa(org.organizationId, from, to);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('NIP');

    await db.update(organizations).set({ taxId: '1234567890' }).where(eq(organizations.id, org.organizationId));
  });

  it('pusty okres = informacja, a nie pusty plik', async () => {
    const result = await generateJpkFa(org.organizationId, new Date('2020-01-01'), new Date('2020-12-31'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('nie ma faktur');
  });

  it('odwrócony zakres dat jest odrzucany', async () => {
    const result = await generateJpkFa(org.organizationId, new Date('2026-12-31'), new Date('2026-01-01'));
    expect(result.ok).toBe(false);
  });

  it('endpoint eksportu wymaga zalogowania i uprawnień', async () => {
    const anonymous = await fetch(`${BASE_URL}/api/faktury/jpk?od=2026-01-01&do=2026-12-31`, { redirect: 'manual' });
    expect([401, 403, 307]).toContain(anonymous.status);

    const authorized = await fetch(`${BASE_URL}/api/faktury/jpk?od=2026-01-01&do=2026-12-31`, { headers: { cookie } });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get('content-type')).toContain('xml');
    const body = await authorized.text();
    expect(body).toContain('<NIP>1234567890</NIP>');
  });

  it('endpoint odrzuca niepoprawny zakres', async () => {
    const response = await fetch(`${BASE_URL}/api/faktury/jpk?od=nie-wiem&do=tez-nie`, { headers: { cookie } });
    expect(response.status).toBe(400);
  });
});

function exportedInvoicesFilter(organizationId: string) {
  return and(
    eq(invoices.organizationId, organizationId),
    gte(invoices.issueDate, new Date('2026-01-01')),
    inArray(invoices.status, ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE']),
  );
}
