import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { memberships, organizations, users, type Role } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';

export type ServiceContext = { organizationId: string; userId: string; userName: string };

export type OrgSettingsInput = {
  name?: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  serviceArea?: string | null;
  currency?: string;
  taxRateBps?: number;
  paymentTermsDays?: number;
  invoicePrefix?: string;
  quotePrefix?: string;
  jobPrefix?: string;
  estimatePrefix?: string;
  invoiceNotes?: string | null;
  quoteTerms?: string | null;
  travelFeeType?: 'NONE' | 'FLAT' | 'PER_KM';
  travelFlatFeeCents?: number;
  travelPerKmCents?: number;
  urgencySurchargeBps?: number;
  minJobValueCents?: number;
  completionRequirements?: {
    requireChecklist?: boolean;
    requireAfterPhotos?: boolean;
    minAfterPhotos?: number;
    requireNote?: boolean;
  } | null;
};

export async function updateOrganizationSettings(
  ctx: ServiceContext,
  input: OrgSettingsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.taxRateBps !== undefined && (input.taxRateBps < 0 || input.taxRateBps > 10000)) {
    return { ok: false, error: 'Stawka VAT musi być między 0 a 100%.' };
  }
  if (input.currency && !['PLN', 'EUR', 'USD', 'GBP', 'CZK'].includes(input.currency)) {
    return { ok: false, error: 'Nieobsługiwana waluta.' };
  }

  const [current] = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  if (!current) return { ok: false, error: 'Nie znaleziono firmy.' };

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) patch[key] = value;
  }

  if (input.completionRequirements) {
    patch.completionRequirements = {
      requireChecklist: Boolean(input.completionRequirements.requireChecklist),
      requireAfterPhotos: Boolean(input.completionRequirements.requireAfterPhotos),
      minAfterPhotos: Math.max(0, Number(input.completionRequirements.minAfterPhotos ?? 1)),
      requireNote: Boolean(input.completionRequirements.requireNote),
    };
  }

  await db.update(organizations).set(patch).where(eq(organizations.id, ctx.organizationId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'org.settings_updated',
    entityType: 'organization',
    entityId: ctx.organizationId,
    meta: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
  });

  return { ok: true };
}

const ASSIGNABLE_ROLES: Role[] = ['OWNER', 'ADMIN', 'DISPATCHER', 'WORKER', 'VIEWER'];

export async function updateMemberRole(
  ctx: ServiceContext,
  userId: string,
  role: Role,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ASSIGNABLE_ROLES.includes(role)) return { ok: false, error: 'Nieznana rola.' };

  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, userId)))
    .limit(1);
  if (rows.length === 0) return { ok: false, error: 'Nie znaleziono pracownika w tej firmie.' };

  // nie pozwalamy odebrać ostatniego właściciela — firma musi mieć kogoś z uprawnieniami
  if (rows[0].role === 'OWNER' && role !== 'OWNER') {
    const owners = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.role, 'OWNER')));
    if (owners.length <= 1) {
      return { ok: false, error: 'Firma musi mieć przynajmniej jednego właściciela.' };
    }
  }

  await db.update(memberships).set({ role, updatedAt: new Date() }).where(eq(memberships.id, rows[0].id));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'members.role_changed',
    entityType: 'membership',
    entityId: rows[0].id,
    meta: { userId, from: rows[0].role, to: role },
  });

  return { ok: true };
}

export type InviteMemberResult =
  | { ok: true; userId: string; invited: boolean; deliveryNote: string | null; setupLink: string | null }
  | { ok: false; error: string };

export async function inviteMember(
  ctx: ServiceContext,
  input: { email: string; role: Role },
): Promise<InviteMemberResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Podaj poprawny adres e-mail.' };
  if (!ASSIGNABLE_ROLES.includes(input.role)) return { ok: false, error: 'Nieznana rola.' };

  const [organization] = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const organizationName = organization?.name ?? null;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId = existing[0]?.id;
  let invited = false;

  if (!userId) {
    // Osoba nie ma jeszcze konta: zakładamy je z LOSOWYM, nieznanym nikomu hasłem.
    // Hasło nie jest nigdzie wysyłane ani wyświetlane — użytkownik ustawia je
    // przez „reset hasła”. Bez skonfigurowanej poczty nie wysyłamy zaproszenia,
    // co UI komunikuje wprost (brak udawanego „wysłano zaproszenie”).
    const { hashPassword } = await import('@/lib/auth/password');
    const { randomBytes } = await import('node:crypto');
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: email.split('@')[0],
        passwordHash: await hashPassword(randomBytes(24).toString('base64url')),
      })
      .returning();
    userId = created.id;
    invited = true;
  }

  const already = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.organizationId, ctx.organizationId), eq(memberships.userId, userId)))
    .limit(1);
  if (already.length > 0) return { ok: false, error: 'Ta osoba jest już w firmie.' };

  await db.insert(memberships).values({ organizationId: ctx.organizationId, userId, role: input.role });

  // Zaproszenie wysyłamy WYŁĄCZNIE przez skonfigurowanego providera poczty.
  // Bez providera nie udajemy wysyłki — zwracamy link do ręcznego przekazania.
  let deliveryNote: string | null = 'Wiadomość nie została wysłana — brak skonfigurowanej wysyłki e-mail.';
  let setupLink: string | null = null;

  if (invited) {
    const { generateToken, hashToken, tokenExpiry } = await import('@/lib/auth/tokens');
    const { passwordResetTokens } = await import('@/lib/db/schema');
    const { sendCommunication } = await import('@/lib/comms/service');

    const token = generateToken(32);
    await db.insert(passwordResetTokens).values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: tokenExpiry(60 * 24 * 7), // 7 dni na pierwsze ustawienie hasła
    });

    const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const link = `${base}/reset-hasla/${token}`;

    const result = await sendCommunication({
      organizationId: ctx.organizationId,
      channel: 'EMAIL',
      to: email,
      subject: `Zaproszenie do ${organizationName ?? 'ServiceFlow'}`,
      body: `Dzień dobry,\n\n${ctx.userName ?? 'Administrator'} dodał Cię do zespołu w ServiceFlow (rola: ${input.role}).\n\nUstaw hasło, otwierając ten link (ważny 7 dni):\n${link}\n\nPo ustawieniu hasła zaloguj się adresem ${email}.`,
      userId: ctx.userId,
      category: 'SYSTEM',
      respectConsent: false, // zaproszenie do zespołu nie jest komunikacją marketingową
    });

    if (result.delivered) {
      deliveryNote = null;
    } else {
      deliveryNote = result.reason ?? deliveryNote;
      setupLink = link;
    }
  } else {
    deliveryNote = null; // użytkownik ma już konto i hasło — nic nie wysyłamy
  }

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'members.invited',
    entityType: 'membership',
    entityId: userId,
    meta: { email, role: input.role, createdAccount: invited, delivered: deliveryNote === null },
  });

  return { ok: true, userId, invited, deliveryNote, setupLink };
}

export async function listOrganizationMembers(organizationId: string) {
  const { memberships, users } = await import('@/lib/db/schema');
  return db
    .select({
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
    .orderBy(asc(users.name));
}
