/**
 * Providerzy komunikacji.
 *
 * ZASADA: system nigdy nie udaje wysyłki.
 * Jeżeli provider nie jest skonfigurowany, wiadomość zostaje zapisana
 * ze statusem SKIPPED_NO_PROVIDER i jest to widoczne w interfejsie.
 */

export type SendInput = {
  to: string;
  subject?: string | null;
  body: string;
  /** treść HTML (opcjonalnie, tylko dla e-maili) */
  html?: string | null;
  replyTo?: string | null;
};

export type SendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; reason: 'NO_PROVIDER' | 'FAILED' | 'INVALID_RECIPIENT'; error: string };

export interface ChannelProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(input: SendInput): Promise<SendResult>;
}

export function isValidEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  const email = value.trim();
  // rozsądna walidacja adresu — bez przesadnych regexów
  return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email) && email.length <= 254;
}

export function isValidPhone(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = value.replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}
