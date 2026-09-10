'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { analyzeRequest, createRequest, getRequest, updateRequestStatus } from '@/lib/services/requests';
import { createLead } from '@/lib/services/leads';
import { listServicesWithTiers } from '@/lib/data/services';

export type RequestFormState = { ok: boolean; error?: string; message?: string };

export async function createRequestAction(_prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  const context = await requirePermissionOrThrow('request:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const result = await createRequest(ctx, {
    contactName: String(formData.get('contactName') ?? '') || null,
    contactPhone: String(formData.get('contactPhone') ?? '') || null,
    contactEmail: String(formData.get('contactEmail') ?? '') || null,
    customerId: String(formData.get('customerId') ?? '') || null,
    street: String(formData.get('street') ?? '') || null,
    city: String(formData.get('city') ?? '') || null,
    postalCode: String(formData.get('postalCode') ?? '') || null,
    description: String(formData.get('description') ?? ''),
    serviceId: String(formData.get('serviceId') ?? '') || null,
    preferredDate: String(formData.get('preferredDate') ?? '') || null,
    preferredTimeFrom: String(formData.get('preferredTimeFrom') ?? '') || null,
    preferredTimeTo: String(formData.get('preferredTimeTo') ?? '') || null,
    urgency: (String(formData.get('urgency') ?? 'NORMAL') || 'NORMAL') as 'LOW' | 'NORMAL' | 'HIGH',
    notes: String(formData.get('notes') ?? '') || null,
    channel: String(formData.get('channel') ?? 'MANUAL'),
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/zapytania');
  redirect(`/zapytania/${result.request.id}`);
}

/** Analiza AI — wynik jest zapisywany w rekordzie zapytania. */
export async function analyzeRequestAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('request:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const requestId = String(formData.get('requestId') ?? '');

  const services = await listServicesWithTiers(context.organization.id, true);
  await analyzeRequest(ctx, requestId, services.map((service) => service.name));

  revalidatePath(`/zapytania/${requestId}`);
  redirect(`/zapytania/${requestId}`);
}

export async function changeRequestStatusAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('request:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const requestId = String(formData.get('requestId') ?? '');
  const status = String(formData.get('status') ?? 'NEW') as never;

  await updateRequestStatus(ctx, requestId, status);
  revalidatePath(`/zapytania/${requestId}`);
  redirect(`/zapytania/${requestId}`);
}

/** Utworzenie leada z zapytania — dane przepisujemy z rekordu zapytania. */
export async function convertRequestToLeadAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('lead:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const requestId = String(formData.get('requestId') ?? '');

  const request = await getRequest(context.organization.id, requestId);
  if (!request) redirect('/zapytania?blad=Nie%20znaleziono%20zapytania');

  const result = await createLead(ctx, {
    title: request.description.slice(0, 120),
    description: request.description,
    source: 'WEBSITE',
    contactName: request.contactName,
    contactPhone: request.contactPhone,
    contactEmail: request.contactEmail,
    street: request.street,
    city: request.city,
    postalCode: request.postalCode,
    serviceId: request.serviceId,
  });

  if (!result.ok) redirect(`/zapytania/${requestId}?blad=${encodeURIComponent(result.error)}`);

  const { db } = await import('@/lib/db/client');
  const { serviceRequests } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  await db
    .update(serviceRequests)
    .set({ convertedLeadId: result.lead.id, status: 'CONVERTED', updatedAt: new Date() })
    .where(eq(serviceRequests.id, requestId));

  revalidatePath('/zapytania');
  redirect(`/leady/${result.lead.id}`);
}
