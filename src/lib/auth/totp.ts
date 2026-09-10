/**
 * Uwierzytelnianie dwuskładnikowe (TOTP, RFC 6238).
 *
 * Zasady:
 *  - sekret jest losowany kryptograficznie i przechowywany w bazie (wymagane szyfrowanie
 *    at-rest na poziomie bazy/dysku — tak jak hasła nie leży nigdzie w logach),
 *  - weryfikacja akceptuje jedno okno czasowe wstecz/dalej (zegary telefonów się rozjeżdżają),
 *  - kody zapasowe są przechowywane WYŁĄCZNIE jako skróty SHA-256 i działają jednorazowo,
 *  - brak konfiguracji = funkcja wyłączona (system nie udaje, że konto jest chronione).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as OTPAuth from 'otpauth';

export const TOTP_ISSUER = 'ServiceFlow';
export const RECOVERY_CODE_COUNT = 8;

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpUri(email: string, secret: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.toString();
}

/** Weryfikacja kodu z tolerancją ±1 okna (30 s). Zwraca też delta okien. */
export function verifyTotpCode(secret: string, code: string, window = 1): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  return totp.validate({ token: normalized, window }) !== null;
}

export function generateRecoveryCodes(): { plain: string[]; hashed: string[] } {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomBytes(5).toString('hex').toUpperCase());
  return { plain, hashed: plain.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/** Porównanie w czasie niezależnym od treści (zabezpieczenie przed atakiem czasowym). */
export function recoveryCodeMatches(provided: string, storedHash: string): boolean {
  const a = Buffer.from(hashRecoveryCode(provided), 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
