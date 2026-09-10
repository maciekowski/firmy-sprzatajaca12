/**
 * Wysyłka e-mail przez SMTP (nodemailer).
 * Gdy brak konfiguracji SMTP — provider zgłasza NO_PROVIDER (brak udawanej wysyłki).
 */
import type { ChannelProvider, SendInput, SendResult } from './providers';
import { isValidEmail } from './providers';

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

  // nodemailer ładujemy leniwie — dzięki temu brak konfiguracji nie wymaga połączenia
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

export const emailProvider: ChannelProvider = {
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
      return { ok: true, providerMessageId: info?.messageId };
    } catch (error) {
      return {
        ok: false,
        reason: 'FAILED',
        error: error instanceof Error ? error.message : 'Nieznany błąd wysyłki e-mail.',
      };
    }
  },
};
