import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { automationRuns, automations, notifications, quotes } from '@/lib/db/schema';
import { enqueueAutomations, getAutomationStats, processDueRuns } from '@/lib/automation/engine';
import { createAutomation, deleteAutomation, listAutomationRuns, listAutomations, toggleAutomation, updateAutomation } from '@/lib/services/automations';
import { createEstimate, createQuoteFromEstimate } from '@/lib/services/estimates';
import { createTestCustomer, createTestOrganization, createTestService, deleteTestOrganization, deleteTestUser } from '../helpers';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

/**
 * Automatyzacje: reguły, kolejka, wykonanie i logi.
 * Kluczowe: idempotencja (to samo uruchomienie nie wykona się dwa razy),
 * warunki sprawdzane w momencie wykonania, izolacja danych między firmami.
 */
describe('silnik automatyzacji', () => {
  let org: Fixture;
  let otherOrg: Fixture;

  beforeAll(async () => {
    org = await createTestOrganization('AUTO-A');
    otherOrg = await createTestOrganization('AUTO-B');
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestOrganization(otherOrg.organizationId);
    await deleteTestUser(org.userId);
    await deleteTestUser(otherOrg.userId);
  });

  it('tworzy regułę z walidacją nazwy i opóźnienia', async () => {
    expect((await createAutomation(org.ctx, { name: '', trigger: 'JOB_CREATED', action: 'CREATE_NOTIFICATION' })).ok).toBe(false);
    expect(
      (await createAutomation(org.ctx, { name: 'Zła reguła', trigger: 'JOB_CREATED', action: 'CREATE_NOTIFICATION', delayMinutes: -1 })).ok,
    ).toBe(false);
    expect(
      (await createAutomation(org.ctx, { name: 'Za duże opóźnienie', trigger: 'JOB_CREATED', action: 'CREATE_NOTIFICATION', delayMinutes: 60 * 24 * 60 + 1 })).ok,
    ).toBe(false);

    const created = await createAutomation(org.ctx, {
      name: 'Powiadomienie po zleceniu',
      trigger: 'JOB_CREATED',
      action: 'CREATE_NOTIFICATION',
      delayMinutes: 0,
      actionConfig: { title: 'Nowe zlecenie', message: 'Sprawdź szczegóły.' },
    });
    expect(created.ok).toBe(true);
  });

  it('zdarzenie kolejkuje uruchomienie, a worker je wykonuje', async () => {
    const automation = await createAutomation(org.ctx, {
      name: 'Follow-up po ofercie',
      trigger: 'QUOTE_SENT',
      action: 'CREATE_NOTIFICATION',
      delayMinutes: 0,
      actionConfig: { title: 'Oferta wysłana', message: 'Przypomnij się klientowi.' },
    });
    if (!automation.ok) throw new Error('Nie utworzono reguły');

    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient Automatyzacji' });
    const service = await createTestService(org.organizationId, { name: 'Usługa auto', basePriceCents: 5000 });
    const estimate = await createEstimate(org.ctx, {
      customerId: customer.id,
      lines: [
        {
          serviceId: service.id,
          name: 'Usługa auto',
          quantity: 1,
          unit: 'VISIT',
          customUnitLabel: null,
          description: null,
          unitPriceCents: 5000,
          taxRateBps: 2300,
        },
      ],
      travelFeeType: 'NONE',
      travelDistanceKm: null,
      isUrgent: false,
      notes: null,
      terms: null,
    });
    const quote = await createQuoteFromEstimate(org.ctx, estimate.id, { validDays: 14 });
    expect(quote).toBeTruthy();

    const runs = await enqueueAutomations({
      organizationId: org.organizationId,
      trigger: 'QUOTE_SENT',
      targetType: 'quote',
      targetId: quote!.id,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('PENDING');

    const processed = await processDueRuns(50);
    expect(processed.processed).toBeGreaterThan(0);
    expect(processed.succeeded).toBeGreaterThan(0);

    const history = await listAutomationRuns(org.organizationId);
    const run = history.find((item) => item.run.automationId === automation.automation.id);
    expect(history.length).toBeGreaterThan(0);
    expect(run?.run.status).toBe('SUCCESS');

    const createdNotifications = await db
      .select()
      .from(notifications)
      .where(eq(notifications.organizationId, org.organizationId));
    expect(createdNotifications.length).toBeGreaterThan(0);
  });

  it('ponowne przetworzenie kolejki nie wykonuje tego samego uruchomienia dwa razy (idempotencja)', async () => {
    const before = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.organizationId, org.organizationId));
    const successBefore = before.filter((row) => row.status === 'SUCCESS').length;

    const second = await processDueRuns(50);
    expect(second.processed).toBe(0);

    const after = await db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.organizationId, org.organizationId));
    expect(after.filter((row) => row.status === 'SUCCESS').length).toBe(successBefore);
  });

  it('warunek „tylko niezaakceptowane” pomija wykonanie dla zaakceptowanej oferty', async () => {
    const created = await createAutomation(org.ctx, {
      name: 'Monit tylko dla niezaakceptowanych',
      trigger: 'QUOTE_SENT',
      action: 'CREATE_NOTIFICATION',
      delayMinutes: 0,
      conditions: { onlyIfUnaccepted: true },
      actionConfig: { title: 'Monit', message: 'Oferta nadal bez decyzji.' },
    });
    if (!created.ok) throw new Error('Nie utworzono reguły');

    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient warunek' });
    const service = await createTestService(org.organizationId, { name: 'Usługa warunek', basePriceCents: 3000 });
    const estimate = await createEstimate(org.ctx, {
      customerId: customer.id,
      lines: [
        {
          serviceId: service.id,
          name: 'Usługa warunek',
          quantity: 1,
          unit: 'VISIT',
          customUnitLabel: null,
          description: null,
          unitPriceCents: 3000,
          taxRateBps: 2300,
        },
      ],
      travelFeeType: 'NONE',
      travelDistanceKm: null,
      isUrgent: false,
      notes: null,
      terms: null,
    });
    const quote = await createQuoteFromEstimate(org.ctx, estimate.id, { validDays: 14 });
    await db.update(quotes).set({ status: 'ACCEPTED' }).where(eq(quotes.id, quote!.id));

    await enqueueAutomations({
      organizationId: org.organizationId,
      trigger: 'QUOTE_SENT',
      targetType: 'quote',
      targetId: quote!.id,
    });

    const result = await processDueRuns(50);
    expect(result.skipped).toBeGreaterThan(0);

    const history = await listAutomationRuns(org.organizationId);
    const skippedRun = history.find((item) => item.run.targetId === quote!.id && item.run.status === 'SKIPPED');
    expect(skippedRun).toBeTruthy();
  });

  it('wyłączona reguła nie kolejkuje uruchomień', async () => {
    const created = await createAutomation(org.ctx, {
      name: 'Reguła wyłączona',
      trigger: 'LEAD_CREATED',
      action: 'CREATE_NOTIFICATION',
      isActive: false,
    });
    if (!created.ok) throw new Error('Nie utworzono reguły');

    const runs = await enqueueAutomations({
      organizationId: org.organizationId,
      trigger: 'LEAD_CREATED',
      targetType: 'lead',
      targetId: 'lead_test',
    });
    expect(runs).toHaveLength(0);

    await toggleAutomation(org.ctx, created.automation.id, true);
    const afterToggle = await enqueueAutomations({
      organizationId: org.organizationId,
      trigger: 'LEAD_CREATED',
      targetType: 'lead',
      targetId: 'lead_test',
    });
    expect(afterToggle.length).toBeGreaterThan(0);
  });

  it('statystyki wykonań są liczone z bazy', async () => {
    const stats = await getAutomationStats(org.organizationId);
    const success = Number(stats.SUCCESS ?? 0);
    const skipped = Number(stats.SKIPPED ?? 0);
    expect(success).toBeGreaterThan(0);
    expect(skipped).toBeGreaterThan(0);
  });

  it('inna organizacja nie widzi reguł ani wykonań obcej firmy', async () => {
    const foreignRules = await listAutomations(otherOrg.organizationId);
    expect(foreignRules).toHaveLength(0);

    const foreignRuns = await listAutomationRuns(otherOrg.organizationId);
    expect(foreignRuns).toHaveLength(0);

    // próba edycji cudzej reguły jest ignorowana (aktualizacja po kluczu organizacji)
    const [ownRule] = await listAutomations(org.organizationId);
    const updated = await updateAutomation(otherOrg.ctx, ownRule!.id, { name: 'Włamanie' });
    expect(updated.ok).toBe(false);

    const deleted = await deleteAutomation(otherOrg.ctx, ownRule!.id);
    expect(deleted.ok).toBe(false);

    // reguła nadal istnieje u właściciela — obca firma nic nie zmieniła
    const ownRules = await listAutomations(org.organizationId);
    expect(ownRules.some((rule) => rule.id === ownRule!.id)).toBe(true);
    expect(ownRules.find((rule) => rule.id === ownRule!.id)!.name).not.toBe('Włamanie');
  });
});
