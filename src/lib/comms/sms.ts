/**
 * SMS — wysyłka tylko przez skonfigurowanego providera.
 *
 * Brak providera (SMS_PROVIDER) oznacza, że wiadomość NIE zostanie wysłana,
 * a system zapisze ją ze statusem SKIPPED_NO_PROVIDER.
 * Nie symulujemy wysyłki SMS.
 */
import type { ChannelProvider, SendInput, SendResult } from './providers';
import { isValidPhone } from './providers';

export function isSmsConfigured(): boolean {
  return Boolean(process.env.SMS_PROVIDER && process.env.SMS_API_KEY);
}

export const smsProvider: ChannelProvider = {
  name: process.env.SMS_PROVIDER || 'brak',
  isConfigured: isSmsConfigured,
  async send(input: SendInput): Promise<SendResult> {
    if (!isValidPhone(input.to)) {
      return { ok: false, reason: 'INVALID_RECIPIENT', error: 'Nieprawidłowy numer telefonu.' };
    }
    if (!isSmsConfigured()) {
      return { ok: false, reason: 'NO_PROVIDER', error: 'Brak skonfigurowanego providera SMS.' };
    }
    return {
      ok: false,
      reason: 'NO_PROVIDER',
      error: `Provider SMS "${process.env.SMS_PROVIDER}" nie posiada zaimplementowanej obsługi w tej wersji.`,
    };
  },
};
