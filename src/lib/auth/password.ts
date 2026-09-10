/**
 * Hasła — scrypt (wbudowany moduł crypto), sól per hasło, porównanie w czasie stałym.
 * Nigdy nie logujemy hasła ani jego skrótu.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, saltPart, hashPart] = stored.split('$');
    if (scheme !== 'scrypt' || !saltPart || !hashPart) return false;
    const salt = Buffer.from(saltPart, 'base64url');
    const expected = Buffer.from(hashPart, 'base64url');
    const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Walidacja siły hasła na poziomie domeny (reguły dla użytkownika końcowego). */
export function validatePasswordStrength(password: string): { ok: boolean; message?: string } {
  if (typeof password !== 'string' || password.length < 10) {
    return { ok: false, message: 'Hasło musi mieć co najmniej 10 znaków.' };
  }
  if (password.length > 200) {
    return { ok: false, message: 'Hasło jest zbyt długie.' };
  }
  if (!/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(password) || !/\d/.test(password)) {
    return { ok: false, message: 'Hasło musi zawierać litery i cyfry.' };
  }
  return { ok: true };
}
