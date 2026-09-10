'use server';

import { revalidatePath } from 'next/cache';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/guards';
import { hashPassword, validatePasswordStrength, verifyPassword } from '@/lib/auth/password';
import { db } from '@/lib/db/client';
import { sessions, users } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';

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
