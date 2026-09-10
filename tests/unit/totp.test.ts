import { describe, expect, it } from 'vitest';
import * as OTPAuth from 'otpauth';
import {
  TOTP_ISSUER,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  recoveryCodeMatches,
  totpUri,
  verifyTotpCode,
} from '@/lib/auth/totp';

function codeFor(secret: string, at: Date = new Date()): string {
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.generate({ timestamp: at.getTime() });
}

describe('uwierzytelnianie dwuskładnikowe (TOTP)', () => {
  it('poprawny kod z aplikacji przechodzi weryfikację', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(verifyTotpCode(secret, codeFor(secret))).toBe(true);
  });

  it('kod z poprzedniego okna (30 s) też przechodzi', () => {
    const secret = generateTotpSecret();
    const earlier = new Date(Date.now() - 30_000);
    expect(verifyTotpCode(secret, codeFor(secret, earlier))).toBe(true);
  });

  it('kod sprzed 5 minut zostaje odrzucony', () => {
    const secret = generateTotpSecret();
    const old = new Date(Date.now() - 5 * 60_000);
    expect(verifyTotpCode(secret, codeFor(secret, old))).toBe(false);
  });

  it('błędny i niepoprawny format są odrzucane', () => {
    const secret = generateTotpSecret();
    const valid = codeFor(secret);
    const wrong = String((Number(valid) + 1) % 1_000_000).padStart(6, '0');
    expect(verifyTotpCode(secret, wrong)).toBe(false);
    expect(verifyTotpCode(secret, 'abcdef')).toBe(false);
    expect(verifyTotpCode(secret, '')).toBe(false);
    expect(verifyTotpCode(secret, '12345')).toBe(false);
    expect(verifyTotpCode(secret, '1234567')).toBe(false);
  });

  it('URI do zeskanowania zawiera sekret i wystawcę', () => {
    const secret = generateTotpSecret();
    const uri = totpUri('jan@example.com', secret);
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain(encodeURIComponent(secret));
    expect(uri).toContain('ServiceFlow');
    expect(uri).toContain('digits=6');
  });

  it('kody zapasowe są losowe, unikalne i weryfikowane po skrócie', () => {
    const first = generateRecoveryCodes();
    const second = generateRecoveryCodes();

    expect(first.plain).toHaveLength(8);
    expect(new Set(first.plain).size).toBe(8);
    expect(first.plain.some((code) => second.plain.includes(code))).toBe(false);

    // w bazie lądują wyłącznie skróty
    expect(first.hashed.every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    expect(first.hashed).not.toContain(first.plain[0]);

    expect(recoveryCodeMatches(first.plain[0]!, first.hashed[0]!)).toBe(true);
    expect(recoveryCodeMatches(first.plain[0]!, first.hashed[1]!)).toBe(false);
    expect(recoveryCodeMatches('NIE-TEN-KOD', first.hashed[0]!)).toBe(false);
    // wielkość liter i spacje nie mają znaczenia
    expect(recoveryCodeMatches(` ${first.plain[0]!.toLowerCase()} `, first.hashed[0]!)).toBe(true);
  });

  it('skrót kodu jest stabilny i nieodwracalny', () => {
    const code = 'A1B2C3D4E5';
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(code)).not.toBe(code);
  });
});
