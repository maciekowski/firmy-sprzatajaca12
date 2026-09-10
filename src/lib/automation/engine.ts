/**
 * Silnik automatyzacji.
 *
 * Każda automatyzacja ma: trigger, warunek, akcję, harmonogram (opóźnienie),
 * status i pełną historię wykonania (AutomationRun).
 *
 * Zasady:
 *  - uruchomienie jest idempotentne (zabezpieczenie przed podwójnym wykonaniem),
 *  - warunki są sprawdzane PONOWNIE w momencie wykonania (np. oferta mogła
 *    zostać zaakceptowana w międzyczasie — wtedy follow-up jest pomijany),
 *  - akcja, której nie da się wykonać (brak providera), kończy się statusem
 *    FAILED/SKIPPED z widocznym powodem — nigdy „sukcesem bez działania”.
 */
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  automationRuns,
  automations,
  communications,
  customers,
  invoices,
  jobs,
  memberships,
  notifications,
  quotes,
  reviewRequests,
  type Automation,
  type AutomationRun,
} from '@/lib/db/schema';
import { sendCommunication, getTemplate } from '@/lib/comms/service';
import { DEFAULT_TEMPLATES, renderTemplate } from '@/lib/comms/templates';
import { formatMoney } from '@/lib/money';
import { newId } from '@/lib/db/schema';

export const TRIGGER_LABELS: Record<string, string> = {
  QUOTE_SENT: 'Oferta wysłana',
  QUOTE_VIEWED: 'Oferta wyświetlona',
  QUOTE_ACCEPTED: 'Oferta zaakceptowana',
  JOB_CREATED: 'Utworzono zlecenie',
  JOB_SCHEDULED: 'Zlecenie zaplanowane',
  JOB_COMPLETED: 'Zlecenie zakończone',
  JOB_NO_SHOW: 'Nieobecność klienta',
  INVOICE_CREATED: 'Utworzono fakturę',
  INVOICE_SENT: 'Faktura wysłana',
  INVOICE_OVERDUE: 'Faktura przeterminowana',
  PAYMENT_RECEIVED: 'Otrzymano płatność',
  LEAD_CREATED: 'Utworzono leada',
  REQUEST_CREATED: 'Nowe zapytanie',
  CUSTOMER_INACTIVE: 'Klient nieaktywny',
};

export const ACTION_LABELS: Record<string, string> = {
  SEND_EMAIL: 'Wyślij e-mail',
  SEND_SMS: 'Wyślij SMS',
  CREATE_NOTIFICATION: 'Utwórz powiadomienie',
  CREATE_FOLLOW_UP_TASK: 'Utwórz zadanie follow-up',
  SEND_REVIEW_REQUEST: 'Wyślij prośbę o opinię',
  UPDATE_JOB_STATUS: 'Zmień status zlecenia',
};

/**
 * Kolejkuje uruchomienia automatyzacji dla danego zdarzenia.
 * Wywoływane z akcji biznesowych (np. wysłanie oferty).
 */
export async function enqueueAutomations(input: {
  organizationId: string;
  trigger: string;
  targetType: string;
  targetId: string;
  baseDate?: Date;
}): Promise<AutomationRun[]> {
  const base = input.baseDate ?? new Date();
  const rows = await db
    .select()
    .from(automations)
    .where(and(eq(automations.organizationId, input.organizationId), eq(automations.trigger, input.trigger as never), eq(automations.isActive, true)));

  if (rows.length === 0) return [];

  const runs = await db
    .insert(automationRuns)
    .values(
      rows.map((automation) => ({
        organizationId: input.organizationId,
        automationId: automation.id,
        status: 'PENDING' as const,
        scheduledAt: new Date(base.getTime() + automation.delayMinutes * 60_000),
        targetType: input.targetType,
        targetId: input.targetId,
      })),
    )
    .returning();

  await db.update(automations).set({ lastRunAt: new Date() }).where(
    inArray(
      automations.id,
      rows.map((r) => r.id),
    ),
  );

  return runs;
}

/**
 * Przetwarza uruchomienia, których czas nadszedł.
 * `FOR UPDATE SKIP LOCKED` gwarantuje, że równoległe procesy nie wykonają
 * tego samego uruchomienia dwa razy.
 */
export async function processDueRuns(limit = 50): Promise<{ processed: number; succeeded: number; failed: number; skipped: number }> {
  const claimed = await db.execute<{ id: string }>(sql`
    update ${automationRuns}
    set status = 'RUNNING', started_at = now(), attempts = ${automationRuns.attempts} + 1
    where id in (
      select id from ${automationRuns}
      where status = 'PENDING' and scheduled_at <= now()
      order by scheduled_at asc
      limit ${limit}
      for update skip locked
    )
    returning id
  `);

  const ids = (claimed.rows ?? []).map((row) => row.id).filter(Boolean);
  const stats = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

  for (const runId of ids) {
    const result = await executeRun(runId);
    stats.processed += 1;
    if (result === 'SUCCESS') stats.succeeded += 1;
    else if (result === 'SKIPPED') stats.skipped += 1;
    else stats.failed += 1;
  }

  return stats;
}

type RunOutcome = 'SUCCESS' | 'FAILED' | 'SKIPPED';

async function executeRun(runId: string): Promise<RunOutcome> {
  const rows = await db
    .select({ run: automationRuns, automation: automations })
    .from(automationRuns)
    .innerJoin(automations, eq(automations.id, automationRuns.automationId))
    .where(eq(automationRuns.id, runId))
    .limit(1);

  const row = rows[0];
  if (!row) return 'FAILED';
  const { run, automation } = row;

  if (!run.targetId) {
    await finishRun(run.id, 'SKIPPED', 'Brak obiektu docelowego dla automatyzacji.');
    return 'SKIPPED';
  }

  try {
    // 1. warunki sprawdzane ponownie w momencie wykonania
    const condition = await evaluateConditions(automation, run);
    if (!condition.ok) {
      await finishRun(run.id, 'SKIPPED', condition.reason);
      return 'SKIPPED';
    }

    // 2. wykonanie akcji
    const outcome = await executeAction(automation, run);
    await finishRun(run.id, outcome.status, outcome.message);
    return outcome.status;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd automatyzacji.';
    await finishRun(run.id, 'FAILED', message);
    return 'FAILED';
  }
}

async function finishRun(runId: string, status: RunOutcome, message?: string): Promise<void> {
  await db
    .update(automationRuns)
    .set({
      status,
      finishedAt: new Date(),
      result: message?.slice(0, 500) ?? null,
      error: status === 'FAILED' ? (message?.slice(0, 500) ?? null) : null,
    })
    .where(eq(automationRuns.id, runId));
}

async function evaluateConditions(
  automation: Automation,
  run: AutomationRun,
): Promise<{ ok: boolean; reason?: string }> {
  const conditions = automation.conditions ?? {};
  const targetId = run.targetId;

  if (conditions.onlyIfUnaccepted && run.targetType === 'quote' && targetId) {
    const rows = await db.select().from(quotes).where(eq(quotes.id, targetId)).limit(1);
    const quote = rows[0];
    if (!quote) return { ok: false, reason: 'Oferta nie istnieje.' };
    if (quote.status === 'ACCEPTED') return { ok: false, reason: 'Oferta została zaakceptowana — follow-up niepotrzebny.' };
    if (quote.status === 'REJECTED') return { ok: false, reason: 'Oferta została odrzucona.' };
    if (quote.status === 'CANCELLED' || quote.status === 'EXPIRED') {
      return { ok: false, reason: `Oferta ma status ${quote.status} — pominięto.` };
    }
  }

  if (conditions.onlyIfUnaccepted && run.targetType === 'invoice' && targetId) {
    const rows = await db.select().from(invoices).where(eq(invoices.id, targetId)).limit(1);
    const invoice = rows[0];
    if (!invoice) return { ok: false, reason: 'Faktura nie istnieje.' };
    if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') {
      return { ok: false, reason: `Faktura ma status ${invoice.status} — przypomnienie niepotrzebne.` };
    }
  }

  if (typeof conditions.minValueCents === 'number' && run.targetType === 'quote' && targetId) {
    const rows = await db.select().from(quotes).where(eq(quotes.id, targetId)).limit(1);
    const quote = rows[0];
    if (quote && quote.totalCents < conditions.minValueCents) {
      return { ok: false, reason: 'Wartość oferty poniżej progu automatyzacji.' };
    }
  }

  return { ok: true };
}

async function executeAction(automation: Automation, run: AutomationRun): Promise<{ status: RunOutcome; message: string }> {
  const config = automation.actionConfig ?? {};

  switch (automation.action) {
    case 'CREATE_NOTIFICATION':
    case 'CREATE_FOLLOW_UP_TASK': {
      const [notification] = await db
        .insert(notifications)
        .values({
          organizationId: run.organizationId,
          userId: null,
          title: renderTemplate(config.title ?? 'Przypomnienie: {{name}}', { name: automation.name }).slice(0, 200),
          body: (config.message ?? 'Automatyzacja: ' + automation.name).slice(0, 1000),
          type: automation.action === 'CREATE_FOLLOW_UP_TASK' ? 'FOLLOW_UP' : 'AUTOMATION',
          link: run.targetType === 'quote' ? `/oferty/${run.targetId}` : run.targetType === 'invoice' ? `/faktury/${run.targetId}` : null,
        })
        .returning();

      // powiadomienie dla wszystkich aktywnych członków organizacji
      const members = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.organizationId, run.organizationId), eq(memberships.isActive, true)));

      if (members.length > 0) {
        await db.insert(notifications).values(
          members.map((member) => ({
            organizationId: run.organizationId,
            userId: member.userId,
            title: notification.title,
            body: notification.body,
            type: notification.type,
            link: notification.link,
          })),
        );
        await db.delete(notifications).where(eq(notifications.id, notification.id));
      }

      return { status: 'SUCCESS', message: `Utworzono powiadomienie dla ${members.length} użytkowników.` };
    }

    case 'SEND_EMAIL':
    case 'SEND_SMS': {
      const channel = automation.action === 'SEND_EMAIL' ? 'EMAIL' : 'SMS';
      const target = await resolveRecipient(run);
      if (!target) return { status: 'SKIPPED', message: 'Brak odbiorcy w systemie.' };
      if (channel === 'EMAIL' && !target.email) return { status: 'SKIPPED', message: 'Klient nie ma adresu e-mail.' };
      if (channel === 'SMS' && !target.phone) return { status: 'SKIPPED', message: 'Klient nie ma numeru telefonu.' };

      const templateKey = config.templateKey ?? null;
      const template = templateKey ? await getTemplate(run.organizationId, templateKey) : null;
      const fallback = templateKey ? DEFAULT_TEMPLATES[templateKey] : undefined;
      const body = template?.body ?? config.body ?? fallback?.body ?? 'Wiadomość z ServiceFlow.';
      const subject = template?.subject ?? config.subject ?? fallback?.subject ?? null;

      const result = await sendCommunication({
        organizationId: run.organizationId,
        channel,
        to: channel === 'EMAIL' ? target.email! : target.phone!,
        subject,
        body,
        templateKey,
        variables: target.variables,
        customerId: target.customerId,
        quoteId: run.targetType === 'quote' ? run.targetId : null,
        jobId: run.targetType === 'job' ? run.targetId : null,
        invoiceId: run.targetType === 'invoice' ? run.targetId : null,
        category: 'AUTOMATION',
        emailOptIn: target.emailOptIn,
        smsOptIn: target.smsOptIn,
        transactionalOptIn: target.emailTransactionalOptIn,
        systemOptIn: target.emailSystemOptIn,
        automationOptIn: target.emailAutomationOptIn,
        marketingOptIn: target.emailMarketingOptIn,
      });

      if (result.delivered) {
        return { status: 'SUCCESS', message: `Wysłano wiadomość (${channel}).` };
      }
      return {
        status: result.communication.status === 'SKIPPED_NO_PROVIDER' ? 'SKIPPED' : 'FAILED',
        message: result.reason ?? 'Wiadomość nie została wysłana.',
      };
    }

    case 'SEND_REVIEW_REQUEST': {
      const target = await resolveRecipient(run);
      if (!target?.customerId) return { status: 'SKIPPED', message: 'Brak klienta dla prośby o opinię.' };

      const existing = await db
        .select()
        .from(reviewRequests)
        .where(and(eq(reviewRequests.organizationId, run.organizationId), eq(reviewRequests.customerId, target.customerId)))
        .limit(1);
      if (existing.length > 0) {
        return { status: 'SKIPPED', message: 'Prośba o opinię dla tego klienta już istnieje.' };
      }

      await db.insert(reviewRequests).values({
        organizationId: run.organizationId,
        customerId: target.customerId,
        jobId: run.targetType === 'job' ? run.targetId : null,
        channel: 'OWN_FORM',
        status: 'PENDING',
        token: newId('rvw'),
      });

      if (target.email) {
        const template = await getTemplate(run.organizationId, 'review_request');
        const fallback = DEFAULT_TEMPLATES.review_request;
        await sendCommunication({
          organizationId: run.organizationId,
          channel: 'EMAIL',
          to: target.email,
          subject: template?.subject ?? fallback.subject,
          body: template?.body ?? fallback.body,
          templateKey: 'review_request',
          variables: target.variables,
          customerId: target.customerId,
          category: 'AUTOMATION',
          emailOptIn: target.emailOptIn,
          transactionalOptIn: target.emailTransactionalOptIn,
          systemOptIn: target.emailSystemOptIn,
          automationOptIn: target.emailAutomationOptIn,
          marketingOptIn: target.emailMarketingOptIn,
        });
      }

      return { status: 'SUCCESS', message: 'Utworzono prośbę o opinię.' };
    }

    case 'UPDATE_JOB_STATUS': {
      const jobTargetId = run.targetId;
      if (run.targetType !== 'job' || !config.status || !jobTargetId) {
        return { status: 'SKIPPED', message: 'Automatyzacja dotyczy tylko zleceń i wymaga statusu docelowego.' };
      }
      await db
        .update(jobs)
        .set({ status: config.status as never, updatedAt: new Date() })
        .where(and(eq(jobs.id, jobTargetId), eq(jobs.organizationId, run.organizationId)));
      return { status: 'SUCCESS', message: `Zmieniono status zlecenia na ${config.status}.` };
    }

    default:
      return { status: 'FAILED', message: 'Nieobsługiwana akcja automatyzacji.' };
  }
}

type Recipient = {
  customerId: string | null;
  email: string | null;
  phone: string | null;
  emailOptIn: boolean | null;
  smsOptIn: boolean | null;
  variables: Record<string, string | number | null | undefined>;
  emailTransactionalOptIn?: boolean | null;
  emailSystemOptIn?: boolean | null;
  emailAutomationOptIn?: boolean | null;
  emailMarketingOptIn?: boolean | null;
};

async function resolveRecipient(run: AutomationRun): Promise<Recipient | null> {
  const targetId = run.targetId;
  if (!targetId) return null;
  const org = await db
    .select()
    .from(automations)
    .where(eq(automations.id, run.automationId))
    .limit(1);
  const organizationId = org[0]?.organizationId ?? run.organizationId;

  if (run.targetType === 'quote') {
    const rows = await db
      .select({ quote: quotes, customer: customers })
      .from(quotes)
      .innerJoin(customers, eq(customers.id, quotes.customerId))
      .where(and(eq(quotes.id, targetId), eq(quotes.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      customerId: row.customer.id,
      email: row.customer.email,
      phone: row.customer.phone,
      emailOptIn: row.customer.emailOptIn,
      smsOptIn: row.customer.smsOptIn,
      emailTransactionalOptIn: row.customer.emailTransactionalOptIn,
      emailSystemOptIn: row.customer.emailSystemOptIn,
      emailAutomationOptIn: row.customer.emailAutomationOptIn,
      emailMarketingOptIn: row.customer.emailMarketingOptIn,
      variables: {
        klient: row.customer.displayName,
        numer: row.quote.number,
        kwota: formatMoney(row.quote.totalCents),
        link: `${process.env.APP_URL ?? ''}/p/${row.quote.publicToken}`,
      },
    };
  }

  if (run.targetType === 'invoice') {
    const rows = await db
      .select({ invoice: invoices, customer: customers })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(and(eq(invoices.id, targetId), eq(invoices.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      customerId: row.customer.id,
      email: row.customer.email,
      phone: row.customer.phone,
      emailOptIn: row.customer.emailOptIn,
      smsOptIn: row.customer.smsOptIn,
      emailTransactionalOptIn: row.customer.emailTransactionalOptIn,
      emailSystemOptIn: row.customer.emailSystemOptIn,
      emailAutomationOptIn: row.customer.emailAutomationOptIn,
      emailMarketingOptIn: row.customer.emailMarketingOptIn,
      variables: {
        klient: row.customer.displayName,
        numer: row.invoice.number,
        kwota: formatMoney(row.invoice.totalCents),
        termin: row.invoice.dueDate.toLocaleDateString('pl-PL'),
        link: `${process.env.APP_URL ?? ''}/f/${row.invoice.publicToken}`,
      },
    };
  }

  if (run.targetType === 'job') {
    const rows = await db
      .select({ job: jobs, customer: customers })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(and(eq(jobs.id, targetId), eq(jobs.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      customerId: row.customer.id,
      email: row.customer.email,
      phone: row.customer.phone,
      emailOptIn: row.customer.emailOptIn,
      smsOptIn: row.customer.smsOptIn,
      emailTransactionalOptIn: row.customer.emailTransactionalOptIn,
      emailSystemOptIn: row.customer.emailSystemOptIn,
      emailAutomationOptIn: row.customer.emailAutomationOptIn,
      emailMarketingOptIn: row.customer.emailMarketingOptIn,
      variables: {
        klient: row.customer.displayName,
        numer: row.job.number,
        adres: [row.job.addressStreet, row.job.addressCity].filter(Boolean).join(', '),
        termin: row.job.scheduledStart ? row.job.scheduledStart.toLocaleString('pl-PL') : null,
      },
    };
  }

  return null;
}

/**
 * Wyprowadzone zdarzenia (nie wynikają z pojedynczej akcji użytkownika):
 *  - faktury po terminie,
 *  - klienci, którzy nie mieli zlecenia od wielu miesięcy.
 * Uruchamiane cyklicznie (cron/worker). Deduplikacja po (automacja, cel).
 */
export async function enqueueDerivedTriggers(organizationId?: string): Promise<number> {
  let created = 0;
  const orgs = organizationId
    ? [{ id: organizationId }]
    : await db
        .selectDistinct({ id: automations.organizationId })
        .from(automations)
        .where(eq(automations.isActive, true));

  for (const org of orgs) {
    // --- faktury przeterminowane ---
    const overdueAutomations = await db
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.organizationId, org.id),
          eq(automations.trigger, 'INVOICE_OVERDUE'),
          eq(automations.isActive, true),
        ),
      );

    if (overdueAutomations.length > 0) {
      const overdueInvoices = await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.organizationId, org.id),
            eq(invoices.status, 'SENT'),
            lte(invoices.dueDate, new Date()),
          ),
        );

      for (const invoice of overdueInvoices) {
        for (const automation of overdueAutomations) {
          const existing = await db
            .select({ id: automationRuns.id })
            .from(automationRuns)
            .where(
              and(
                eq(automationRuns.automationId, automation.id),
                eq(automationRuns.targetId, invoice.id),
                inArray(automationRuns.status, ['PENDING', 'RUNNING', 'SUCCESS']),
              ),
            )
            .limit(1);
          if (existing.length > 0) continue;

          await db.insert(automationRuns).values({
            organizationId: org.id,
            automationId: automation.id,
            status: 'PENDING',
            scheduledAt: new Date(Date.now() + automation.delayMinutes * 60_000),
            targetType: 'invoice',
            targetId: invoice.id,
          });
          created += 1;
        }
      }
    }

    // --- klienci nieaktywni ---
    const inactiveAutomations = await db
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.organizationId, org.id),
          eq(automations.trigger, 'CUSTOMER_INACTIVE'),
          eq(automations.isActive, true),
        ),
      );

    if (inactiveAutomations.length > 0) {
      const months = Number((inactiveAutomations[0].conditions as { months?: number } | null)?.months ?? 6);
      const threshold = new Date();
      threshold.setMonth(threshold.getMonth() - months);

      const inactiveCustomers = await db
        .select()
        .from(customers)
        .where(and(eq(customers.organizationId, org.id), eq(customers.status, 'ACTIVE')));

      for (const customer of inactiveCustomers) {
        const lastJob = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.customerId, customer.id), eq(jobs.status, 'COMPLETED')))
          .orderBy(sql`${jobs.completedAt} desc nulls last`)
          .limit(1);

        const recentJob = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.customerId, customer.id), sql`${jobs.createdAt} >= ${threshold}`))
          .limit(1);

        if (lastJob.length === 0 || recentJob.length > 0) continue;

        for (const automation of inactiveAutomations) {
          const existing = await db
            .select({ id: automationRuns.id })
            .from(automationRuns)
            .where(
              and(
                eq(automationRuns.automationId, automation.id),
                eq(automationRuns.targetId, customer.id),
                inArray(automationRuns.status, ['PENDING', 'RUNNING', 'SUCCESS']),
              ),
            )
            .limit(1);
          if (existing.length > 0) continue;

          await db.insert(automationRuns).values({
            organizationId: org.id,
            automationId: automation.id,
            status: 'PENDING',
            scheduledAt: new Date(Date.now() + automation.delayMinutes * 60_000),
            targetType: 'customer',
            targetId: customer.id,
          });
          created += 1;
        }
      }
    }
  }

  return created;
}

/** Anuluje zaplanowane uruchomienia dla celu (np. oferta zaakceptowana -> nie wysyłamy follow-upów). */
export async function cancelPendingRuns(organizationId: string, targetId: string): Promise<number> {
  const rows = await db
    .update(automationRuns)
    .set({ status: 'SKIPPED', finishedAt: new Date(), result: 'Anulowano — warunek przestał być spełniony.' })
    .where(
      and(
        eq(automationRuns.organizationId, organizationId),
        eq(automationRuns.targetId, targetId),
        eq(automationRuns.status, 'PENDING'),
      ),
    )
    .returning({ id: automationRuns.id });
  return rows.length;
}

/** Podsumowanie statusów dla widoku automatyzacji. */
export async function getAutomationStats(organizationId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: automationRuns.status, count: sql<number>`count(*)::int` })
    .from(automationRuns)
    .where(eq(automationRuns.organizationId, organizationId))
    .groupBy(automationRuns.status);
  const stats: Record<string, number> = {};
  for (const row of rows) stats[row.status] = Number(row.count);
  return stats;
}

export async function countCommunications(organizationId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communications)
    .where(eq(communications.organizationId, organizationId));
  return Number(rows[0]?.count ?? 0);
}

export { isNull, or };
