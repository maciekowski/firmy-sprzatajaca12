import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { sessions, users, type User } from '@/lib/db/schema';
import { hashToken } from './tokens';

export const SESSION_COOKIE = 'sf_session';
export const ORG_COOKIE = 'sf_org';

const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** Sesja oczekująca na drugi składnik: 10 minut (nie 30 dni). */
export const PENDING_2FA_MINUTES = 10;
const PENDING_2FA_MS = PENDING_2FA_MINUTES * 60 * 1000;

/**
 * Czas wygaśnięcia sesji. Sesja przed podaniem kodu TOTP żyje krótko —
 * to jeszcze nie jest zalogowany użytkownik, a przedłużanie jej byłoby luką.
 */
export function sessionExpiresAt(awaiting2fa: boolean, now: Date = new Date()): Date {
  return new Date(now.getTime() + (awaiting2fa ? PENDING_2FA_MS : SESSION_MS));
}

export type SessionUser = User;

/**
 * Tworzy sesję: losowy token trafia do ciasteczka, w bazie zostaje tylko jego skrót.
 * Dzięki temu wyciek bazy nie pozwala przejąć aktywnych sesji.
 */
/**
 * Tworzy sesję. `awaiting2fa = true` oznacza sesję po poprawnym haśle,
 * ale przed podaniem kodu TOTP — taka sesja NIE ma dostępu do danych firmy.
 */
export async function createSession(
  userId: string,
  ip?: string | null,
  userAgent?: string | null,
  options: { awaiting2fa?: boolean } = {},
): Promise<string> {
  const awaiting2fa = options.awaiting2fa ?? false;
  // Sesja przed podaniem kodu TOTP żyje krótko — to nie jest jeszcze zalogowany użytkownik.
  const ttlMs = (awaiting2fa ? PENDING_2FA_MS : SESSION_MS);

  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = sessionExpiresAt(awaiting2fa);

  await db.insert(sessions).values({
    tokenHash,
    userId,
    expiresAt,
    ip: ip ?? null,
    userAgent: userAgent ?? null,
    awaiting2fa,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(ttlMs / 1000),
  });

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));

  return token;
}

/** Wylogowanie: usuwamy sesję z bazy i czyścimy ciasteczko. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/** Usuwa wszystkie sesje użytkownika (np. po zmianie hasła). */
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserBySessionToken(token);
}

export async function getUserBySessionToken(token: string): Promise<SessionUser | null> {
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
        // sesja przed potwierdzeniem TOTP nie daje dostępu do danych
        eq(sessions.awaiting2fa, false),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  // odświeżenie „ostatniego użycia” najwyżej raz na 5 minut (bez zbędnych write’ów)
  const sessionRow = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).limit(1);
  const session = sessionRow[0];
  if (session && Date.now() - session.lastUsedAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.id, session.id));
  }

  return rows[0].user;
}

export async function setActiveOrganizationCookie(organizationId: string): Promise<void> {
  const store = await cookies();
  store.set(ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  });
}

export async function getActiveOrganizationId(): Promise<string | null> {
  const store = await cookies();
  return store.get(ORG_COOKIE)?.value ?? null;
}

/**
 * Zwraca użytkownika sesji, która czeka na drugi składnik (po hassłe, przed kodem).
 * Używane wyłącznie przez stronę weryfikacji TOTP.
 */
export async function getPending2faUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
        eq(sessions.awaiting2fa, true),
      ),
    )
    .limit(1);

  return rows[0]?.user ?? null;
}

/** Potwierdzenie drugiego składnika — sesja odzyskuje pełny dostęp. */
export async function confirmSession2fa(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return;

  await db
    .update(sessions)
    .set({ awaiting2fa: false })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}
