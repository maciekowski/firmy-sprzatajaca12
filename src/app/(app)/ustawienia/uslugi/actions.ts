'use server';

import { revalidatePath } from 'next/cache';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { createService, deactivateService, updateService, type PricingMode, type ServiceInput } from '@/lib/services/catalog';

function parse(formData: FormData): ServiceInput {
  const tiers: ServiceInput['tiers'] = [];
  const mins = formData.getAll('tierMin').map(String);
  const maxs = formData.getAll('tierMax').map(String);
  const prices = formData.getAll('tierPrice').map(String);
  const fees = formData.getAll('tierFee').map(String);

  mins.forEach((min, index) => {
    const price = Number(prices[index] ?? 0);
    const fee = Number(fees[index] ?? 0);
    if (min === '' && price === 0 && fee === 0) return;
    tiers.push({
      minQuantity: Number(min || 0),
      maxQuantity: maxs[index] === '' || maxs[index] === undefined ? null : Number(maxs[index]),
      unitPriceCents: Math.round(price * 100),
      flatFeeCents: Math.round(fee * 100),
    });
  });

  const pricingMode = String(formData.get('pricingMode') ?? 'FIXED') as PricingMode;

  return {
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? '') || null,
    unit: String(formData.get('unit') ?? 'VISIT'),
    customUnitLabel: String(formData.get('customUnitLabel') ?? '') || null,
    pricingMode,
    basePriceCents: Math.round(Number(String(formData.get('basePrice') ?? 0).replace(',', '.')) * 100),
    hourlyRateCents: formData.get('hourlyRate')
      ? Math.round(Number(String(formData.get('hourlyRate')).replace(',', '.')) * 100)
      : null,
    minPriceCents: Math.round(Number(String(formData.get('minPrice') ?? 0).replace(',', '.')) * 100),
    taxRateBps: formData.get('taxRatePercent') && String(formData.get('taxRatePercent')) !== ''
      ? Math.round(Number(formData.get('taxRatePercent')) * 100)
      : null,
    durationMinutes: Number(formData.get('durationMinutes') ?? 60),
    isActive: formData.get('isActive') === 'on',
    sortOrder: Number(formData.get('sortOrder') ?? 0),
    tiers: pricingMode === 'TIERED' ? tiers : [],
  };
}

export type ServiceFormState = { ok: boolean; error?: string; message?: string };

export async function saveServiceAction(_prev: ServiceFormState, formData: FormData): Promise<ServiceFormState> {
  const context = await requirePermissionOrThrow('service:manage');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const input = parse(formData);
  const serviceId = String(formData.get('serviceId') ?? '');
  const result = serviceId ? await updateService(ctx, serviceId, input) : await createService(ctx, input);

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/ustawienia/uslugi');
  revalidatePath('/wyceny/nowa');
  return { ok: true, message: 'Usługa zapisana.' };
}

export async function deactivateServiceAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('service:manage');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  await deactivateService(ctx, String(formData.get('serviceId') ?? ''));
  revalidatePath('/ustawienia/uslugi');
}
