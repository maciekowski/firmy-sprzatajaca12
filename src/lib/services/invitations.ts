/**
 * Zaproszenia do organizacji.
 *
 * Zasady:
 *  - token zaproszenia jest w bazie WYŁĄCZNIE jako skrót (SHA-256),
 *  - zaproszenie wygasa, można je odwołać i wykorzystać tylko raz,
 *  - zaproszenie e-mail idzie przez realnego providera — bez konfiguracji
 *    zapisujemy status SKIPPED_NO_PROVIDER i zwracamy jawną informację
 *    (link do ręcznego przekazania zaproszonej osobie),
 *  - decyzję o roli i limicie użytkowników podejmuje serwer (plan).
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { invitations, memberships, organizations, users, type Invitation } from '@/lib/db/schema';
import { generateToken, hashToken, tokenExpiry } from '@/lib/auth/tokens';
import { writeAuditLog } from '@/lib/audit';
import { sendCommunication } from '@/lib/comms/service';
import { checkPlanLimit } from '@/lib/billing/plans';

export type ServiceContext = { organizationId: string; userId: string; userName?: string | null };
export type OperationResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const INVITE_ROLES = ['ADMIN', 'DISPATCHER', 'WORKER', 'VIEWER'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

const INVITE_TTL_MINUTES = 60 * 24 * 14; // 14 dni

export type InvitationWithOrg = {
  invitation: Invitation;
  organizationName: string;
};

export type MemberRow = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  jobTitle: string | null;
  createdAt: Date;
};

export async function listMembers(organizationId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      membershipId: memberships.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      isActive: memberships.isActive,
      jobTitle: memberships.jobTitle,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(desc(memberships.createdAt));

  return rows;
}

export async function listPendingInvitations(organizationId: string) {
  return db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .orderBy(desc(invitations.createdAt));
}

/** Podgląd zaproszenia po tokenie — dla strony akceptacji (dane publiczne). */
export async function getInvitationByToken(token: string): Promise<InvitationWithOrg | null> {
  const rows = await db
    .select({ invitation: invitations, organizationName: organizations.name })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);

  return rows[0] ?? null;
}

export type InviteResult = {
  /** utworzone zaproszenie (gdy osoba nie ma jeszcze konta) */
  invitationId: string | null;
  /** pełen token — zwracany WYŁĄCZNIE raz, do przekazania zaproszonej osobie */
  token: string | null;
  /** true, gdy użytkownik już istniał i został od razu dodany do organizacji */
  addedDirectly: boolean;
  /** powód, dla którego wiadomość nie została wysłana (brak providera / brak zgody) */
  deliveryNote: string | null;
};

export async function inviteMember(
  ctx: ServiceContext,
  input: { email: string; role: InviteRole; message?: string | null },
): Promise<OperationResult<InviteResult>> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Podaj poprawny adres e-mail.' };
  }
  if (!INVITE_ROLES.includes(input.role)) {
    return { ok: false, error: 'Nieprawidłowa rola.' };
  }

  const [organization] = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  if (!organization) return { ok: false, error: 'Nie znaleziono organizacji.' };

  const members = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.organizationId, ctx.organizationId));
  const pending = await listPendingInvitations(ctx.organizationId);
  const limit = checkPlanLimit(organization.plan ?? 'START', 'users', members.length + pending.length);
  if (!limit.allowed) return { ok: false, error: limit.message ?? 'Przekroczono limit użytkowników w planie.' };

  const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Osoba ma już konto — dodajemy ją od razu, bez wysyłania zaproszenia.
  if (existingUser[0]) {
    const existingMembership = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, existingUser[0].id)))
      .limit(1);

    if (existingMembership[0]) {
      return { ok: false, error: 'Ta osoba jest już członkiem organizacji.' };
    }

    await db.insert(memberships).values({
      organizationId: ctx.organizationId,
      userId: existingUser[0].id,
      role: input.role,
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'member.added',
      entityType: 'user',
      entityId: existingUser[0].id,
      meta: { email, role: input.role, method: 'existing_user' },
    });

    return { ok: true, data: { invitationId: null, token: null, addedDirectly: true, deliveryNote: null } };
  }

  const pendingSame = pending.find((row) => row.email.toLowerCase() === email);
  if (pendingSame) {
    return { ok: false, error: 'Zaproszenie dla tego adresu już oczekuje. Odwołaj je, aby wysłać nowe.' };
  }

  const token = generateToken(32);
  const [invitation] = await db
    .insert(invitations)
    .values({
      organizationId: ctx.organizationId,
      email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedById: ctx.userId,
      expiresAt: tokenExpiry(INVITE_TTL_MINUTES),
    })
    .returning();

  const base = (process.env.APP_URL ?? '').replace(/\/$/, '');
  const link = `${base}/zaproszenie/${token}`;

  const result = await sendCommunication({
    organizationId: ctx.organizationId,
    channel: 'EMAIL',
    to: email,
    subject: `Zaproszenie do ${organization.name} — ServiceFlow`,
    body:
      input.message?.trim() ||
      `Dzień dobry,\n\n${ctx.userName ?? 'Administrator'} zaprasza Cię do organizacji ${organization.name} w ServiceFlow (rola: ${input.role}).\n\nLink aktywacyjny: ${link}\n\nLink jest ważny 14 dni i działa jednorazowo.\n\nZ poważaniem,\nZespół ${organization.name}`,
    userId: ctx.userId,
    category: 'SYSTEM',
    respectConsent: false, // zaproszenie nie jest komunikacją marketingową
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'member.invited',
    entityType: 'invitation',
    entityId: invitation!.id,
    meta: { email, role: input.role, delivered: result.delivered, reason: result.reason ?? null },
  });

  const deliveryNote = result.delivered ? null : (result.reason ?? 'Wiadomość nie została wysłana.');

  return {
    ok: true,
    data: { invitationId: invitation!.id, token: deliveryNote ? token : null, addedDirectly: false, deliveryNote },
  };
}

export async function revokeInvitation(ctx: ServiceContext, invitationId: string): Promise<OperationResult<null>> {
  const [updated] = await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitations.id, invitationId),
        eq(invitations.organizationId, ctx.organizationId),
        isNull(invitations.acceptedAt),
      ),
    )
    .returning();

  if (!updated) return { ok: false, error: 'Nie znaleziono aktywnego zaproszenia.' };

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'member.invite_revoked',
    entityType: 'invitation',
    entityId: invitationId,
    meta: { email: updated.email },
  });

  return { ok: true, data: null };
}

export async function changeMemberRole(
  ctx: ServiceContext,
  membershipId: string,
  role: InviteRole,
): Promise<OperationResult<null>> {
  if (!INVITE_ROLES.includes(role)) return { ok: false, error: 'Nieprawidłowa rola.' };

  const [updated] = await db
    .update(memberships)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, ctx.organizationId)))
    .returning();

  if (!updated) return { ok: false, error: 'Nie znaleziono członka organizacji.' };

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'member.role_changed',
    entityType: 'membership',
    entityId: membershipId,
    meta: { role },
  });

  return { ok: true, data: null };
}

export async function removeMember(ctx: ServiceContext, membershipId: string): Promise<OperationResult<null>> {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, ctx.organizationId)))
    .limit(1);

  if (!membership) return { ok: false, error: 'Nie znaleziono członka organizacji.' };
  if (membership.role === 'OWNER') return { ok: false, error: 'Nie można usunąć właściciela organizacji.' };

  await db
    .update(memberships)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, ctx.organizationId)));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'member.removed',
    entityType: 'membership',
    entityId: membershipId,
    meta: { userId: membership.userId },
  });

  return { ok: true, data: null };
}

export type AcceptFailure = 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'USED' | 'EMAIL_MISMATCH' | 'ALREADY_MEMBER';

/**
 * Przyjęcie zaproszenia przez zalogowanego użytkownika.
 * Zwraca organizację, do której dołączono.
 */
export type AcceptResult =
  | { ok: true; organizationId: string; role: string }
  | { ok: false; error: string; reason: AcceptFailure };

/**
 * Przyjęcie zaproszenia przez zalogowanego użytkownika.
 * Zwraca organizację, do której dołączono, albo powód odmowy.
 */
export async function acceptInvitation(token: string, user: { id: string; email: string }): Promise<AcceptResult> {
  const found = await getInvitationByToken(token);
  if (!found) return { ok: false, error: 'Nie znaleziono zaproszenia.', reason: 'NOT_FOUND' };

  const invitation = found.invitation;
  const now = new Date();

  if (invitation.revokedAt) return { ok: false, error: 'Zaproszenie zostało odwołane.', reason: 'REVOKED' };
  if (invitation.acceptedAt) return { ok: false, error: 'Zaproszenie zostało już wykorzystane.', reason: 'USED' };
  if (invitation.expiresAt.getTime() < now.getTime()) {
    return { ok: false, error: 'Zaproszenie wygasło. Poproś o nowe.', reason: 'EXPIRED' };
  }
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, error: 'To zaproszenie jest przypisane do innego adresu e-mail.', reason: 'EMAIL_MISMATCH' };
  }

  const existing = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.organizationId, invitation.organizationId), eq(memberships.userId, user.id)))
    .limit(1);

  if (existing[0]) {
    await db.update(invitations).set({ acceptedAt: now, acceptedById: user.id }).where(eq(invitations.id, invitation.id));
    return { ok: false, error: 'Jesteś już członkiem tej organizacji.', reason: 'ALREADY_MEMBER' };
  }

  await db.insert(memberships).values({
    organizationId: invitation.organizationId,
    userId: user.id,
    role: invitation.role,
  });
  await db.update(invitations).set({ acceptedAt: now, acceptedById: user.id }).where(eq(invitations.id, invitation.id));

  await writeAuditLog({
    organizationId: invitation.organizationId,
    userId: user.id,
    action: 'member.joined',
    entityType: 'invitation',
    entityId: invitation.id,
    meta: { email: user.email, role: invitation.role },
  });

  return { ok: true, organizationId: invitation.organizationId, role: invitation.role };
}

/** Liczba zaproszeń, które wygasły i nie zostały przyjęte. */
export async function countExpiredInvitations(organizationId: string): Promise<number> {
  const rows = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, organizationId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    );

  const now = Date.now();
  return rows.filter((row) => row.expiresAt.getTime() < now).length;
}
