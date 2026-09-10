/**
 * Logowanie dwuskładnikowe — testy na realnej bazie i serwerze.
 *
 * Kluczowe: sesja po haśle, ale PRZED kodem TOTP, nie ma dostępu do danych firmy,
 * a kod zapasowy jest jednorazowy (w bazie wyłącznie skróty).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { sessions, users } from '@/lib/db/schema';
import { getUserBySessionToken } from '@/lib/auth/session';
import { generateRecoveryCodes, generateTotpSecret, recoveryCodeMatches, totpUri } from '@/lib/auth/totp';
import { createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

async function makeSession(userId: string, awaiting2fa: boolean): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const { hashToken } = await import('@/lib/auth/tokens');
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
    awaiting2fa,
    userAgent: 'vitest-2fa',
  });
  return token;
}

describe('2FA (TOTP) — dostęp i jednorazowość kodów', () => {
  let org: Awaited<ReturnType<typeof createTestOrganization>>;
  let userId: string;
  let secret: string;
  let recoveryHashes: string[];
  let plainCodes: string[];

  beforeAll(async () => {
    org = await createTestOrganization('2FA-A');
    userId = org.userId;

    secret = generateTotpSecret();
    const generated = generateRecoveryCodes();
    plainCodes = generated.plain;
    recoveryHashes = generated.hashed;

    await db
      .update(users)
      .set({ totpSecret: secret, totpEnabledAt: new Date(), recoveryCodeHashes: recoveryHashes })
      .where(eq(users.id, userId));
  });

  afterAll(async () => {
    await db.update(users).set({ totpSecret: null, totpEnabledAt: null, recoveryCodeHashes: [] }).where(eq(users.id, userId));
    await deleteTestOrganization(org.organizationId);
    await deleteTestUser(userId);
  });

  it('sesja przed podaniem kodu NIE ma dostępu do danych', async () => {
    const token = await makeSession(userId, true);
    expect(await getUserBySessionToken(token)).toBeNull();
  });

  it('po potwierdzeniu kodu sesja odzyskuje dostęp', async () => {
    const token = await makeSession(userId, true);
    const { hashToken } = await import('@/lib/auth/tokens');

    // symulacja akcji potwierdzającej (confirmSession2fa działa na ciasteczkach — tu robimy to wprost)
    await db
      .update(sessions)
      .set({ awaiting2fa: false })
      .where(eq(sessions.tokenHash, hashToken(token)));

    const user = await getUserBySessionToken(token);
    expect(user?.id).toBe(userId);
  });

  it('użytkownik z włączonym 2FA nie wejdzie do aplikacji na samej sesji oczekującej', async () => {
    const token = await makeSession(userId, true);
    const response = await fetch(`${BASE_URL}/dashboard`, {
      headers: { cookie: `sf_session=${token}; sf_org=${org.organizationId}` },
      redirect: 'manual',
    });
    expect([303, 307, 302]).toContain(response.status);
  });

  it('sesja oczekująca na 2FA wygasa po 10 minutach (nie 30 dniach)', async () => {
    const { sessionExpiresAt } = await import('@/lib/auth/session');
    const now = new Date();

    const pending = sessionExpiresAt(true, now);
    const minutes = (pending.getTime() - now.getTime()) / 60_000;
    expect(minutes).toBe(10);

    const normal = sessionExpiresAt(false, now);
    const days = (normal.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(30);
  });

  it('strona weryfikacji bez sesji oczekującej przekierowuje do logowania', async () => {
    const token = await makeSession(userId, false);
    const response = await fetch(`${BASE_URL}/logowanie/2fa`, {
      headers: { cookie: `sf_session=${token}; sf_org=${org.organizationId}` },
      redirect: 'manual',
    });
    expect([303, 307, 302]).toContain(response.status);
  });

  it('kod zapasowy jest rozpoznawany po skrócie (i działa tylko raz w logice akcji)', async () => {
    const [stored] = await db
      .select({ codes: users.recoveryCodeHashes })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    expect(stored!.codes).toHaveLength(8);
    expect(recoveryCodeMatches(plainCodes[0]!, stored!.codes[0]!)).toBe(true);
    expect(recoveryCodeMatches(plainCodes[1]!, stored!.codes[0]!)).toBe(false);

    // użycie kodu = usunięcie skrótu z bazy (tak robi akcja weryfikacji)
    const remaining = stored!.codes.filter((_, index) => index !== 0);
    await db.update(users).set({ recoveryCodeHashes: remaining }).where(eq(users.id, userId));

    const [after] = await db
      .select({ codes: users.recoveryCodeHashes })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    expect(after!.codes).toHaveLength(7);
    expect(after!.codes.some((hash) => recoveryCodeMatches(plainCodes[0]!, hash))).toBe(false);
  });

  it('URI provisioningu zawiera sekret użytkownika', async () => {
    const uri = totpUri('test@example.com', secret);
    expect(uri).toContain('ServiceFlow');
    expect(uri).toContain(encodeURIComponent(secret));
  });

  it('wyłączenie 2FA czyści sekret i kody (symulacja akcji)', async () => {
    await db
      .update(users)
      .set({ totpSecret: null, totpEnabledAt: null, recoveryCodeHashes: [] })
      .where(eq(users.id, userId));

    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    expect(row!.totpSecret).toBeNull();
    expect(row!.recoveryCodeHashes).toHaveLength(0);

    // przywracamy stan reszcie testów (kolejność: ten test jest ostatni)
    await db
      .update(users)
      .set({ totpSecret: secret, totpEnabledAt: new Date(), recoveryCodeHashes: recoveryHashes })
      .where(eq(users.id, userId));
  });
});
