/** Tokeny jednorazowe (reset hasła, zaproszenia, linki publiczne). */
import { createHash, randomBytes } from 'node:crypto';

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** W bazie zapisujemy wyłącznie skrót tokenu — wyciek bazy nie ujawnia aktywnych tokenów. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenExpiry(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}
