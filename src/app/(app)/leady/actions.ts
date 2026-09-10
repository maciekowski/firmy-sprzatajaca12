'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { changeLeadStatus, convertLeadToCustomer, createLead, deleteLead, updateLead } from '@/lib/services/leads';
import type { Lead } from '@/lib/db/schema';

function parse(formData: FormData) {
  const followUpAtRaw = String(formData.get('followUpAt') ?? '').trim();
  const followUpAt = followUpAtRaw ? new Date(followUpAtRaw) : null;
  const valueRaw = String(formData.get('estimatedValue') ?? '').trim();

  return {
    title: String(formData.get('title') ?? '').trim(),
    description: String(formData.get('description') ?? '') || null,
    source: String(formData.get('source') ?? 'MANUAL'),
    contactName: String(formData.get('contactName') ?? '') || null,
    contactPhone: String(formData.get('contactPhone') ?? '') || null,
    contactEmail: String(formData.get('contactEmail') ?? '') || null,
    street: String(formData.get('street') ?? '') || null,
    city: String(formData.get('city') ?? '') || null,
    postalCode: String(formData.get('postalCode') ?? '') || null,
    serviceId: String(formData.get('serviceId') ?? '') || null,
    assignedToId: String(formData.get('assignedToId') ?? '') || null,
    estimatedValueCents: valueRaw ? Math.round(Number(valueRaw.replace(',', '.')) * 100) : null,
    followUpAt: followUpAt && !Number.isNaN(followUpAt.getTime()) ? followUpAt : null,
  };
}

export type LeadFormState = { ok: boolean; error?: string; message?: string };

export async function createLeadAction(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const context = await requirePermissionOrThrow('lead:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const result = await createLead(ctx, parse(formData));
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/leady');
  redirect(`/leady/${result.lead.id}`);
}

export async function updateLeadAction(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const context = await requirePermissionOrThrow('lead:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const leadId = String(formData.get('leadId') ?? '');

  const result = await updateLead(ctx, leadId, parse(formData));
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/leady/${leadId}`);
  revalidatePath('/leady');
  return { ok: true, message: 'Lead zaktualizowany.' };
}

export async function changeLeadStatusAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('lead:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const leadId = String(formData.get('leadId') ?? '');
  const status = String(formData.get('status') ?? '') as Lead['status'];
  const note = String(formData.get('note') ?? '') || null;

  await changeLeadStatus(ctx, leadId, status, note);
  revalidatePath(`/leady/${leadId}`);
  revalidatePath('/leady');
  redirect(`/leady/${leadId}`);
}

export async function convertLeadAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('lead:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const leadId = String(formData.get('leadId') ?? '');

  const result = await convertLeadToCustomer(ctx, leadId);
  revalidatePath(`/leady/${leadId}`);
  revalidatePath('/klienci');

  if (!result.ok) redirect(`/leady/${leadId}?blad=${encodeURIComponent(result.error)}`);
  redirect(`/klienci/${result.customerId}`);
}

export async function deleteLeadAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('lead:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const leadId = String(formData.get('leadId') ?? '');

  await deleteLead(ctx, leadId);
  revalidatePath('/leady');
  redirect('/leady');
}
