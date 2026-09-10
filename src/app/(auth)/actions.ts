'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { organizations, memberships, passwordResetTokens, users } from '@/lib/db/schema';
import { hashPassword, validatePasswordStrength, verifyPassword } from '@/lib/auth/password';
import { recoveryCodeMatches, verifyTotpCode } from '@/lib/auth/totp';
import { confirmSession2fa, createSession, destroySession, getPending2faUser } from '@/lib/auth/session';
import { generateToken, hashToken, tokenExpiry } from '@/lib/auth/tokens';
import { authKey, rateLimit, resetRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit';
import { emailProvider } from '@/lib/comms/email';
import { seedDefaultAutomations, seedMessageTemplates } from '@/lib/org-defaults';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, zodToFieldErrors, type FormState } from '@/lib/validation';
import { trialEndsAtFrom } from '@/lib/billing/subscription';

async function clientIp(): Promise<string> {
  const store = await headers();
  const forwarded = store.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return store.get('x-real-ip') ?? 'unknown';
}

function slugify(value: string): string {
  const map: Record<string, string> = {
    ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  };
  return value
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (char) => map[char] ?? char)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || 'firma';
  let candidate = root;
  let counter = 1;
  // maksymalnie 50 prób — potem dodajemy losowy sufiks
  while (counter <= 50) {
    const existing = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, candidate)).limit(1);
    if (existing.length === 0) return candidate;
    counter += 1;
    candidate = `${root}-${counter}`;
  }
  return `${root}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeNext(next: string | null): string | null {
  if (!next) return null;
  // tylko ścieżki wewnętrzne — ochrona przed otwartym przekierowaniem
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ip = await clientIp();
  const rawEmail = String(formData.get('email') ?? '').toLowerCase();

  const limit = rateLimit(authKey('register', rawEmail, ip), 5, 10 * 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Zbyt wiele prób rejestracji. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` };
  }

  const parsed = registerSchema.safeParse({
    name: formData.get('name'),
    email: rawEmail,
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
    companyName: formData.get('companyName'),
  });

  if (!parsed.success) {
    return { ok: false, error: 'Popraw dane w formularzu.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const strength = validatePasswordStrength(parsed.data.password);
  if (!strength.ok) {
    return { ok: false, error: strength.message, fieldErrors: { password: strength.message ?? '' } };
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (existing.length > 0) {
    return { ok: false, error: 'Konto z tym adresem e-mail już istnieje.', fieldErrors: { email: 'Ten adres jest już zajęty.' } };
  }

  const userAgent = (await headers()).get('user-agent');
  const passwordHash = await hashPassword(parsed.data.password);

  const [user] = await db
    .insert(users)
    .values({ email: parsed.data.email, name: parsed.data.name, passwordHash })
    .returning();

  const slug = await uniqueSlug(parsed.data.companyName);
  const [organization] = await db
    .insert(organizations)
    .values({
      name: parsed.data.companyName.trim(),
      slug,
      // Okres próbny ustala SERWER (10 dni) — frontend tego nie ustawia.
      subscriptionStatus: 'TRIALING',
      trialEndsAt: trialEndsAtFrom(),
    })
    .returning();

  await db.insert(memberships).values({ organizationId: organization.id, userId: user.id, role: 'OWNER' });
  await seedMessageTemplates(organization.id);
  await seedDefaultAutomations(organization.id);

  await writeAuditLog({
    organizationId: organization.id,
    userId: user.id,
    action: 'user.registered',
    entityType: 'organization',
    entityId: organization.id,
    ip,
    userAgent,
  });

  await createSession(user.id, ip, userAgent);
  resetRateLimit(authKey('register', rawEmail, ip));
  redirect('/onboarding');
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ip = await clientIp();
  const rawEmail = String(formData.get('email') ?? '').toLowerCase();

  const limit = rateLimit(authKey('login', rawEmail, ip), 10, 5 * 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Zbyt wiele prób logowania. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` };
  }

  const parsed = loginSchema.safeParse({ email: rawEmail, password: formData.get('password') });
  if (!parsed.success) {
    return { ok: false, error: 'Podaj poprawny e-mail i hasło.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const rows = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const user = rows[0];

  // stały czas odpowiedzi niezależnie od istnienia konta (chroni przed enumeracją)
  const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;

  if (!user || !valid) {
    await writeAuditLog({
      userId: user?.id ?? null,
      action: 'user.login_failed',
      ip,
      userAgent: (await headers()).get('user-agent'),
      meta: { email: rawEmail },
    });
    return { ok: false, error: 'Nieprawidłowy e-mail lub hasło.' };
  }

  const userAgent = (await headers()).get('user-agent');
  const next = safeNext(formData.get('next') ? String(formData.get('next')) : null);

  // Konto z włączonym 2FA: najpierw sesja „oczekująca” — bez dostępu do danych firmy.
  if (user.totpSecret) {
    await createSession(user.id, ip, userAgent, { awaiting2fa: true });

    await writeAuditLog({
      userId: user.id,
      action: 'user.login_2fa_required',
      ip,
      userAgent,
    });

    redirect(next ? `/logowanie/2fa?next=${encodeURIComponent(next)}` : '/logowanie/2fa');
  }

  await createSession(user.id, ip, userAgent);
  resetRateLimit(authKey('login', rawEmail, ip));

  await writeAuditLog({ userId: user.id, action: 'user.login', ip, userAgent });

  redirect(next ?? '/dashboard');
}

export type TotpState = { ok: boolean; error?: string };

/**
 * Weryfikacja drugiego składnika (kod z aplikacji lub kod zapasowy).
 * Kod zapasowy działa jednorazowo — po użyciu jest usuwany z bazy.
 */
export async function verifyTotpAction(_prev: TotpState, formData: FormData): Promise<TotpState> {
  const ip = await clientIp();
  const pending = await getPending2faUser();
  if (!pending) return { ok: false, error: 'Sesja wygasła. Zaloguj się ponownie.' };

  const limit = rateLimit(authKey('2fa', pending.id, ip), 10, 5 * 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Zbyt wiele prób. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` };
  }

  const raw = String(formData.get('code') ?? '').trim();
  if (!raw) return { ok: false, error: 'Podaj kod z aplikacji uwierzytelniającej.' };

  const userAgent = (await headers()).get('user-agent');
  let accepted = false;

  if (pending.totpSecret && /^\d{6}$/.test(raw)) {
    accepted = verifyTotpCode(pending.totpSecret, raw);
  }

  // kod zapasowy (jednorazowy) — akceptujemy tylko, gdy nie zadziałał kod TOTP
  if (!accepted && pending.recoveryCodeHashes.length > 0) {
    const index = pending.recoveryCodeHashes.findIndex((hash) => recoveryCodeMatches(raw, hash));
    if (index >= 0) {
      const remaining = pending.recoveryCodeHashes.filter((_, position) => position !== index);
      await db.update(users).set({ recoveryCodeHashes: remaining, updatedAt: new Date() }).where(eq(users.id, pending.id));
      accepted = true;

      await writeAuditLog({
        userId: pending.id,
        action: 'user.login_2fa_recovery_used',
        ip,
        userAgent,
        meta: { remaining: remaining.length },
      });
    }
  }

  if (!accepted) {
    await writeAuditLog({ userId: pending.id, action: 'user.login_2fa_failed', ip, userAgent });
    return { ok: false, error: 'Nieprawidłowy kod. Spróbuj ponownie.' };
  }

  await confirmSession2fa();
  resetRateLimit(authKey('2fa', pending.id, ip));
  await writeAuditLog({ userId: pending.id, action: 'user.login_2fa_success', ip, userAgent });

  const next = safeNext(formData.get('next') ? String(formData.get('next')) : null);
  redirect(next ?? '/dashboard');
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect('/logowanie');
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ip = await clientIp();
  const forgotEmail = String(formData.get('email') ?? '').toLowerCase();

  const forgotLimit = rateLimit(authKey('forgot', forgotEmail, ip), 5, 10 * 60_000);
  if (!forgotLimit.allowed) {
    return { ok: false, error: `Zbyt wiele prób odzyskiwania hasła. Spróbuj ponownie za ${forgotLimit.retryAfterSeconds} s.` };
  }

  const rawEmail = String(formData.get('email') ?? '').toLowerCase();

  const limit = rateLimit(authKey('forgot', rawEmail, ip), 5, 10 * 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Zbyt wiele prób. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` };
  }

  const parsed = forgotPasswordSchema.safeParse({ email: rawEmail });
  if (!parsed.success) {
    return { ok: false, error: 'Podaj poprawny adres e-mail.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const rows = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const user = rows[0];

  // nie zdradzamy, czy konto istnieje
  const genericMessage = 'Jeżeli konto o tym adresie istnieje, wysłaliśmy link do zmiany hasła.';

  if (user) {
    const token = generateToken(32);
    await db.insert(passwordResetTokens).values({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: tokenExpiry(60),
      ip,
    });
    await writeAuditLog({ userId: user.id, action: 'user.password_reset_requested', ip });

    const resetUrl = `${process.env.APP_URL ?? 'http://localhost:3000'}/reset-hasla/${token}`;
    const result = await emailProvider.send({
      to: user.email,
      subject: 'Zmiana hasła w ServiceFlow',
      body: `Otrzymaliśmy prośbę o zmianę hasła.\n\nAby ustawić nowe hasło, otwórz ten link (ważny 60 minut):\n${resetUrl}\n\nJeżeli to nie Ty, zignoruj tę wiadomość.`,
    });

    if (!result.ok && result.reason === 'NO_PROVIDER') {
      // Brak providera = komunikat musi być prawdziwy: informujemy, że mail nie wyszedł.
      return {
        ok: false,
        error:
          'Nie skonfigurowano wysyłki e-mail (SMTP), więc link nie został wysłany. W trybie developerskim link jest widoczny poniżej — w produkcji skonfiguruj SMTP.',
        message:
          process.env.NODE_ENV === 'production'
            ? undefined
            : `Link developerski: ${resetUrl}`,
      };
    }
    if (!result.ok) {
      return { ok: false, error: `Nie udało się wysłać wiadomości: ${result.error}` };
    }
  }

  return { ok: true, message: genericMessage };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ip = await clientIp();

  const resetLimit = rateLimit(authKey('reset', String(formData.get('token') ?? ''), ip), 10, 10 * 60_000);
  if (!resetLimit.allowed) {
    return { ok: false, error: `Zbyt wiele prób ustawienia hasła. Spróbuj ponownie za ${resetLimit.retryAfterSeconds} s.` };
  }

  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return { ok: false, error: 'Popraw dane w formularzu.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const strength = validatePasswordStrength(parsed.data.password);
  if (!strength.ok) {
    return { ok: false, error: strength.message, fieldErrors: { password: strength.message ?? '' } };
  }

  const tokenHash = hashToken(parsed.data.token);
  const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).limit(1);
  const record = rows[0];

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { ok: false, error: 'Link do zmiany hasła jest nieprawidłowy lub wygasł.' };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, record.userId));
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, record.id));

  // wszystkie aktywne sesje tracą ważność po zmianie hasła
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, record.userId));
  await writeAuditLog({ userId: record.userId, action: 'user.password_reset_completed', ip });

  return { ok: true, message: 'Hasło zostało zmienione. Możesz się zalogować.' };
}
