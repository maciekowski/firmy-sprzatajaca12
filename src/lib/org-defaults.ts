/**
 * Domyślne dane nowej organizacji: szablony wiadomości i automatyzacje.
 * Dzięki temu firma od razu ma działający proces — bez wymyślonych danych biznesowych.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { automations, messageTemplates } from '@/lib/db/schema';
import { DEFAULT_TEMPLATES } from '@/lib/comms/templates';

export async function seedMessageTemplates(organizationId: string): Promise<void> {
  const values = Object.entries(DEFAULT_TEMPLATES).map(([key, template]) => ({
    organizationId,
    key,
    name: template.name,
    channel: 'EMAIL' as const,
    subject: template.subject,
    body: template.body,
    isActive: true,
  }));

  await db
    .insert(messageTemplates)
    .values(values)
    .onConflictDoNothing({ target: [messageTemplates.organizationId, messageTemplates.key] });
}

/**
 * Domyślne automatyzacje. Włączone domyślnie — użytkownik może je wyłączyć.
 * Jeżeli brak providera poczty, uruchomienia kończą się statusem
 * SKIPPED_NO_PROVIDER (system nie udaje wysyłki).
 */
export async function seedDefaultAutomations(organizationId: string): Promise<void> {
  const existing = await db
    .select({ id: automations.id })
    .from(automations)
    .where(eq(automations.organizationId, organizationId))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(automations).values([
    {
      organizationId,
      name: 'Follow-up oferty po 2 dniach',
      trigger: 'QUOTE_SENT',
      action: 'SEND_EMAIL',
      conditions: { onlyIfUnaccepted: true },
      actionConfig: { templateKey: 'quote_followup_1' },
      delayMinutes: 2 * 24 * 60,
      isActive: true,
    },
    {
      organizationId,
      name: 'Follow-up oferty po 5 dniach',
      trigger: 'QUOTE_SENT',
      action: 'SEND_EMAIL',
      conditions: { onlyIfUnaccepted: true },
      actionConfig: { templateKey: 'quote_followup_2' },
      delayMinutes: 5 * 24 * 60,
      isActive: true,
    },
    {
      organizationId,
      name: 'Follow-up oferty po 10 dniach',
      trigger: 'QUOTE_SENT',
      action: 'SEND_EMAIL',
      conditions: { onlyIfUnaccepted: true },
      actionConfig: { templateKey: 'quote_followup_3' },
      delayMinutes: 10 * 24 * 60,
      isActive: true,
    },
    {
      organizationId,
      name: 'Prośba o opinię dzień po zleceniu',
      trigger: 'JOB_COMPLETED',
      action: 'SEND_REVIEW_REQUEST',
      conditions: {},
      actionConfig: { templateKey: 'review_request' },
      delayMinutes: 24 * 60,
      isActive: true,
    },
    {
      organizationId,
      name: 'Przypomnienie o przeterminowanej fakturze',
      trigger: 'INVOICE_OVERDUE',
      action: 'SEND_EMAIL',
      conditions: {},
      actionConfig: { templateKey: 'payment_reminder' },
      delayMinutes: 0,
      isActive: true,
    },
    {
      organizationId,
      name: 'Powiadomienie o nowym zapytaniu',
      trigger: 'REQUEST_CREATED',
      action: 'CREATE_NOTIFICATION',
      conditions: {},
      actionConfig: { title: 'Nowe zapytanie', message: 'Do skrzynki zapytań wpłynęła nowa wiadomość od klienta.' },
      delayMinutes: 0,
      isActive: true,
    },
  ]);
}
