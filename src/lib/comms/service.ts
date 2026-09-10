/**
 * Warstwa wysyłki wiadomości — zawsze zapisuje rzeczywisty rezultat w bazie.
 *
 * Statusy:
 *  - SENT                   — provider potwierdził wysyłkę,
 *  - FAILED                 — provider zwrócił błąd,
 *  - SKIPPED_NO_PROVIDER    — brak konfiguracji (system NIE udaje wysyłki),
 *  - SKIPPED_NO_CONSENT     — klient nie wyraził zgody na ten kanał,
 *  - INVALID_RECIPIENT      -> zapisywane jako FAILED z informacją o błędzie.
 */
import { db } from '@/lib/db/client';
import { communications, messageTemplates, type Communication } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { emailProvider } from './email';
import { smsProvider } from './sms';
import { renderTemplate, textToHtml, type TemplateVariables } from './templates';

export type SendCommunicationInput = {
  organizationId: string;
  channel: 'EMAIL' | 'SMS' | 'INTERNAL';
  to: string;
  subject?: string | null;
  body: string;
  templateKey?: string | null;
  variables?: TemplateVariables;
  customerId?: string | null;
  quoteId?: string | null;
  jobId?: string | null;
  invoiceId?: string | null;
  userId?: string | null;
  /** czy wymagać zgody klienta (domyślnie tak, dla kanałów zewnętrznych) */
  respectConsent?: boolean;
  emailOptIn?: boolean | null;
  smsOptIn?: boolean | null;
};

export type SendCommunicationResult = {
  communication: Communication;
  delivered: boolean;
  reason?: string;
};

export async function getTemplate(
  organizationId: string,
  key: string,
): Promise<{ subject: string | null; body: string } | null> {
  const rows = await db
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.organizationId, organizationId), eq(messageTemplates.key, key)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { subject: row.subject, body: row.body };
}

export async function sendCommunication(input: SendCommunicationInput): Promise<SendCommunicationResult> {
  const variables = input.variables ?? {};
  const body = renderTemplate(input.body, variables);
  const subject = input.subject ? renderTemplate(input.subject, variables) : null;

  let status: Communication['status'] = 'PENDING';
  let provider: string | null = null;
  let providerMessageId: string | null = null;
  let error: string | null = null;

  if (input.channel === 'INTERNAL') {
    status = 'SENT';
    provider = 'internal';
  } else {
    const respectConsent = input.respectConsent ?? true;
    const consentOk =
      !respectConsent || (input.channel === 'EMAIL' ? input.emailOptIn !== false : input.smsOptIn !== false);

    if (!consentOk) {
      status = 'SKIPPED_NO_CONSENT';
      error = 'Klient nie wyraził zgody na ten kanał komunikacji.';
    } else {
      const channelProvider = input.channel === 'EMAIL' ? emailProvider : smsProvider;
      provider = channelProvider.name;
      const result = await channelProvider.send({
        to: input.to,
        subject,
        body,
        html: input.channel === 'EMAIL' ? textToHtml(body) : null,
      });
      if (result.ok) {
        status = 'SENT';
        providerMessageId = result.providerMessageId ?? null;
      } else {
        status = result.reason === 'NO_PROVIDER' ? 'SKIPPED_NO_PROVIDER' : 'FAILED';
        error = result.error;
      }
    }
  }

  const [row] = await db
    .insert(communications)
    .values({
      organizationId: input.organizationId,
      channel: input.channel,
      direction: 'OUTBOUND',
      status,
      templateKey: input.templateKey ?? null,
      subject,
      body,
      toAddress: input.to,
      fromAddress: input.channel === 'EMAIL' ? (process.env.MAIL_FROM ?? null) : null,
      provider,
      providerMessageId,
      error,
      sentAt: status === 'SENT' ? new Date() : null,
      customerId: input.customerId ?? null,
      quoteId: input.quoteId ?? null,
      jobId: input.jobId ?? null,
      invoiceId: input.invoiceId ?? null,
      userId: input.userId ?? null,
    })
    .returning();

  return {
    communication: row,
    delivered: status === 'SENT',
    reason: error ?? undefined,
  };
}

/** Powiadomienie wewnętrzne (zawsze dostępne — nie wymaga providera). */
export async function notifyInternal(input: {
  organizationId: string;
  to: string;
  title: string;
  body: string;
  link?: string | null;
  userId?: string | null;
  customerId?: string | null;
  quoteId?: string | null;
  jobId?: string | null;
  invoiceId?: string | null;
}): Promise<SendCommunicationResult> {
  return sendCommunication({
    organizationId: input.organizationId,
    channel: 'INTERNAL',
    to: input.to,
    subject: input.title,
    body: input.body,
    templateKey: null,
    userId: input.userId ?? null,
    customerId: input.customerId ?? null,
    quoteId: input.quoteId ?? null,
    jobId: input.jobId ?? null,
    invoiceId: input.invoiceId ?? null,
  });
}

export { emailProvider, smsProvider };
export { DEFAULT_TEMPLATES } from './templates';
