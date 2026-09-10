/**
 * Resend — prawdziwy provider e-mail (specyfikacja: ServiceFlow → Resend API → klient).
 *
 * Zasady:
 *  - klucz API jest wyłącznie po stronie serwera (nigdy w kodzie klienta),
 *  - brak klucza = status NO_PROVIDER (NIE udajemy wysyłki),
 *  - potwierdzenie z API oznacza status SENT („API przyjęło”), a nie DELIVERED —
 *    dostarczenie potwierdza dopiero webhook.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ChannelProvider, SendInput, SendResult } from './providers';
import { isValidEmail } from './providers';

const RESEND_API = 'https://api.resend.com/emails';
const TIMEOUT_MS = 15_000;

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 0);
}

export function resendFrom(): string {
  return process.env.MAIL_FROM || 'ServiceFlow <onboarding@resend.dev>';
}

export const resendProvider: ChannelProvider = {
  name: 'resend',
  isConfigured: isResendConfigured,
  async send(input: SendInput): Promise<SendResult> {
    if (!isValidEmail(input.to)) {
      return { ok: false, reason: 'INVALID_RECIPIENT', error: 'Nieprawidłowy adres e-mail odbiorcy.' };
    }
    if (!isResendConfigured()) {
      return { ok: false, reason: 'NO_PROVIDER', error: 'Brak konfiguracji Resend (RESEND_API_KEY) — wiadomość nie została wysłana.' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(RESEND_API, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.RESEND_API_KEY as string}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: resendFrom(),
          to: [input.to],
          subject: input.subject ?? 'Wiadomość z ServiceFlow',
          text: input.body,
          html: input.html ?? undefined,
          reply_to: input.replyTo ?? undefined,
        }),
        signal: controller.signal,
      });

      const payloadText = await response.text();
      let payload: { id?: string; message?: string; name?: string; error?: string } = {};
      try {
        payload = payloadText ? JSON.parse(payloadText) : {};
      } catch {
        payload = { message: payloadText.slice(0, 300) };
      }

      if (!response.ok) {
        return {
          ok: false,
          reason: 'FAILED',
          error: `Resend ${response.status}: ${payload.message ?? payload.error ?? payload.name ?? 'błąd wysyłki'}`,
        };
      }

      return { ok: true, providerMessageId: payload.id ?? undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'nieznany błąd';
      const isTimeout = message.toLowerCase().includes('abort');
      return {
        ok: false,
        reason: 'FAILED',
        error: isTimeout ? `Resend: przekroczono czas oczekiwania (${TIMEOUT_MS / 1000}s).` : `Resend: ${message}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

/** Weryfikacja podpisu webhooka Resend (standard Svix). */
export function verifyResendSignature(input: {
  payload: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  secret: string | undefined;
  toleranceSeconds?: number;
}): { valid: boolean; reason?: string } {
  const { payload, id, timestamp, signatureHeader, secret } = input;
  if (!secret) return { valid: false, reason: 'Brak RESEND_WEBHOOK_SECRET — webhook nie został zweryfikowany.' };
  if (!id || !timestamp || !signatureHeader) return { valid: false, reason: 'Brak nagłówków podpisu (svix-*).' };

  const tolerance = input.toleranceSeconds ?? 300;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > tolerance) return { valid: false, reason: 'Podpis jest zbyt stary (timestamp poza tolerancją).' };

  const secretBytes = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const signedPayload = `${id}.${timestamp}.${payload}`;
  const expected = createHmac('sha256', secretBytes).update(signedPayload).digest();

  for (const candidate of signatureHeader.split(' ')) {
    const [, value] = candidate.split(',');
    if (!value) continue;
    const provided = Buffer.from(value, 'base64');
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return { valid: true };
    }
  }

  return { valid: false, reason: 'Podpis webhooka jest nieprawidłowy.' };
}
