'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireOrgContext, requirePermissionOrThrow } from '@/lib/auth/guards';
import { createEstimate, updateEstimate, deleteEstimate, type DocumentDraft } from '@/lib/services/estimates';
import { createQuoteFromEstimate } from '@/lib/services/estimates';
import { sendQuote } from '@/lib/services/quotes';
import { writeAuditLog } from '@/lib/audit';

const lineSchema = z.object({
  serviceId: z.string().nullish(),
  addonId: z.string().nullish(),
  name: z.string().min(1, 'Podaj nazwę pozycji.').max(200),
  description: z.string().max(2000).nullish(),
  quantity: z.coerce.number().min(0).max(1_000_000),
  unit: z.string().min(1).max(20),
  unitPriceCents: z.coerce.number().min(0).max(10_000_000),
  taxRateBps: z.coerce.number().min(0).max(10_000),
  discountBps: z.coerce.number().min(0).max(10_000).optional(),
  isCustom: z.boolean().optional(),
});

const draftSchema = z.object({
  customerId: z.string().min(1, 'Wybierz klienta.'),
  addressId: z.string().nullish(),
  leadId: z.string().nullish(),
  lines: z.array(lineSchema).min(1, 'Dodaj co najmniej jedną pozycję.').max(100),
  discountBps: z.coerce.number().min(0).max(10_000).optional(),
  discountCents: z.coerce.number().min(0).max(100_000_000).optional(),
  travelFeeType: z.enum(['NONE', 'FLAT', 'PER_KM']).optional(),
  travelFlatFeeCents: z.coerce.number().min(0).max(10_000_000).optional(),
  travelPerKmCents: z.coerce.number().min(0).max(10_000_000).optional(),
  travelDistanceKm: z.coerce.number().min(0).max(10_000).nullish(),
  isUrgent: z.boolean().optional(),
  notes: z.string().max(4000).nullish(),
  terms: z.string().max(4000).nullish(),
  internalNotes: z.string().max(4000).nullish(),
  validUntil: z.string().nullish(),
});

export type EstimateActionState = { ok: boolean; error?: string; message?: string };

function parseDraft(raw: string): { ok: true; draft: DocumentDraft } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Nieprawidłowy format danych wyceny.' };
  }
  const parsed = draftSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane wyceny.' };
  }
  const data = parsed.data;
  return {
    ok: true,
    draft: {
      customerId: data.customerId,
      addressId: data.addressId ?? null,
      leadId: data.leadId ?? null,
      lines: data.lines.map((line) => ({
        serviceId: line.serviceId ?? null,
        addonId: line.addonId ?? null,
        name: line.name,
        description: line.description ?? null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        unit: line.unit,
        taxRateBps: line.taxRateBps,
        discountBps: line.discountBps ?? 0,
        isCustom: line.isCustom ?? !line.serviceId,
      })),
      discountBps: data.discountBps ?? 0,
      discountCents: data.discountCents ?? 0,
      travelFeeType: data.travelFeeType,
      travelFlatFeeCents: data.travelFlatFeeCents,
      travelPerKmCents: data.travelPerKmCents,
      travelDistanceKm: data.travelDistanceKm ?? null,
      isUrgent: data.isUrgent ?? false,
      notes: data.notes ?? null,
      terms: data.terms ?? null,
      internalNotes: data.internalNotes ?? null,
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
    },
  };
}

export async function saveEstimateAction(_prev: EstimateActionState, formData: FormData): Promise<EstimateActionState> {
  let context;
  try {
    context = await requirePermissionOrThrow('estimate:write');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Brak uprawnień.' };
  }

  const raw = String(formData.get('draft') ?? '[]');
  const parsed = parseDraft(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const estimateId = formData.get('estimateId') ? String(formData.get('estimateId')) : null;
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  if (estimateId) {
    const updated = await updateEstimate(ctx, estimateId, parsed.draft);
    if (!updated) return { ok: false, error: 'Nie znaleziono wyceny.' };
    revalidatePath(`/wyceny/${estimateId}`);
    return { ok: true, message: 'Wycena zaktualizowana.' };
  }

  const estimate = await createEstimate(ctx, parsed.draft);
  await writeAuditLog({
    organizationId: context.organization.id,
    userId: context.user.id,
    action: 'estimate.created',
    entityType: 'estimate',
    entityId: estimate.id,
  });
  revalidatePath('/wyceny');
  redirect(`/wyceny/${estimate.id}`);
}

export async function deleteEstimateAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('estimate:write');
  const estimateId = String(formData.get('estimateId') ?? '');
  await deleteEstimate(
    { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name },
    estimateId,
  );
  revalidatePath('/wyceny');
  redirect('/wyceny');
}

export async function createQuoteAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('quote:write');
  const estimateId = String(formData.get('estimateId') ?? '');
  const validDays = Number(formData.get('validDays') ?? 14);
  const notes = formData.get('notes') ? String(formData.get('notes')) : null;
  const terms = formData.get('terms') ? String(formData.get('terms')) : null;

  const quote = await createQuoteFromEstimate(
    { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name },
    estimateId,
    { validDays: Number.isFinite(validDays) && validDays > 0 ? validDays : 14, notes, terms },
  );

  if (!quote) redirect(`/wyceny/${estimateId}?error=quote`);
  revalidatePath('/oferty');
  redirect(`/oferty/${quote!.id}`);
}

export async function sendQuoteAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('quote:send');
  const quoteId = String(formData.get('quoteId') ?? '');
  const result = await sendQuote(
    { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name },
    quoteId,
  );
  revalidatePath(`/oferty/${quoteId}`);
  redirect(`/oferty/${quoteId}?wynik=${result.ok ? 'wyslano' : 'blad'}`);
}

export async function createQuoteFromEstimateAction(formData: FormData): Promise<void> {
  await createQuoteAction(formData);
}
