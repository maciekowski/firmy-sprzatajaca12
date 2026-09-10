'use server';

import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { memberships, organizations, services, users } from '@/lib/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { getUserOrganizations } from '@/lib/auth/guards';
import { setActiveOrganizationCookie } from '@/lib/auth/session';
import { organizationSetupSchema, serviceSchema, zodToFieldErrors, type FormState } from '@/lib/validation';
import { writeAuditLog } from '@/lib/audit';
import { seedMessageTemplates, seedDefaultAutomations } from '@/lib/org-defaults';
import { invitationSchema } from '@/lib/validation';
import { generateToken, hashToken, tokenExpiry } from '@/lib/auth/tokens';
import { invitations } from '@/lib/db/schema';
import { getPlan, checkPlanLimit } from '@/lib/billing/plans';

async function currentOrganizationId(): Promise<string> {
  const user = await requireUser('/onboarding');
  const orgs = await getUserOrganizations(user.id);
  if (orgs.length === 0) redirect('/rejestracja');
  return orgs[0].organization.id;
}

export async function saveOrganizationSetupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/onboarding');
  const organizationId = await currentOrganizationId();

  const parsed = organizationSetupSchema.safeParse({
    name: formData.get('name'),
    businessType: formData.get('businessType'),
    businessTypeOther: formData.get('businessTypeOther') ?? '',
    city: formData.get('city') ?? '',
    serviceArea: formData.get('serviceArea') ?? '',
    currency: formData.get('currency') ?? 'PLN',
    taxRatePercent: formData.get('taxRatePercent') ?? 23,
    taxId: formData.get('taxId') ?? '',
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    street: formData.get('street') ?? '',
    postalCode: formData.get('postalCode') ?? '',
  });

  if (!parsed.success) {
    return { ok: false, error: 'Popraw dane w formularzu.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const workingHours = buildWorkingHours(formData);

  await db
    .update(organizations)
    .set({
      name: parsed.data.name,
      businessType: parsed.data.businessType as never,
      businessTypeOther: parsed.data.businessTypeOther || null,
      city: parsed.data.city || null,
      serviceArea: parsed.data.serviceArea || null,
      currency: parsed.data.currency,
      taxRateBps: Math.round(parsed.data.taxRatePercent * 100),
      taxId: parsed.data.taxId || null,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      street: parsed.data.street || null,
      postalCode: parsed.data.postalCode || null,
      workingHours,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, organizationId));

  await seedMessageTemplates(organizationId);
  await seedDefaultAutomations(organizationId);

  await writeAuditLog({ organizationId, userId: user.id, action: 'organization.setup_saved' });

  redirect('/onboarding?step=2');
}

function buildWorkingHours(formData: FormData): Record<string, { from: string; to: string } | null> {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const result: Record<string, { from: string; to: string } | null> = {};
  for (const day of days) {
    const enabled = formData.get(`hours.${day}.enabled`) === 'on';
    const from = String(formData.get(`hours.${day}.from`) ?? '08:00');
    const to = String(formData.get(`hours.${day}.to`) ?? '16:00');
    result[day] = enabled ? { from, to } : null;
  }
  return result;
}

export async function saveFirstServiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/onboarding');
  const organizationId = await currentOrganizationId();

  const skip = formData.get('skip') === '1';
  if (skip) redirect('/onboarding?step=3');

  const parsed = serviceSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description') ?? '',
    unit: formData.get('unit') ?? 'VISIT',
    customUnitLabel: formData.get('customUnitLabel') ?? '',
    pricingMode: formData.get('pricingMode') ?? 'FIXED',
    basePrice: formData.get('basePrice') ?? 0,
    hourlyRate: formData.get('hourlyRate') || undefined,
    minPrice: formData.get('minPrice') ?? 0,
    durationMinutes: formData.get('durationMinutes') ?? 60,
    isActive: true,
  });

  if (!parsed.success) {
    return { ok: false, error: 'Popraw dane usługi.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  await db.insert(services).values({
    organizationId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    unit: parsed.data.unit,
    customUnitLabel: parsed.data.customUnitLabel || null,
    pricingMode: parsed.data.pricingMode,
    basePriceCents: Math.round(parsed.data.basePrice * 100),
    hourlyRateCents: parsed.data.hourlyRate ? Math.round(parsed.data.hourlyRate * 100) : null,
    minPriceCents: Math.round(parsed.data.minPrice * 100),
    durationMinutes: parsed.data.durationMinutes,
    isActive: true,
  });

  await writeAuditLog({ organizationId, userId: user.id, action: 'onboarding.service_created' });
  redirect('/onboarding?step=3');
}

export async function inviteFirstWorkerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser('/onboarding');
  const organizationId = await currentOrganizationId();

  const skip = formData.get('skip') === '1';
  if (skip) return finishOnboarding(organizationId);

  const parsed = invitationSchema.safeParse({
    email: formData.get('email') ?? '',
    role: formData.get('role') ?? 'WORKER',
  });

  if (!parsed.success) {
    return { ok: false, error: 'Popraw adres e-mail pracownika.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const orgRows = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const organization = orgRows[0];

  // limit użytkowników planu — sprawdzany po stronie serwera
  const members = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.organizationId, organizationId));
  const pending = await db.select({ id: invitations.id }).from(invitations).where(eq(invitations.organizationId, organizationId));
  const limitCheck = checkPlanLimit(organization?.plan ?? 'START', 'users', members.length + pending.length);
  if (!limitCheck.allowed) {
    return { ok: false, error: limitCheck.message };
  }

  const existingUser = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (existingUser.length > 0) {
    const existingMembership = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, existingUser[0].id)))
      .limit(1);
    if (existingMembership.length === 0) {
      await db.insert(memberships).values({
        organizationId,
        userId: existingUser[0].id,
        role: parsed.data.role,
      });
    }
  } else {
    const token = generateToken(32);
    await db.insert(invitations).values({
      organizationId,
      email: parsed.data.email,
      role: parsed.data.role,
      tokenHash: hashToken(token),
      invitedById: user.id,
      expiresAt: tokenExpiry(60 * 24 * 14),
    });
  }

  await writeAuditLog({ organizationId, userId: user.id, action: 'onboarding.worker_invited', meta: { email: parsed.data.email } });
  return finishOnboarding(organizationId);
}

async function finishOnboarding(organizationId: string): Promise<FormState> {
  await db
    .update(organizations)
    .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
    .where(eq(organizations.id, organizationId));
  await setActiveOrganizationCookie(organizationId);
  redirect('/dashboard?welcome=1');
}
