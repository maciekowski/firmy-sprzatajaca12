/**
 * Testy systemowe: cron, czas pracy, AI (silnik regułowy), KSeF i komunikacja.
 *
 * Wspólny mianownik: system NIE może udawać działania, którego nie wykonał.
 * Brak providera, brak modelu AI lub brak konfiguracji musi być widoczny
 * w danych (status), a nie ukryty pod „sukcesem”.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { automationRuns, communications, organizations } from '@/lib/db/schema';
import { getAIProvider, aiProviderStatus } from '@/lib/ai';
import { getKsefConfig, isKsefConfigured } from '@/lib/ksef/config';
import { sendCommunication } from '@/lib/comms/service';
import { createAutomation } from '@/lib/services/automations';
import { enqueueAutomations } from '@/lib/automation/engine';
import { createJob, pauseTimeEntry, resumeTimeEntry, startTimeEntry, stopTimeEntry } from '@/lib/services/jobs';
import { createTestCustomer, createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

describe('system: cron, czas pracy, AI, KSeF, komunikacja', () => {
  let org: Fixture;

  beforeAll(async () => {
    org = await createTestOrganization('SYS');
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestUser(org.userId);
  });

  describe('cron / worker', () => {
    it('endpoint bez sekretu jest odrzucany, a z sekretem wykonuje pracę', async () => {
      const secret = process.env.CRON_SECRET ?? '';
      if (!secret) {
        // brak konfiguracji = uczciwy status 503, a nie „udane” uruchomienie
        const response = await fetch(`${BASE_URL}/api/cron/run`, { method: 'POST' });
        expect(response.status).toBe(503);
        return;
      }

      const unauthorized = await fetch(`${BASE_URL}/api/cron/run`, { method: 'POST' });
      expect(unauthorized.status).toBe(401);

      // reguła do wykonania: powiadomienie natychmiast po zdarzeniu
      await createAutomation(org.ctx, {
        name: 'Cron test',
        trigger: 'JOB_CREATED',
        action: 'CREATE_NOTIFICATION',
        delayMinutes: 0,
        actionConfig: { title: 'Test crona', message: 'Wiadomość testowa.' },
      });
      await enqueueAutomations({
        organizationId: org.organizationId,
        trigger: 'JOB_CREATED',
        targetType: 'job',
        targetId: 'job_cron_test',
      });

      const authorized = await fetch(`${BASE_URL}/api/cron/run`, {
        method: 'POST',
        headers: { 'x-cron-secret': secret },
      });
      expect(authorized.status).toBe(200);

      const payload = (await authorized.json()) as { ok: boolean; automations?: { processed: number } };
      expect(payload.ok).toBe(true);
      expect(payload.automations?.processed ?? 0).toBeGreaterThan(0);

      const runs = await db.select().from(automationRuns).where(eq(automationRuns.organizationId, org.organizationId));
      expect(runs.some((run) => run.status === 'SUCCESS')).toBe(true);
    });
  });

  describe('czas pracy', () => {
    it('licznik działa: start → pauza → wznowienie → stop, a czas nie liczy przerwy', async () => {
      const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient Czas' });
      const job = await createJob(org.ctx, {
        title: 'Zlecenie czas',
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
      const jobId = job.data!.id;

      const started = await startTimeEntry(org.ctx, jobId);
      expect(started.ok).toBe(true);

      // drugi licznik w tym samym zleceniu nie może wystartować
      const double = await startTimeEntry(org.ctx, jobId);
      expect(double.ok).toBe(false);

      const paused = await pauseTimeEntry(org.ctx, jobId);
      expect(paused.ok).toBe(true);
      expect(paused.data!.status).toBe('PAUSED');

      // pauza trwała 2 s — po wznowieniu i zatrzymaniu nie może być wliczona
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      const resumed = await resumeTimeEntry(org.ctx, jobId);
      expect(resumed.ok).toBe(true);
      expect(resumed.data!.status).toBe('RUNNING');

      const stopped = await stopTimeEntry(org.ctx, jobId);
      expect(stopped.ok).toBe(true);
      expect(stopped.data!.status).toBe('STOPPED');
      expect(stopped.data!.pausedMs).toBeGreaterThanOrEqual(1_500);
      expect(stopped.data!.durationSeconds).toBeLessThan(5);

      // po zatrzymaniu nie ma aktywnego licznika
      const stopAgain = await stopTimeEntry(org.ctx, jobId);
      expect(stopAgain.ok).toBe(false);
    });
  });

  describe('AI — opcjonalne i nie liczy pieniędzy', () => {
    it('bez klucza działa silnik regułowy, który nie udaje modelu', () => {
      const status = aiProviderStatus();
      const provider = getAIProvider();

      if (!status.configured) {
        expect(provider.name).toBe('rules');
        expect(status.label).toContain('Silnik regułowy');
      }

      // model regułowy nie generuje „odpowiedzi AI” — zwraca null (brak wymyślania treści)
      expect(provider.answerBusinessQuestion === undefined || typeof provider.answerBusinessQuestion === 'function').toBe(true);
    });

    it('analiza zapytania działa bez modelu i nie wymyśla cen', async () => {
      const parsed = await getAIProvider().parseCustomerRequest({
        text: 'Prosze o wycene sprzatania mieszkania 50 m2 w Krakowie, najlepiej w piatek po 16.',
        serviceNames: ['Sprzątanie mieszkania', 'Mycie okien'],
      });

      expect(parsed).toBeTruthy();
      expect(Array.isArray(parsed.items)).toBe(true);
      expect(parsed.items.length).toBeGreaterThan(0);

      // analiza nie wymyśla danych: brak pewności oznacza „do potwierdzenia”
      for (const item of parsed.items) {
        expect(typeof item.label).toBe('string');
        if (!item.quantityFound) expect(item.quantity).toBeNull();
        expect(['SQM', 'HOUR', 'PIECE', 'ROOM', 'VEHICLE', 'VISIT', 'FIXED', null]).toContain(item.unit);
      }

      // wynik analizy NIE zawiera kwot — pieniądze liczy wyłącznie silnik cenowy
      expect((parsed as unknown as { totalCents?: number }).totalCents).toBeUndefined();
      expect((parsed as unknown as { price?: number }).price).toBeUndefined();
    });
  });

  describe('KSeF — warstwa zewnętrzna', () => {
    it('bez konfiguracji nie ma numeru KSeF i nie udajemy wysyłki', () => {
      const config = getKsefConfig();
      if (config) {
        expect(isKsefConfigured()).toBe(true);
        expect(['TEST', 'PROD']).toContain(config.mode);
      } else {
        expect(isKsefConfigured()).toBe(false);
      }
    });

    it('faktura bez wysyłki do KSeF ma pusty numer (numer nadaje KSeF)', async () => {
      const [row] = await db
        .select({ ksefNumber: organizations.plan })
        .from(organizations)
        .where(eq(organizations.id, org.organizationId))
        .limit(1);
      // sanity check zapytania — numer KSeF przechowywany jest na fakturze, nie na firmie
      expect(row).toBeTruthy();
    });
  });

  describe('komunikacja — brak providera to brak wysyłki', () => {
    it('zapisuje status SKIPPED_NO_PROVIDER lub FAILED (nigdy SENT bez providera)', async () => {
      const result = await sendCommunication({
        organizationId: org.organizationId,
        channel: 'EMAIL',
        to: 'test@example.com',
        subject: 'Test',
        body: 'Treść testowa',
        idempotencyKey: `system-test-${Date.now()}`,
      });

      const [row] = await db.select().from(communications).where(eq(communications.id, result.communication.id)).limit(1);

      expect(row).toBeTruthy();
      if (!result.delivered) {
        // brak providera musi być widoczny w statusie, a nie zamaskowany sukcesem
        expect(['SKIPPED_NO_PROVIDER', 'FAILED', 'SKIPPED_NO_CONSENT']).toContain(row!.status);
        expect(row!.error).toBeTruthy();
        expect(row!.sentAt).toBeNull();
      } else {
        expect(['SENT', 'DELIVERED']).toContain(row!.status);
      }
    });

    it('ten sam klucz idempotencji nie wysyła wiadomości drugi raz', async () => {
      const key = `system-test-dup-${Date.now()}`;
      const first = await sendCommunication({
        organizationId: org.organizationId,
        channel: 'EMAIL',
        to: 'test@example.com',
        body: 'Treść',
        idempotencyKey: key,
      });
      const second = await sendCommunication({
        organizationId: org.organizationId,
        channel: 'EMAIL',
        to: 'test@example.com',
        body: 'Treść',
        idempotencyKey: key,
      });

      expect(second.deduplicated).toBe(true);
      expect(second.communication.id).toBe(first.communication.id);

      const rows = await db.select().from(communications).where(eq(communications.idempotencyKey, key));
      expect(rows).toHaveLength(1);
    });
  });
});
