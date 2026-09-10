'use server';

import { revalidatePath } from 'next/cache';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/guards';
import { hashPassword, validatePasswordStrength, verifyPassword } from '@/lib/auth/password';
import { db } from '@/lib/db/client';
import { sessions, users } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';
import { generateRecoveryCodes, generateTotpSecret, recoveryCodeMatches, verifyTotpCode } from '@/lib/auth/totp';
import { rateLimit } from '@/lib/rate-limit';

export type AccountState = { ok: boolean; error?: string; message?: string };

export async function updateProfileAction(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const user = await requireUser('/ustawienia/konto');
  const name = String(formData.get('name') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();

  if (name.length < 2) return { ok: false, error: 'Podaj imię i nazwisko.' };

  await db.update(users).set({ name, phone: phone || null, updatedAt: new Date() }).where(eq(users.id, user.id));

  await writeAuditLog({
    userId: user.id,
    action: 'account.updated',
    entityType: 'user',
    entityId: user.id,
    meta: { name },
  });

  revalidatePath('/ustawienia/konto');
  return { ok: true, message: 'Dane zapisane.' };
}

export async function changePasswordAction(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const user = await requireUser('/ustawienia/konto');
  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const repeat = String(formData.get('repeatPassword') ?? '');

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const record = rows[0];
  if (!record) return { ok: false, error: 'Nie znaleziono użytkownika.' };

  const valid = await verifyPassword(current, record.passwordHash);
  if (!valid) return { ok: false, error: 'Aktualne hasło jest nieprawidłowe.' };

  if (next !== repeat) return { ok: false, error: 'Nowe hasła nie są identyczne.' };
  const strength = validatePasswordStrength(next);
  if (!strength.ok) return { ok: false, error: strength.message ?? 'Hasło jest za słabe.' };

  await db.update(users).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(users.id, user.id));

  await writeAuditLog({
    userId: user.id,
    action: 'account.password_changed',
    entityType: 'user',
    entityId: user.id,
  });

  return { ok: true, message: 'Hasło zmienione.' };
}

/** Wylogowanie ze wszystkich urządzeń (usunięcie sesji użytkownika). */
export async function revokeAllSessionsAction(): Promise<void> {
  const user = await requireUser('/ustawienia/konto');
  if (!user) return;
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await writeAuditLog({ userId: user.id, action: 'account.sessions_revoked', entityType: 'user', entityId: user.id });
  revalidatePath('/ustawienia/konto');
}

export async function revokeSessionAction(formData: FormData): Promise<void> {
  const user = await requireUser('/ustawienia/konto');
  if (!user) return;
  const sessionId = String(formData.get('sessionId') ?? '');
  // usunięcie tylko własnej sesji — bez możliwości ingerencji w cudze
  await db.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.userId, user.id)));
  revalidatePath('/ustawienia/konto');
}

export type TotpSetupState = {
  ok: boolean;
  error?: string;
  message?: string;
  /** krok 1: sekret do wpisania w aplikacji (QR generowany po stronie klienta z URI) */
  secret?: string;
  otpauthUri?: string;
  /** krok 2: kody zapasowe — pokazywane DOKŁADNIE RAZ, potem tylko ich skróty */
  recoveryCodes?: string[];
};

/** Krok 1: przygotowanie sekretu 2FA (jeszcze nieaktywnego). */
export async function startTotpSetupAction(_prev: TotpSetupState): Promise<TotpSetupState> {
  const user = await requireUser('/ustawienia/konto');
  if (user.totpSecret) return { ok: false, error: 'Dwuskładnikowe logowanie jest już włączone.' };

  const secret = generateTotpSecret();
  const totp = new (await import('otpauth')).TOTP({
    issuer: 'ServiceFlow',
    label: user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: (await import('otpauth')).Secret.fromBase32(secret),
  });

  return {
    ok: true,
    message: 'Zeskanuj kod QR w aplikacji (Google Authenticator, 1Password, Authy) i wpisz kod.',
    secret,
    otpauthUri: totp.toString(),
  };
}

/** Krok 2: potwierdzenie kodem i włączenie 2FA (wraz z generacją kodów zapasowych). */
export async function confirmTotpSetupAction(_prev: TotpSetupState, formData: FormData): Promise<TotpSetupState> {
  const user = await requireUser('/ustawienia/konto');
  if (user.totpSecret) return { ok: false, error: 'Dwuskładnikowe logowanie jest już włączone.' };

  const limit = rateLimit(`2fa-setup:${user.id}`, 10, 5 * 60_000);
  if (!limit.allowed) return { ok: false, error: `Zbyt wiele prób. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` };

  const secret = String(formData.get('secret') ?? '');
  const code = String(formData.get('code') ?? '').trim();
  if (!secret || !code) return { ok: false, error: 'Brak sekretu lub kodu — powtórz konfigurację.' };

  if (!verifyTotpCode(secret, code)) {
    await writeAuditLog({ userId: user.id, action: 'user.2fa_setup_failed' });
    return { ok: false, error: 'Nieprawidłowy kod. Upewnij się, że zegar telefonu jest zsynchronizowany.' };
  }

  const { plain, hashed } = generateRecoveryCodes();
  await db
    .update(users)
    .set({
      totpSecret: secret,
      totpEnabledAt: new Date(),
      recoveryCodeHashes: hashed,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await writeAuditLog({ userId: user.id, action: 'user.2fa_enabled', meta: { recoveryCodes: hashed.length } });
  revalidatePath('/ustawienia/konto');

  return {
    ok: true,
    message: 'Dwuskładnikowe logowanie jest włączone. Zapisz kody zapasowe — pokazujemy je tylko raz.',
    recoveryCodes: plain,
  };
}

/** Wyłączenie 2FA — wymaga hasła i aktualnego kodu. */
export async function disableTotpAction(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const user = await requireUser('/ustawienia/konto');
  if (!user.totpSecret) return { ok: false, error: 'Dwuskładnikowe logowanie nie jest włączone.' };

  const limit = rateLimit(`2fa-disable:${user.id}`, 5, 5 * 60_000);
  if (!limit.allowed) return { ok: false, error: `Zbyt wiele prób. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` };

  const password = String(formData.get('password') ?? '');
  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, error: 'Nieprawidłowe hasło.' };
  }

  const code = String(formData.get('code') ?? '').trim();
  const codes = user.recoveryCodeHashes ?? [];
  const byRecovery = codes.some((hash) => recoveryCodeMatches(code, hash));
  if (!verifyTotpCode(user.totpSecret, code) && !byRecovery) {
    await writeAuditLog({ userId: user.id, action: 'user.2fa_disable_failed' });
    return { ok: false, error: 'Nieprawidłowy kod.' };
  }

  await db
    .update(users)
    .set({ totpSecret: null, totpEnabledAt: null, recoveryCodeHashes: [], updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await writeAuditLog({ userId: user.id, action: 'user.2fa_disabled' });
  revalidatePath('/ustawienia/konto');

  return { ok: true, message: 'Dwuskładnikowe logowanie zostało wyłączone.' };
}

/** Wygenerowanie nowego kompletu kodów zapasowych (unieważnia poprzednie). */
export async function regenerateRecoveryCodesAction(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const user = await requireUser('/ustawienia/konto');
  if (!user.totpSecret) return { ok: false, error: 'Najpierw włącz dwuskładnikowe logowanie.' };

  const code = String(formData.get('code') ?? '').trim();
  if (!verifyTotpCode(user.totpSecret, code)) return { ok: false, error: 'Nieprawidłowy kod.' };

  const { plain, hashed } = generateRecoveryCodes();
  await db.update(users).set({ recoveryCodeHashes: hashed, updatedAt: new Date() }).where(eq(users.id, user.id));

  await writeAuditLog({ userId: user.id, action: 'user.2fa_recovery_regenerated' });
  revalidatePath('/ustawienia/konto');

  return {
    ok: true,
    message: `Nowe kody zapasowe (poprzednie nie działają): ${plain.join(', ')}`,
  };
}
