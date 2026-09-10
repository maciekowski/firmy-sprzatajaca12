'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { customerAddresses, customerContacts, customers } from '@/lib/db/schema';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { writeActivity, writeAuditLog } from '@/lib/audit';
import { customerAddressSchema, customerContactSchema, customerSchema, zodToFieldErrors, type FormState } from '@/lib/validation';
import { getCustomer } from '@/lib/data/customers';
import { ensureCustomerPortalToken, revokeCustomerPortalToken } from '@/lib/services/portal';
import { rateLimit } from '@/lib/rate-limit';

function displayNameFor(input: { type: string; firstName?: string; lastName?: string; companyName?: string }): string {
  if (input.type === 'COMPANY') return (input.companyName ?? '').trim() || 'Klient firmowy';
  return [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || 'Klient';
}

export async function createCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let context;
  try {
    context = await requirePermissionOrThrow('customer:write');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Brak uprawnień.' };
  }

  const parsed = customerSchema.safeParse({
    type: formData.get('type'),
    firstName: formData.get('firstName') ?? '',
    lastName: formData.get('lastName') ?? '',
    companyName: formData.get('companyName') ?? '',
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    taxId: formData.get('taxId') ?? '',
    street: formData.get('street') ?? '',
    city: formData.get('city') ?? '',
    postalCode: formData.get('postalCode') ?? '',
    notes: formData.get('notes') ?? '',
    tags: formData.get('tags') ?? '',
    source: formData.get('source') ?? 'MANUAL',
    status: formData.get('status') ?? 'ACTIVE',
    emailOptIn: formData.get('emailOptIn') === 'on',
    smsOptIn: formData.get('smsOptIn') === 'on',
    consentBasis: formData.get('consentBasis') ?? '',
  });

  if (!parsed.success) {
    return { ok: false, error: 'Popraw dane w formularzu.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const tags = (parsed.data.tags ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= 40)
    .slice(0, 20);

  const [customer] = await db
    .insert(customers)
    .values({
      organizationId: context.organization.id,
      type: parsed.data.type,
      firstName: parsed.data.firstName || null,
      lastName: parsed.data.lastName || null,
      companyName: parsed.data.companyName || null,
      displayName: displayNameFor(parsed.data),
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      taxId: parsed.data.taxId || null,
      street: parsed.data.street || null,
      city: parsed.data.city || null,
      postalCode: parsed.data.postalCode || null,
      notes: parsed.data.notes || null,
      tags,
      source: parsed.data.source as never,
      status: parsed.data.status,
      emailOptIn: parsed.data.emailOptIn ?? true,
      smsOptIn: parsed.data.smsOptIn ?? false,
      consentBasis: parsed.data.consentBasis || null,
    })
    .returning();

  await writeAuditLog({
    organizationId: context.organization.id,
    userId: context.user.id,
    action: 'customer.created',
    entityType: 'customer',
    entityId: customer.id,
  });
  await writeActivity({
    organizationId: context.organization.id,
    entityType: 'customer',
    entityId: customer.id,
    type: 'created',
    message: `Dodano klienta: ${customer.displayName}`,
    userId: context.user.id,
    userName: context.user.name,
  });

  revalidatePath('/klienci');
  redirect(`/klienci/${customer.id}`);
}

export async function updateCustomerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let context;
  try {
    context = await requirePermissionOrThrow('customer:write');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Brak uprawnień.' };
  }

  const customerId = String(formData.get('customerId') ?? '');
  const existing = await getCustomer(context.organization.id, customerId);
  if (!existing) return { ok: false, error: 'Nie znaleziono klienta.' };

  const parsed = customerSchema.safeParse({
    type: formData.get('type'),
    firstName: formData.get('firstName') ?? '',
    lastName: formData.get('lastName') ?? '',
    companyName: formData.get('companyName') ?? '',
    email: formData.get('email') ?? '',
    phone: formData.get('phone') ?? '',
    taxId: formData.get('taxId') ?? '',
    street: formData.get('street') ?? '',
    city: formData.get('city') ?? '',
    postalCode: formData.get('postalCode') ?? '',
    notes: formData.get('notes') ?? '',
    tags: formData.get('tags') ?? '',
    source: formData.get('source') ?? 'MANUAL',
    status: formData.get('status') ?? 'ACTIVE',
    emailOptIn: formData.get('emailOptIn') === 'on',
    smsOptIn: formData.get('smsOptIn') === 'on',
    consentBasis: formData.get('consentBasis') ?? '',
  });

  if (!parsed.success) {
    return { ok: false, error: 'Popraw dane w formularzu.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const tags = (parsed.data.tags ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= 40)
    .slice(0, 20);

  await db
    .update(customers)
    .set({
      type: parsed.data.type,
      firstName: parsed.data.firstName || null,
      lastName: parsed.data.lastName || null,
      companyName: parsed.data.companyName || null,
      displayName: displayNameFor(parsed.data),
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      taxId: parsed.data.taxId || null,
      street: parsed.data.street || null,
      city: parsed.data.city || null,
      postalCode: parsed.data.postalCode || null,
      notes: parsed.data.notes || null,
      tags,
      source: parsed.data.source as never,
      status: parsed.data.status,
      emailOptIn: parsed.data.emailOptIn ?? false,
      smsOptIn: parsed.data.smsOptIn ?? false,
      consentBasis: parsed.data.consentBasis || null,
      updatedAt: new Date(),
    })
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, context.organization.id)));

  await writeAuditLog({
    organizationId: context.organization.id,
    userId: context.user.id,
    action: 'customer.updated',
    entityType: 'customer',
    entityId: customerId,
  });

  revalidatePath(`/klienci/${customerId}`);
  revalidatePath('/klienci');
  return { ok: true, message: 'Zmiany zapisane.' };
}

export async function addCustomerAddressAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let context;
  try {
    context = await requirePermissionOrThrow('customer:write');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Brak uprawnień.' };
  }

  const customerId = String(formData.get('customerId') ?? '');
  const existing = await getCustomer(context.organization.id, customerId);
  if (!existing) return { ok: false, error: 'Nie znaleziono klienta.' };

  const parsed = customerAddressSchema.safeParse({
    label: formData.get('label') ?? '',
    street: formData.get('street') ?? '',
    city: formData.get('city') ?? '',
    postalCode: formData.get('postalCode') ?? '',
    notes: formData.get('notes') ?? '',
    isDefault: formData.get('isDefault') === 'on',
  });

  if (!parsed.success) {
    return { ok: false, error: 'Popraw dane adresu.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  if (parsed.data.isDefault) {
    await db.update(customerAddresses).set({ isDefault: false }).where(eq(customerAddresses.customerId, customerId));
  }

  await db.insert(customerAddresses).values({
    customerId,
    label: parsed.data.label || 'Adres realizacji',
    street: parsed.data.street || null,
    city: parsed.data.city || null,
    postalCode: parsed.data.postalCode || null,
    notes: parsed.data.notes || null,
    isDefault: parsed.data.isDefault ?? false,
  });

  revalidatePath(`/klienci/${customerId}`);
  return { ok: true, message: 'Dodano adres.' };
}

export async function addCustomerContactAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let context;
  try {
    context = await requirePermissionOrThrow('customer:write');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Brak uprawnień.' };
  }

  const customerId = String(formData.get('customerId') ?? '');
  const existing = await getCustomer(context.organization.id, customerId);
  if (!existing) return { ok: false, error: 'Nie znaleziono klienta.' };

  const parsed = customerContactSchema.safeParse({
    name: formData.get('name') ?? '',
    role: formData.get('role') ?? '',
    phone: formData.get('phone') ?? '',
    email: formData.get('email') ?? '',
    isPrimary: formData.get('isPrimary') === 'on',
    notes: formData.get('notes') ?? '',
  });

  if (!parsed.success) {
    return { ok: false, error: 'Popraw dane kontaktu.', fieldErrors: zodToFieldErrors(parsed.error) };
  }

  if (parsed.data.isPrimary) {
    await db.update(customerContacts).set({ isPrimary: false }).where(eq(customerContacts.customerId, customerId));
  }

  await db.insert(customerContacts).values({
    customerId,
    name: parsed.data.name,
    role: parsed.data.role || null,
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
    isPrimary: parsed.data.isPrimary ?? false,
    notes: parsed.data.notes || null,
  });

  revalidatePath(`/klienci/${customerId}`);
  return { ok: true, message: 'Dodano kontakt.' };
}

export async function deleteCustomerAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('customer:write');
  const customerId = String(formData.get('customerId') ?? '');
  const existing = await getCustomer(context.organization.id, customerId);
  if (!existing) return;

  await db.delete(customers).where(and(eq(customers.id, customerId), eq(customers.organizationId, context.organization.id)));

  await writeAuditLog({
    organizationId: context.organization.id,
    userId: context.user.id,
    action: 'customer.deleted',
    entityType: 'customer',
    entityId: customerId,
  });

  revalidatePath('/klienci');
  redirect('/klienci');
}

/**
 * Preferencje wiadomości klienta — osobno dla kanału i dla kategorii
 * (transakcyjne / systemowe / automatyczne / marketingowe).
 *
 * Zapis zmiany zgody trafia do logu audytowego (wymóg rozliczalności).
 */
export async function updateCustomerPreferencesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let context;
  try {
    context = await requirePermissionOrThrow('customer:write');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Brak uprawnień.' };
  }

  const customerId = String(formData.get('customerId') ?? '');
  const existing = await getCustomer(context.organization.id, customerId);
  if (!existing) return { ok: false, error: 'Nie znaleziono klienta.' };

  const values = {
    emailOptIn: formData.get('emailOptIn') === 'on',
    smsOptIn: formData.get('smsOptIn') === 'on',
    emailTransactionalOptIn: formData.get('emailTransactionalOptIn') === 'on',
    emailSystemOptIn: formData.get('emailSystemOptIn') === 'on',
    emailAutomationOptIn: formData.get('emailAutomationOptIn') === 'on',
    emailMarketingOptIn: formData.get('emailMarketingOptIn') === 'on',
    consentBasis: String(formData.get('consentBasis') ?? '') || null,
  };

  await db
    .update(customers)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, context.organization.id)));

  await writeAuditLog({
    organizationId: context.organization.id,
    userId: context.user.id,
    action: 'customer.preferences_updated',
    entityType: 'customer',
    entityId: customerId,
    meta: values,
  });

  revalidatePath(`/klienci/${customerId}`);
  return { ok: true, message: 'Preferencje wiadomości zapisane.' };
}

export type PortalLinkState = { ok: boolean; message?: string; error?: string; token?: string };

/**
 * Wygenerowanie (lub pobranie) prywatnego linku do konta klienta.
 * Link jest jedynym sposobem dostępu — klient nie zakłada hasła.
 */
export async function createPortalLinkAction(_prev: PortalLinkState, formData: FormData): Promise<PortalLinkState> {
  const context = await requirePermissionOrThrow('customer:write');
  const customerId = String(formData.get('customerId') ?? '');

  const limit = rateLimit(`portal-link:${context.organization.id}`, 20, 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Zbyt wiele prób. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` };
  }

  const result = await ensureCustomerPortalToken(
    { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name },
    customerId,
  );
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/klienci/${customerId}`);
  return { ok: true, message: 'Link do konta klienta jest aktywny.', token: result.data.token };
}

/** Odwołanie dostępu do konta klienta — stary link przestaje działać. */
export async function revokePortalLinkAction(_prev: PortalLinkState, formData: FormData): Promise<PortalLinkState> {
  const context = await requirePermissionOrThrow('customer:write');
  const customerId = String(formData.get('customerId') ?? '');

  const result = await revokeCustomerPortalToken(
    { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name },
    customerId,
  );
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/klienci/${customerId}`);
  return { ok: true, message: 'Dostęp do konta klienta został odwołany (stary link nie działa).' };
}
