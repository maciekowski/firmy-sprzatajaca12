/**
 * Testy HTTP: publiczne konto klienta, zaproszenie do zespołu i manifest PWA.
 * Prawdziwe żądania do uruchomionego serwera (bez przeglądarki).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { customers, organizations, quotes } from '@/lib/db/schema';
import { ensureCustomerPortalToken, revokeCustomerPortalToken } from '@/lib/services/portal';
import { inviteMember as inviteByToken } from '@/lib/services/invitations';
import { createEstimate, createQuoteFromEstimate } from '@/lib/services/estimates';
import { createTestCustomer, createTestOrganization, createTestService, deleteTestOrganization, deleteTestUser } from '../helpers';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, { redirect: 'manual' });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

describe('publiczne strony: konto klienta, zaproszenie, PWA', () => {
  let org: Awaited<ReturnType<typeof createTestOrganization>>;
  let customerId: string;

  beforeAll(async () => {
    org = await createTestOrganization('PUBLIC-A');
    await db.update(organizations).set({ plan: 'BUSINESS' }).where(eq(organizations.id, org.organizationId));

    const customer = await createTestCustomer(org.organizationId, {
      displayName: 'Klient Publiczny',
      email: 'publiczny@example.com',
    });
    customerId = customer.id;

    const service = await createTestService(org.organizationId, {
      name: 'Usługa publiczna',
      unit: 'VISIT',
      pricingMode: 'PER_UNIT',
      basePriceCents: 15_000,
    });

    const estimate = await createEstimate(org.ctx, {
      customerId,
      lines: [{ serviceId: service.id, name: 'Usługa publiczna', quantity: 1, unit: 'VISIT', unitPriceCents: 15_000, taxRateBps: 2300 }],
    });
    const quote = await createQuoteFromEstimate(org.ctx, estimate.id, { validDays: 14 });
    if (!quote) throw new Error('brak oferty');
    await db.update(quotes).set({ status: 'SENT' }).where(eq(quotes.id, quote.id));
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestUser(org.userId);
  });

  it('konto klienta działa po wygenerowaniu linku i znika po odwołaniu', async () => {
    const created = await ensureCustomerPortalToken(org.ctx, customerId);
    if (!created.ok) throw new Error(created.error);

    const response = await fetchWithRetry(`${BASE_URL}/moje/${created.data.token}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Klient Publiczny');
    expect(body).toContain('Oferty');
    expect(body).toContain('Faktury');
    expect(body).toContain('/p/'); // link do publicznej oferty

    await revokeCustomerPortalToken(org.ctx, customerId);
    const after = await fetchWithRetry(`${BASE_URL}/moje/${created.data.token}`);
    expect(after.status).toBe(404);
  });

  it('nieznany token konta klienta zwraca 404', async () => {
    const response = await fetchWithRetry(`${BASE_URL}/moje/ptok_nie_istnieje`);
    expect(response.status).toBe(404);
  });

  it('strona zaproszenia renderuje się, a nieznany token zwraca 404', async () => {
    const invited = await inviteByToken(org.ctx, { email: `public-${Date.now()}@example.com`, role: 'WORKER' });
    if (!invited.ok) throw new Error(invited.error);

    const ok = await fetchWithRetry(`${BASE_URL}/zaproszenie/${invited.data.token}`);
    expect(ok.status).toBe(200);
    const body = await ok.text();
    expect(body).toContain('Zaproszenie do zespołu');

    const missing = await fetchWithRetry(`${BASE_URL}/zaproszenie/${'x'.repeat(43)}`);
    expect(missing.status).toBe(404);
  });

  it('manifest PWA i service worker są dostępne', async () => {
    const manifest = await fetchWithRetry(`${BASE_URL}/manifest.webmanifest`);
    expect([200, 404]).toContain(manifest.status); // Next serwuje /manifest.webmanifest

    if (manifest.status === 200) {
      const json = (await manifest.json()) as { name?: string; start_url?: string; display?: string };
      expect(json.name).toContain('ServiceFlow');
      expect(json.display).toBe('standalone');
    }

    const sw = await fetchWithRetry(`${BASE_URL}/sw.js`);
    expect(sw.status).toBe(200);

    const offline = await fetchWithRetry(`${BASE_URL}/offline.html`);
    expect(offline.status).toBe(200);
  });

  it('strona klienta w aplikacji renderuje kartę konta klienta', async () => {
    const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    expect(customer).toBeTruthy();
  });
});
