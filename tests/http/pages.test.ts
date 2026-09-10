/**
 * Testy HTTP: prawdziwe żądania do uruchomionego serwera Next.js (bez przeglądarki).
 * Sprawdzają statusy, izolację danych i to, że strony faktycznie się renderują.
 *
 * Wymagania: uruchomiona baza PostgreSQL oraz dev serwer na porcie 3000 (BASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db/client';
import { sessions } from '@/lib/db/schema';
import { hashToken } from '@/lib/auth/tokens';
import { createTestCustomer, createTestOrganization, createTestService, deleteTestOrganization, deleteTestUser } from '../helpers';
import { createEstimate, createQuoteFromEstimate, listEstimates, listQuotes } from '@/lib/services/estimates';
import { completeJob, createJobFromQuote, scheduleJob } from '@/lib/services/jobs';
import { createInvoiceFromJob, recordPayment } from '@/lib/services/invoices';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

type OrgFixture = Awaited<ReturnType<typeof createTestOrganization>>;

async function cookieFor(fixture: OrgFixture): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId: fixture.userId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    userAgent: 'vitest-http',
  });
  return `sf_session=${token}; sf_org=${fixture.organizationId}`;
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });
  const body = response.status === 200 ? await response.text() : await response.text().catch(() => '');
  return { status: response.status, body, location: response.headers.get('location') };
}

describe('strony aplikacji (HTTP)', () => {
  let orgA: OrgFixture;
  let orgB: OrgFixture;
  let cookieA: string;
  let cookieB: string;
  let estimateId: string;
  let qualifiedEstimateId: string;

  beforeAll(async () => {
    orgA = await createTestOrganization('HTTP-A');
    orgB = await createTestOrganization('HTTP-B');
    cookieA = await cookieFor(orgA);
    cookieB = await cookieFor(orgB);

    const customer = await createTestCustomer(orgA.organizationId, { displayName: 'Klient HTTP' });
    const service = await createTestService(orgA.organizationId, { name: 'Sprzątanie HTTP', unit: 'SQM', pricingMode: 'PER_UNIT', basePriceCents: 1200 });

    const draft = {
      customerId: customer.id,
      title: 'Wycena HTTP',
      lines: [
        {
          serviceId: service.id,
          name: 'Sprzątanie HTTP',
          quantity: 10,
          unit: 'SQM' as const,
          customUnitLabel: null,
          description: null,
          unitPriceCents: 1200,
          taxRateBps: 2300,
          durationMinutes: 60,
        },
      ],
      discountType: 'NONE' as const,
      discountValue: null,
      travelFeeType: 'NONE' as const,
      travelDistanceKm: null,
      isUrgent: false,
      notes: null,
      terms: null,
    };

    const created = await createEstimate(orgA.ctx, draft);
    estimateId = created.id;

    const quoted = await createQuoteFromEstimate(orgA.ctx, estimateId, { validDays: 14 });
    if (!quoted) throw new Error('Nie utworzono oferty');
    qualifiedEstimateId = estimateId;
  });

  afterAll(async () => {
    await deleteTestOrganization(orgA.organizationId);
    await deleteTestOrganization(orgB.organizationId);
    await deleteTestUser(orgA.userId);
    await deleteTestUser(orgB.userId);
  });

  it('niezalogowany użytkownik jest przekierowany z /dashboard', async () => {
    const response = await get('/dashboard');
    expect([303, 307, 302]).toContain(response.status);
  });

  it('marketingowe strony działają publicznie', async () => {
    expect((await get('/')).status).toBe(200);
    expect((await get('/logowanie')).status).toBe(200);
    expect((await get('/rejestracja')).status).toBe(200);
  });

  it('strony aplikacji renderują się dla zalogowanego użytkownika', async () => {
    // Tylko strony, które faktycznie istnieją — brakujące są zgłaszane jako błąd testu.
    const paths = [
      '/dashboard',
      '/klienci',
      '/wyceny',
      '/wyceny/nowa',
      '/oferty',
      '/zlecenia',
      '/zlecenia/nowy',
      '/kalendarz',
      '/ekipy',
      '/faktury',
      '/faktury/nowa',
      '/powiadomienia',
      '/ustawienia',
      '/ustawienia/uslugi',
      '/ustawienia/integracje',
      '/ustawienia/konto',
      '/leady',
      '/leady/nowy',
      '/zapytania',
      '/zapytania/nowy',
      '/automatyzacje',
      '/analityka',
      '/komunikacja',
      '/opinie',
      '/asystent',
    ];
    for (const path of paths) {
      const response = await get(path, cookieA);
      // 200 = ok, 404 = strona jeszcze nie istnieje (oznaczamy jako brak)
      if (response.status !== 200) {
        throw new Error(`${path} → ${response.status}`);
      }
    }
  });

  it('szczegóły wyceny działają, a inna organizacja dostaje 404', async () => {
    const own = await get(`/wyceny/${estimateId}`, cookieA);
    expect(own.status).toBe(200);
    expect(own.body).toContain('Wycena');

    const foreign = await get(`/wyceny/${estimateId}`, cookieB);
    expect(foreign.status).toBe(404);
  });

  it('PDF oferty jest generowany naprawdę (nagłówek %PDF)', async () => {
    const quotes = await listQuotes(orgA.organizationId);
    const quote = quotes.find((item) => item.estimateId === qualifiedEstimateId);
    expect(quote).toBeTruthy();

    const response = await fetch(`${BASE_URL}/api/oferty/${quote!.id}/pdf`, { headers: { cookie: cookieA } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(1000);

    const foreign = await fetch(`${BASE_URL}/api/oferty/${quote!.id}/pdf`, { headers: { cookie: cookieB } });
    expect(foreign.status).toBe(404);
  });

  it('portal klienta działa bez logowania i odrzuca błędny token', async () => {
    const quotes = await listQuotes(orgA.organizationId);
    const quote = quotes.find((item) => item.estimateId === qualifiedEstimateId)!;

    const page = await get(`/p/${quote.publicToken}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain(quote.number);

    const missing = await get('/p/nie-ma-takiego-tokenu');
    expect(missing.status).toBe(404);
  });

  it('klient może zaakceptować ofertę w portalu', async () => {
    const quotes = await listQuotes(orgA.organizationId);
    const quote = quotes.find((item) => item.estimateId === qualifiedEstimateId)!;

    const response = await fetch(`${BASE_URL}/api/portal/${quote.publicToken}/decyzja`, {
      method: 'POST',
      body: new URLSearchParams({ decyzja: 'akceptuj', imie: 'Jan Kowalski', notatka: 'Pasuje termin' }),
      redirect: 'manual',
    });
    expect([303, 302, 307]).toContain(response.status);
    expect(response.headers.get('location') ?? '').toContain('zaakceptowana');

    const after = (await listQuotes(orgA.organizationId)).find((item) => item.id === quote.id);
    expect(after?.status).toBe('ACCEPTED');
  });

  it('podwójna akceptacja tej samej oferty jest odrzucana', async () => {
    const quotes = await listQuotes(orgA.organizationId);
    const quote = quotes.find((item) => item.estimateId === qualifiedEstimateId)!;

    const response = await fetch(`${BASE_URL}/api/portal/${quote.publicToken}/decyzja`, {
      method: 'POST',
      body: new URLSearchParams({ decyzja: 'akceptuj' }),
      redirect: 'manual',
    });
    expect(response.headers.get('location') ?? '').toContain('blad');
  });

  it('zlecenie powstaje z zaakceptowanej oferty i jest widoczne tylko dla swojej firmy', async () => {
    const quotes = await listQuotes(orgA.organizationId);
    const quote = quotes.find((item) => item.estimateId === qualifiedEstimateId)!;

    const created = await createJobFromQuote(orgA.ctx, quote.id);
    expect(created.ok).toBe(true);
    const jobId = created.data!.id;

    await scheduleJob(orgA.ctx, jobId, {
      scheduledStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
      scheduledEnd: new Date(Date.now() + 26 * 60 * 60 * 1000),
      crewId: null,
    });

    const own = await get(`/zlecenia/${jobId}`, cookieA);
    expect(own.status).toBe(200);
    expect(own.body).toContain(jobId);

    const execution = await get(`/zlecenia/${jobId}/wykonanie`, cookieA);
    expect(execution.status).toBe(200);

    const foreign = await get(`/zlecenia/${jobId}`, cookieB);
    expect(foreign.status).toBe(404);

    const completed = await completeJob(orgA.ctx, jobId, { note: 'Zrobione testowo' });
    if (!completed.ok) throw new Error(completed.error);
    expect(completed.data!.status).toBe('COMPLETED');

    const invoice = await createInvoiceFromJob(orgA.ctx, jobId);
    expect(invoice.ok).toBe(true);

    const invoicePage = await get(`/faktury/${invoice.data!.id}`, cookieA);
    expect(invoicePage.status).toBe(200);

    const pdf = await fetch(`${BASE_URL}/api/faktury/${invoice.data!.id}/pdf`, { headers: { cookie: cookieA } });
    expect(pdf.status).toBe(200);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');

    const portal = await get(`/f/${invoice.data!.publicToken}`);
    expect(portal.status).toBe(200);
    expect(portal.body).toContain(invoice.data!.number);

    const paid = await recordPayment(orgA.ctx, invoice.data!.id, { amountCents: invoice.data!.totalCents, method: 'BANK_TRANSFER' });
    expect(paid.ok).toBe(true);
    expect(paid.data!.status).toBe('PAID');
  });

  it('lista ofert pokazuje zaakceptowaną ofertę', async () => {
    const quotes = await listQuotes(orgA.organizationId);
    expect(quotes.some((quote) => quote.status === 'ACCEPTED')).toBe(true);
  });
});
