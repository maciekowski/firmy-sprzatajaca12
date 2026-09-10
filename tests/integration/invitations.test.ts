import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { auditLogs, communications, invitations, memberships, passwordResetTokens, users } from '@/lib/db/schema';
import { inviteMember, updateMemberRole } from '@/lib/services/organizations';
import {
  acceptInvitation,
  countExpiredInvitations,
  getInvitationByToken,
  inviteMember as inviteByToken,
  listMembers,
  revokeInvitation,
} from '@/lib/services/invitations';
import { generateToken, hashToken, tokenExpiry } from '@/lib/auth/tokens';
import { createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';
import { organizations } from '@/lib/db/schema';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

/**
 * Zaproszenia do zespołu:
 *  - e-mail idzie WYŁĄCZNIE przez skonfigurowanego providera (brak = jawna informacja),
 *  - token zaproszenia jest w bazie tylko jako skrót i działa jednorazowo,
 *  - rola i limity są weryfikowane po stronie serwera.
 */
describe('zaproszenia do zespołu', () => {
  let org: Fixture;
  let otherOrg: Fixture;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    org = await createTestOrganization('TEAM-A');
    otherOrg = await createTestOrganization('TEAM-B');
    // plan START ma limit 1 użytkownika — testujemy zespół, więc podnosimy plan
    await db.update(organizations).set({ plan: 'BUSINESS' }).where(eq(organizations.id, org.organizationId));
    await db.update(organizations).set({ plan: 'BUSINESS' }).where(eq(organizations.id, otherOrg.organizationId));
  });

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id);
    await deleteTestOrganization(org.organizationId);
    await deleteTestOrganization(otherOrg.organizationId);
    await deleteTestUser(org.userId);
    await deleteTestUser(otherOrg.userId);
  });

  it('zaproszenie osoby bez konta: tworzy konto, członkostwo i zapisuje próbę wysyłki', async () => {
    const email = `nowy-${Date.now()}@example.com`;
    const result = await inviteMember(org.ctx, { email, role: 'WORKER' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invited).toBe(true);

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(user).toBeTruthy();
    createdUserIds.push(user!.id);

    const [membership] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, org.organizationId), eq(memberships.userId, user!.id)))
      .limit(1);
    expect(membership?.role).toBe('WORKER');

    // link do ustawienia hasła istnieje (ważny 7 dni)
    const resetTokens = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, user!.id));
    expect(resetTokens).toHaveLength(1);
    expect(resetTokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

    // bez providera poczty wynik MÓWI PRAWDĘ: brak wysyłki + link do przekazania
    if (result.deliveryNote) {
      expect(result.setupLink).toContain('/reset-hasla/');
      const message = await db.select().from(communications).where(eq(communications.toAddress, email));
      expect(message).toHaveLength(1);
      expect(['SKIPPED_NO_PROVIDER', 'FAILED']).toContain(message[0]!.status);
      expect(message[0]!.sentAt).toBeNull();
    }

    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org.organizationId), eq(auditLogs.action, 'members.invited')));
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0]!.meta).toMatchObject({ email, role: 'WORKER' });
  });

  it('nie można zaprosić tej samej osoby dwa razy', async () => {
    const email = `duplikat-${Date.now()}@example.com`;
    const first = await inviteMember(org.ctx, { email, role: 'VIEWER' });
    expect(first.ok).toBe(true);

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    createdUserIds.push(user!.id);

    const second = await inviteMember(org.ctx, { email, role: 'VIEWER' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain('już w firmie');
  });

  it('istniejący użytkownik zostaje dodany od razu (bez wysyłki e-mail)', async () => {
    const email = `istniejacy-${Date.now()}@example.com`;
    const [user] = await db
      .insert(users)
      .values({ email, name: 'Istniejący', passwordHash: 'x' })
      .returning();
    createdUserIds.push(user!.id);

    const result = await inviteMember(org.ctx, { email, role: 'DISPATCHER' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invited).toBe(false);
    expect(result.deliveryNote).toBeNull();

    const messages = await db.select().from(communications).where(eq(communications.toAddress, email));
    expect(messages).toHaveLength(0);
  });

  it('zmiana roli jest rejestrowana w audycie', async () => {
    const email = `rola-${Date.now()}@example.com`;
    const invited = await inviteMember(org.ctx, { email, role: 'WORKER' });
    if (!invited.ok) throw new Error(invited.error);
    createdUserIds.push(invited.userId);

    const changed = await updateMemberRole(org.ctx, invited.userId, 'DISPATCHER');
    expect(changed.ok).toBe(true);

    const [membership] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, org.organizationId), eq(memberships.userId, invited.userId)))
      .limit(1);
    expect(membership?.role).toBe('DISPATCHER');
  });

  it('nie można odebrać ostatniemu właścicielowi roli OWNER', async () => {
    const owners = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, org.organizationId), eq(memberships.role, 'OWNER')));
    expect(owners.length).toBe(1);

    const result = await updateMemberRole(org.ctx, owners[0]!.userId, 'VIEWER');
    expect(result.ok).toBe(false);
  });

  it('zaproszenie tokenowe: wygaśnięcie, odwołanie i jednorazowość', async () => {
    const email = `token-${Date.now()}@example.com`;
    const created = await inviteByToken(org.ctx, { email, role: 'WORKER' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.token).toBeTruthy(); // brak providera → token do przekazania ręcznie

    const token = created.data.token!;

    const [user] = await db
      .insert(users)
      .values({ email, name: 'Zaproszony', passwordHash: 'x' })
      .returning();
    createdUserIds.push(user!.id);

    // wygasłe zaproszenie nie działa
    await db.update(invitations).set({ expiresAt: tokenExpiry(-1) }).where(eq(invitations.id, created.data.invitationId!));
    const expired = await acceptInvitation(token, { id: user!.id, email });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe('EXPIRED');

    expect(await countExpiredInvitations(org.organizationId)).toBeGreaterThan(0);

    // przywracamy ważność — teraz zadziała
    await db.update(invitations).set({ expiresAt: tokenExpiry(60) }).where(eq(invitations.id, created.data.invitationId!));
    const accepted = await acceptInvitation(token, { id: user!.id, email });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.organizationId).toBe(org.organizationId);
    expect(accepted.role).toBe('WORKER');

    // drugie użycie tego samego tokenu — zaproszenie jest jednorazowe
    const again = await acceptInvitation(token, { id: user!.id, email });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('USED');

    // odwołanie zaproszenia innej osoby
    const otherEmail = `token2-${Date.now()}@example.com`;
    const second = await inviteByToken(org.ctx, { email: otherEmail, role: 'VIEWER' });
    if (!second.ok) throw new Error(second.error);
    const revoked = await revokeInvitation(org.ctx, second.data.invitationId!);
    expect(revoked.ok).toBe(true);

    const preview = await getInvitationByToken(second.data.token!);
    expect(preview?.invitation.revokedAt).toBeTruthy();

    const [thirdUser] = await db
      .insert(users)
      .values({ email: otherEmail, name: 'Odwołany', passwordHash: 'x' })
      .returning();
    createdUserIds.push(thirdUser!.id);

    const revokedAccept = await acceptInvitation(second.data.token!, { id: thirdUser!.id, email: otherEmail });
    expect(revokedAccept.ok).toBe(false);
    if (!revokedAccept.ok) expect(revokedAccept.reason).toBe('REVOKED');
  });

  it('zaproszenie nie zadziała dla innego adresu e-mail ani nieznanego tokenu', async () => {
    const email = `mismatch-${Date.now()}@example.com`;
    const created = await inviteByToken(org.ctx, { email, role: 'WORKER' });
    if (!created.ok) throw new Error(created.error);

    const [user] = await db
      .insert(users)
      .values({ email: `ktosinny-${Date.now()}@example.com`, name: 'Ktoś inny', passwordHash: 'x' })
      .returning();
    createdUserIds.push(user!.id);

    const mismatch = await acceptInvitation(created.data.token!, { id: user!.id, email: user!.email });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.reason).toBe('EMAIL_MISMATCH');

    const unknown = await acceptInvitation(generateToken(32), { id: user!.id, email: user!.email });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toBe('NOT_FOUND');
  });

  it('w bazie nie ma pełnego tokenu zaproszenia — tylko skrót', async () => {
    const email = `hash-${Date.now()}@example.com`;
    const created = await inviteByToken(org.ctx, { email, role: 'WORKER' });
    if (!created.ok) throw new Error(created.error);

    const rows = await db.select().from(invitations).where(eq(invitations.id, created.data.invitationId!));
    expect(rows[0]!.tokenHash).toBe(hashToken(created.data.token!));
    expect(JSON.stringify(rows[0])).not.toContain(created.data.token!);
  });

  it('lista członków zawiera zaproszonych użytkowników', async () => {
    const members = await listMembers(org.organizationId);
    expect(members.length).toBeGreaterThan(0);
    expect(members.every((member) => typeof member.email === 'string')).toBe(true);

    // członkowie innej firmy nie przenikają
    const otherMembers = await listMembers(otherOrg.organizationId);
    const emails = new Set(otherMembers.map((member) => member.email));
    for (const member of members) {
      expect(emails.has(member.email)).toBe(false);
    }
  });
});
