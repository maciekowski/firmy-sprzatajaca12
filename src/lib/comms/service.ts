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
import { activeEmailProvider, emailFromAddress, emailProvider } from './email';
import { smsProvider } from './sms';
import { renderTemplate, textToHtml, type TemplateVariables } from './templates';

/**
 * Kategorie wiadomości — zgody klienta są rozpatrywane osobno dla każdej z nich.
 *  - TRANSACTIONAL — wynika z realizacji usługi (np. oferta, faktura),
 *  - SYSTEM        — techniczne powiadomienia (np. link, zmiana terminu),
 *  - AUTOMATION    — działania automatyczne (follow-up, prośba o opinię),
 *  - MARKETING     — treści promocyjne (domyślnie WYŁĄCZONE — wymagają zgody).
 */
export type MessageCategory = 'TRANSACTIONAL' | 'SYSTEM' | 'AUTOMATION' | 'MARKETING';

export const MESSAGE_CATEGORY_LABELS: Record<MessageCategory, string> = {
  TRANSACTIONAL: 'Transakcyjne (oferty, faktury, potwierdzenia)',
  SYSTEM: 'Systemowe (linki, zmiany terminów)',
  AUTOMATION: 'Automatyczne (follow-upy, prośby o opinię)',
  MARKETING: 'Marketingowe (oferty specjalne, promocje)',
};

/**
 * Reguła zgody dla kategorii. Zwraca powód odmowy — dzięki niemu w bazie
 * widać, DLACZEGO wiadomość nie została wysłana (zamiast „sukcesu bez działania”).
 */
export function consentDecision(
  category: MessageCategory,
  prefs: { channelOptIn?: boolean | null; transactionalOptIn?: boolean | null; systemOptIn?: boolean | null; automationOptIn?: boolean | null; marketingOptIn?: boolean | null },
): { allowed: boolean; reason?: string } {
  if (prefs.channelOptIn === false) return { allowed: false, reason: 'Klient nie wyraził zgody na ten kanał komunikacji.' };

  switch (category) {
    case 'MARKETING':
      return prefs.marketingOptIn === true
        ? { allowed: true }
        : { allowed: false, reason: 'Brak zgody na wiadomości marketingowe (domyślnie wyłączone).' };
    case 'AUTOMATION':
      return prefs.automationOptIn === false
        ? { allowed: false, reason: 'Klient wyłączył wiadomości automatyczne.' }
        : { allowed: true };
    case 'SYSTEM':
      return prefs.systemOptIn === false ? { allowed: false, reason: 'Klient wyłączył wiadomości systemowe.' } : { allowed: true };
    case 'TRANSACTIONAL':
    default:
      return prefs.transactionalOptIn === false
        ? { allowed: false, reason: 'Klient wyłączył wiadomości transakcyjne.' }
        : { allowed: true };
  }
}

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
  /** kategoria wiadomości — decyduje, jakiej zgody wymagamy (domyślnie TRANSACTIONAL) */
  category?: MessageCategory;
  emailOptIn?: boolean | null;
  smsOptIn?: boolean | null;
  transactionalOptIn?: boolean | null;
  systemOptIn?: boolean | null;
  automationOptIn?: boolean | null;
  marketingOptIn?: boolean | null;
  /**
   * Klucz idempotencji. Jeżeli wiadomość z tym kluczem istnieje,
   * wysyłka NIE jest powtarzana (worker może zostać uruchomiony ponownie).
   */
  idempotencyKey?: string | null;
};

export type SendCommunicationResult = {
  communication: Communication;
  delivered: boolean;
  reason?: string;
  /** true, gdy wiadomość o tym samym kluczu już istniała i nie wysłano jej ponownie */
  deduplicated?: boolean;
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
  // Idempotencja: ten sam klucz = jedna wiadomość, niezależnie od liczby wywołań.
  if (input.idempotencyKey) {
    const existing = await db
      .select()
      .from(communications)
      .where(and(eq(communications.organizationId, input.organizationId), eq(communications.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (existing[0]) {
      return { communication: existing[0], delivered: existing[0].status === 'SENT' || existing[0].status === 'DELIVERED', reason: existing[0].error ?? undefined, deduplicated: true };
    }
  }

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
    const channelOptIn = input.channel === 'EMAIL' ? input.emailOptIn : input.smsOptIn;
    const decision = respectConsent
      ? consentDecision(input.category ?? 'TRANSACTIONAL', {
          channelOptIn,
          transactionalOptIn: input.transactionalOptIn,
          systemOptIn: input.systemOptIn,
          automationOptIn: input.automationOptIn,
          marketingOptIn: input.marketingOptIn,
        })
      : { allowed: true };

    if (!decision.allowed) {
      status = 'SKIPPED_NO_CONSENT';
      error = decision.reason ?? 'Klient nie wyraził zgody na tę kategorię wiadomości.';
    } else {
      const channelProvider = input.channel === 'EMAIL' ? activeEmailProvider() : smsProvider;
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

  const values = {
      organizationId: input.organizationId,
      channel: input.channel,
      direction: 'OUTBOUND' as const,
      status,
      templateKey: input.templateKey ?? null,
      subject,
      body,
      toAddress: input.to,
      fromAddress: input.channel === 'EMAIL' ? emailFromAddress() : null,
      idempotencyKey: input.idempotencyKey ?? null,
      provider,
      providerMessageId,
      error,
      sentAt: status === 'SENT' ? new Date() : null,
      customerId: input.customerId ?? null,
      quoteId: input.quoteId ?? null,
      jobId: input.jobId ?? null,
      invoiceId: input.invoiceId ?? null,
    userId: input.userId ?? null,
  };

  // Wyścig: dwa procesy mogły sprawdzić klucz w tym samym momencie.
  // Wtedy unikalny indeks zgłosi błąd — zwracamy istniejący rekord zamiast duplikatu.
  try {
    const [row] = await db.insert(communications).values(values).returning();
    return { communication: row, delivered: status === 'SENT', reason: error ?? undefined };
  } catch (insertError) {
    if (input.idempotencyKey && isUniqueViolation(insertError)) {
      const [existing] = await db
        .select()
        .from(communications)
        .where(and(eq(communications.organizationId, input.organizationId), eq(communications.idempotencyKey, input.idempotencyKey)))
        .limit(1);
      if (existing) {
        return {
          communication: existing,
          delivered: existing.status === 'SENT' || existing.status === 'DELIVERED',
          reason: existing.error ?? undefined,
          deduplicated: true,
        };
      }
    }
    throw insertError;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === '23505';
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

export { emailProvider, smsProvider, activeEmailProvider };
export { DEFAULT_TEMPLATES } from './templates';
