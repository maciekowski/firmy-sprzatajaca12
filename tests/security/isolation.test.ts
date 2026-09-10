/**
 * Testy bezpieczeństwa i izolacji danych (najważniejszy zestaw w projekcie).
 *
 * Zasada: „brak dostępu = TEST ZALICZONY”. Sprawdzamy:
 *  - dostęp do cudzych danych przez ID/URL (IDOR) — musi kończyć się 404/403,
 *  - uprawnienia ról wymuszane po stronie serwera (a nie tylko w interfejsie),
 *  - endpointy publiczne i webhooki (podpisy, sekrety, brak konfiguracji),
 *  - ochronę przed nadużyciami (rate limiting).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db/client';
import { memberships, sessions, users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { hashToken } from '@/lib/auth/tokens';
import { createInvoice } from '@/lib/services/invoices';
import { createEstimate, createQuoteFromEstimate } from '@/lib/services/estimates';
import { createJob } from '@/lib/services/jobs';
import { createLead } from '@/lib/services/leads';
import { createRequest } from '@/lib/services/requests';
import { createReviewRequest } from '@/lib/services/reviews';
import { createTestCustomer, createTestOrganization, createTestService, deleteTestOrganization, deleteTestUser } from '../helpers';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

async function mintSession(userId: string, organizationId: string, role: 'OWNER' | 'WORKER' | 'VIEWER' | 'DISPATCHER') {
  const [user] = await db
    .insert(users)
    .values({ email: `sec-${randomBytes(8).toString('hex')}@example.com`, name: `Użytkownik ${role}`, passwordHash: await hashPassword('TestHaslo12345') })
    .returning();

  await db.insert(memberships).values({ organizationId, userId: user.id, role });

  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    userAgent: 'vitest-security',
  });

  return { userId: user.id, cookie: `sf_session=${token}; sf_org=${organizationId}` };
}

async function get(path: string, cookie?: string) {
  const response = await fetch(`${BASE_URL}${path}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  const body = await response.text().catch(() => '');
  return { status: response.status, body, location: response.headers.get('location') };
}

describe('izolacja danych i uprawnienia (bezpieczeństwo)', () => {
  let orgA: Fixture;
  let orgB: Fixture;
  let ownerA: string;
  let ownerB: string;
  let workerA: string;
  let viewerA: string;
  let workerUserId: string;
  let viewerUserId: string;

  let customerAId: string;
  let estimateAId: string;
  let quoteAId: string;
  let quoteAToken: string;
  let jobAId: string;
  let invoiceAId: string;
  let leadAId: string;
  let requestAId: string;
  let reviewToken: string;

  beforeAll(async () => {
    orgA = await createTestOrganization('SEC-A');
    orgB = await createTestOrganization('SEC-B');

    const customer = await createTestCustomer(orgA.organizationId, { displayName: 'Klient SEC' });
    customerAId = customer.id;

    const service = await createTestService(orgA.organizationId, { name: 'Usługa SEC', basePriceCents: 8_000 });

    const estimate = await createEstimate(orgA.ctx, {
      customerId: customer.id,
      lines: [
        {
          serviceId: service.id,
          name: 'Usługa SEC',
          quantity: 1,
          unit: 'VISIT',
          customUnitLabel: null,
          description: null,
          unitPriceCents: 8_000,
          taxRateBps: 2300,
        },
      ],
      travelFeeType: 'NONE',
      travelDistanceKm: null,
      isUrgent: false,
      notes: null,
      terms: null,
    });
    estimateAId = estimate.id;

    const quote = await createQuoteFromEstimate(orgA.ctx, estimate.id, { validDays: 14 });
    quoteAId = quote!.id;
    quoteAToken = quote!.publicToken;

    const job = await createJob(orgA.ctx, {
      title: 'Zlecenie SEC',
      customerId: customer.id,
      scheduledStart: new Date(Date.now() + 3600_000),
      scheduledEnd: new Date(Date.now() + 7200_000),
      notes: null,
      crewId: null,
      addressId: null,
      estimatedMinutes: 60,
      assignedUserIds: [],
    });
    if (!job.ok) throw new Error(job.error);
    jobAId = job.data!.id;

    const invoice = await createInvoice(orgA.ctx, {
      customerId: customer.id,
      jobId: jobAId,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Usługa SEC', quantity: 1, unitPriceCents: 8_000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    if (!invoice.ok) throw new Error(invoice.error);
    invoiceAId = invoice.data!.id;

    const lead = await createLead(orgA.ctx, { title: 'Lead SEC', source: 'MANUAL' });
    if (!lead.ok) throw new Error(lead.error);
    leadAId = lead.lead.id;

    const request = await createRequest(orgA.ctx, { description: 'Zapytanie SEC', channel: 'MANUAL' });
    if (!request.ok) throw new Error(request.error);
    requestAId = request.request.id;

    const review = await createReviewRequest(orgA.ctx, { customerId: customer.id, jobId: jobAId });
    if (!review.ok) throw new Error(review.error);
    reviewToken = review.request.token;

    ownerA = (await mintSession(orgA.userId, orgA.organizationId, 'OWNER')).cookie;
    ownerB = (await mintSession(orgB.userId, orgB.organizationId, 'OWNER')).cookie;
    const worker = await mintSession(orgA.userId, orgA.organizationId, 'WORKER');
    workerA = worker.cookie;
    workerUserId = worker.userId;
    const viewer = await mintSession(orgA.userId, orgA.organizationId, 'VIEWER');
    viewerA = viewer.cookie;
    viewerUserId = viewer.userId;
  });

  afterAll(async () => {
    await db.delete(sessions); // porządki po testach bezpieczeństwa
    await deleteTestOrganization(orgA.organizationId);
    await deleteTestOrganization(orgB.organizationId);
    await deleteTestUser(orgA.userId);
    await deleteTestUser(orgB.userId);
    await deleteTestUser(workerUserId);
    await deleteTestUser(viewerUserId);
  });

  describe('IDOR — cudze rekordy po identyfikatorze', () => {
    it('właściciel widzi swoje dane', async () => {
      expect((await get(`/klienci/${customerAId}`, ownerA)).status).toBe(200);
      expect((await get(`/wyceny/${estimateAId}`, ownerA)).status).toBe(200);
      expect((await get(`/zlecenia/${jobAId}`, ownerA)).status).toBe(200);
      expect((await get(`/faktury/${invoiceAId}`, ownerA)).status).toBe(200);
    });

    it('inna firma dostaje 404 na każdy cudzy rekord', async () => {
      const paths = [
        `/klienci/${customerAId}`,
        `/wyceny/${estimateAId}`,
        `/oferty/${quoteAId}`,
        `/zlecenia/${jobAId}`,
        `/faktury/${invoiceAId}`,
        `/leady/${leadAId}`,
        `/zapytania/${requestAId}`,
      ];

      for (const path of paths) {
        const response = await get(path, ownerB);
        expect(response.status, `${path} → ${response.status}`).toBe(404);
      }
    });

    it('cudza firma nie pobierze PDF-a faktury ani oferty', async () => {
      const invoicePdf = await get(`/api/faktury/${invoiceAId}/pdf`, ownerB);
      expect(invoicePdf.status).toBe(404);

      const quotePdf = await get(`/api/oferty/${quoteAId}/pdf`, ownerB);
      expect(quotePdf.status).toBe(404);
    });

    it('niezalogowany nie pobierze PDF-a ani nie wejdzie do aplikacji', async () => {
      expect((await get(`/api/faktury/${invoiceAId}/pdf`)).status).toBe(401);
      expect((await get('/dashboard')).status).toBe(307);
      expect((await get('/faktury')).status).toBe(307);
    });

    it('publiczne tokeny: nieznany token = 404 (brak wycieku danych)', async () => {
      expect((await get('/p/nie-ma-takiego-tokenu')).status).toBe(404);
      expect((await get('/f/nie-ma-takiego-tokenu')).status).toBe(404);
      expect((await get('/o/nie-ma-takiego-tokenu')).status).toBe(404);
    });

    it('prawdziwy link publiczny działa bez logowania', async () => {
      expect((await get(`/p/${quoteAToken}`)).status).toBe(200);
      expect((await get(`/o/${reviewToken}`)).status).toBe(200);
    });
  });

  describe('role — uprawnienia wymuszane przez serwer', () => {
    it('pracownik nie ma dostępu do faktur, analityki ani ustawień', async () => {
      expect((await get('/faktury', workerA)).status).toBe(403);
      expect((await get('/analityka', workerA)).status).toBe(403);
      expect((await get('/ustawienia', workerA)).status).toBe(403);
      expect((await get('/automatyzacje', workerA)).status).toBe(403);
      expect((await get('/opinie', workerA)).status).toBe(403);
      expect((await get('/komunikacja', workerA)).status).toBe(403);
    });

    it('pracownik ma dostęp do swoich zleceń i widoku wykonania', async () => {
      expect((await get('/zlecenia', workerA)).status).toBe(200);
      expect((await get('/dashboard', workerA)).status).toBe(200);
      expect((await get(`/zlecenia/${jobAId}`, workerA)).status).toBe(200);
    });

    it('widok wykonania działa tylko dla przypisanego pracownika', async () => {
      // nieprzypisany pracownik → brak dostępu (TEST ZALICZONY = 403)
      expect((await get(`/zlecenia/${jobAId}/wykonanie`, workerA)).status).toBe(403);

      // po przypisaniu do zlecenia pracownik może je realizować
      const { jobAssignments } = await import('@/lib/db/schema');
      await db.insert(jobAssignments).values({ jobId: jobAId, userId: workerUserId });

      expect((await get(`/zlecenia/${jobAId}/wykonanie`, workerA)).status).toBe(200);
    });

    it('podgląd (VIEWER) może czytać, ale nie może zarządzać', async () => {
      expect((await get('/faktury', viewerA)).status).toBe(200);
      expect((await get('/analityka', viewerA)).status).toBe(200);
      expect((await get('/ustawienia', viewerA)).status).toBe(403);
      expect((await get('/automatyzacje', viewerA)).status).toBe(403);
    });
  });

  describe('endpointy techniczne', () => {
    it('cron bez sekretu i z błędnym sekretem jest odrzucany', async () => {
      const noSecret = await fetch(`${BASE_URL}/api/cron/run`, { method: 'POST' });
      expect([401, 503]).toContain(noSecret.status);

      const wrongSecret = await fetch(`${BASE_URL}/api/cron/run`, { method: 'POST', headers: { 'x-cron-secret': 'zly-sekret' } });
      expect([401, 503]).toContain(wrongSecret.status);
    });

    it('webhook Stripe bez konfiguracji zwraca 503 (żadnego udawanego sukcesu)', async () => {
      const response = await fetch(`${BASE_URL}/api/webhooks/stripe`, {
        method: 'POST',
        headers: { 'stripe-signature': 't=1,v1=deadbeef', 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'evt_test', type: 'payment_intent.succeeded', data: { object: {} } }),
      });
      const body = (await response.json()) as { error?: string };
      expect([503, 400]).toContain(response.status);
      if (response.status === 503) expect(body.error).toContain('nie jest jeszcze skonfigurowana');
    });

    it('webhook Resend odrzuca request bez prawidłowego podpisu', async () => {
      const response = await fetch(`${BASE_URL}/api/webhooks/resend`, {
        method: 'POST',
        headers: { 'svix-id': 'msg_test', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1=nieprawidlowy', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'email.delivered', data: { email_id: 'msg_test' } }),
      });
      expect([400, 401]).toContain(response.status);
    });

    it('płatność online z nieznanym tokenem = 404', async () => {
      const response = await fetch(`${BASE_URL}/api/platnosc/nie-ma-takiego-tokenu`, { method: 'POST' });
      expect(response.status).toBe(404);
    });
  });

  describe('ograniczenie liczby żądań', () => {
    it('decyzja w portalu klienta jest limitowana (429 po przekroczeniu limitu)', async () => {
      const form = new URLSearchParams({ decyzja: 'akceptuj', imie: 'Test' });
      let throttled = false;

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetch(`${BASE_URL}/api/portal/${quoteAToken}/decyzja`, {
          method: 'POST',
          body: form,
          redirect: 'manual',
        });
        if (response.status === 429) {
          throttled = true;
          expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
          break;
        }
      }

      expect(throttled).toBe(true);
    });
  });
});
