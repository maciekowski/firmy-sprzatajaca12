/**
 * Wysyłka e-mail.
 *
 * Kolejność providerów:
 *  1) Resend (gdy skonfigurowany RESEND_API_KEY) — zgodnie ze specyfikacją produktu,
 *  2) SMTP (nodemailer), gdy firma ma własny serwer poczty,
 *  3) brak providera → NO_PROVIDER (system NIE udaje wysyłki).
 */
import type { ChannelProvider, SendInput, SendResult } from './providers';
import { isValidEmail } from './providers';
import { isResendConfigured, resendFrom, resendProvider } from './resend';

type Transporter = {
  sendMail: (options: Record<string, unknown>) => Promise<{ messageId?: string }>;
};

let cachedTransporter: Transporter | null = null;

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_HOST.trim().length > 0);
}

function getTransporter(): Transporter | null {
  if (!isSmtpConfigured()) return null;
  if (cachedTransporter) return cachedTransporter;

  // nodemailer ładujemy leniwie — brak konfiguracji nie wymaga połączenia
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodemailer = require('nodemailer') as {
    createTransport: (options: Record<string, unknown>) => Transporter;
  };

  const port = Number(process.env.SMTP_PORT ?? 587);
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST as string,
    port,
    secure: String(process.env.SMTP_SECURE ?? 'false') === 'true' || port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER as string, pass: (process.env.SMTP_PASSWORD ?? '') as string }
      : undefined,
    pool: false,
  });

  return cachedTransporter;
}

const smtpProvider: ChannelProvider = {
  name: 'smtp',
  isConfigured: isSmtpConfigured,
  async send(input: SendInput): Promise<SendResult> {
    if (!isValidEmail(input.to)) {
      return { ok: false, reason: 'INVALID_RECIPIENT', error: 'Nieprawidłowy adres e-mail odbiorcy.' };
    }
    const transporter = getTransporter();
    if (!transporter) {
      return { ok: false, reason: 'NO_PROVIDER', error: 'Brak konfiguracji SMTP — wiadomość nie została wysłana.' };
    }
    try {
      const info = await transporter.sendMail({
        from: process.env.MAIL_FROM || 'ServiceFlow <no-reply@example.com>',
        to: input.to,
        subject: input.subject ?? 'Wiadomość z ServiceFlow',
        text: input.body,
        html: input.html ?? undefined,
        replyTo: input.replyTo ?? undefined,
      });
      return { ok: true, providerMessageId: info.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'nieznany błąd';
      return { ok: false, reason: 'FAILED', error: `SMTP: ${message}` };
    }
  },
};

/** Wybór aktywnego providera e-mail. */
export function activeEmailProvider(): ChannelProvider {
  if (isResendConfigured()) return resendProvider;
  if (isSmtpConfigured()) return smtpProvider;
  return {
    name: 'none',
    isConfigured: () => false,
    async send(): Promise<SendResult> {
      return { ok: false, reason: 'NO_PROVIDER', error: 'Brak konfiguracji poczty (Resend lub SMTP).' };
    },
  };
}

export const emailProvider: ChannelProvider = {
  name: 'email',
  isConfigured: () => activeEmailProvider().isConfigured(),
  send: (input: SendInput) => activeEmailProvider().send(input),
};

export function emailFromAddress(): string {
  return isResendConfigured() ? resendFrom() : (process.env.MAIL_FROM ?? null) ?? 'ServiceFlow <no-reply@example.com>';
}

export { smtpProvider, isResendConfigured };
