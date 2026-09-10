'use server';

import { revalidatePath } from 'next/cache';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { inviteMember, updateMemberRole, updateOrganizationSettings } from '@/lib/services/organizations';
import type { Role } from '@/lib/db/schema';

export type SettingsState = { ok: boolean; message?: string; error?: string };

function money(value: FormDataEntryValue | null): number {
  return Math.round(Number(String(value ?? 0).replace(',', '.')) * 100) || 0;
}

export async function saveSettingsAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const context = await requirePermissionOrThrow('org:manage');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const travelFeeType = String(formData.get('travelFeeType') ?? 'NONE');
  const result = await updateOrganizationSettings(ctx, {
    name: String(formData.get('name') ?? '').trim() || undefined,
    taxId: String(formData.get('taxId') ?? '') || null,
    email: String(formData.get('email') ?? '') || null,
    phone: String(formData.get('phone') ?? '') || null,
    website: String(formData.get('website') ?? '') || null,
    street: String(formData.get('street') ?? '') || null,
    postalCode: String(formData.get('postalCode') ?? '') || null,
    city: String(formData.get('city') ?? '') || null,
    serviceArea: String(formData.get('serviceArea') ?? '') || null,
    currency: String(formData.get('currency') ?? 'PLN'),
    taxRateBps: Math.round(Number(formData.get('taxRatePercent') ?? 23) * 100),
    paymentTermsDays: Number(formData.get('paymentTermsDays') ?? 14),
    invoicePrefix: String(formData.get('invoicePrefix') ?? 'FV'),
    quotePrefix: String(formData.get('quotePrefix') ?? 'OF'),
    jobPrefix: String(formData.get('jobPrefix') ?? 'ZL'),
    estimatePrefix: String(formData.get('estimatePrefix') ?? 'WY'),
    invoiceNotes: String(formData.get('invoiceNotes') ?? '') || null,
    quoteTerms: String(formData.get('quoteTerms') ?? '') || null,
    travelFeeType: (['NONE', 'FLAT', 'PER_KM'].includes(travelFeeType) ? travelFeeType : 'NONE') as 'NONE' | 'FLAT' | 'PER_KM',
    travelFlatFeeCents: money(formData.get('travelFlatFee')),
    travelPerKmCents: money(formData.get('travelPerKm')),
    urgencySurchargeBps: Math.round(Number(formData.get('urgencySurchargePercent') ?? 0) * 100),
    minJobValueCents: money(formData.get('minJobValue')),
    completionRequirements: {
      requireChecklist: formData.get('requireChecklist') === 'on',
      requireAfterPhotos: formData.get('requireAfterPhotos') === 'on',
      minAfterPhotos: Number(formData.get('minAfterPhotos') ?? 1),
      requireNote: formData.get('requireNote') === 'on',
    },
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/ustawienia');
  revalidatePath('/dashboard');
  return { ok: true, message: 'Ustawienia zapisane.' };
}

export async function inviteMemberAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const context = await requirePermissionOrThrow('members:manage');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const result = await inviteMember(ctx, {
    email: String(formData.get('email') ?? ''),
    role: String(formData.get('role') ?? 'WORKER') as Role,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/ustawienia');

  if (result.invited) {
    if (result.deliveryNote) {
      return {
        ok: true,
        message: `Dodano osobę do firmy. ${result.deliveryNote}${
          result.setupLink ? ` Przekaż jej link do ustawienia hasła: ${result.setupLink}` : ''
        }`,
      };
    }
    return {
      ok: true,
      message: 'Dodano osobę do firmy i wysłano zaproszenie e-mailem z linkiem do ustawienia hasła.',
    };
  }

  return { ok: true, message: 'Dodano istniejącego użytkownika do firmy (loguje się swoim hasłem).' };
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('members:manage');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  await updateMemberRole(ctx, String(formData.get('userId') ?? ''), String(formData.get('role') ?? 'VIEWER') as Role);
  revalidatePath('/ustawienia');
}
