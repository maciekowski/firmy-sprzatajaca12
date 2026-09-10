'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { downloadKsefUpo, markInvoiceReadyForKsef, refreshKsefStatus, submitInvoiceToKsef } from '@/lib/ksef/service';

function back(invoiceId: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  return redirect(`/faktury/${invoiceId}${query ? `?${query}` : ''}`);
}

export async function markInvoiceReadyForKsefAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('invoice:ksef');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const invoiceId = String(formData.get('invoiceId') ?? '');

  const result = await markInvoiceReadyForKsef(ctx, invoiceId);
  revalidatePath(`/faktury/${invoiceId}`);
  back(invoiceId, result.ok ? { wynik: 'ksef-gotowa' } : { blad: result.error });
}

export async function submitInvoiceToKsefAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('invoice:ksef');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const invoiceId = String(formData.get('invoiceId') ?? '');

  const result = await submitInvoiceToKsef(ctx, invoiceId);
  revalidatePath(`/faktury/${invoiceId}`);
  if (!result.ok) back(invoiceId, { blad: result.error });
  const finalStatus = result.status;

  back(invoiceId, { wynik: finalStatus === 'ACCEPTED' ? 'ksef-przyjeta' : 'ksef-wyslana' });
}

export async function refreshKsefStatusAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('invoice:ksef');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const invoiceId = String(formData.get('invoiceId') ?? '');

  const result = await refreshKsefStatus(ctx, invoiceId);
  revalidatePath(`/faktury/${invoiceId}`);
  back(invoiceId, result.ok ? { wynik: 'ksef-stan' } : { blad: result.error });
}

export async function downloadKsefUpoAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('invoice:ksef');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const invoiceId = String(formData.get('invoiceId') ?? '');

  const result = await downloadKsefUpo(ctx, invoiceId);
  revalidatePath(`/faktury/${invoiceId}`);
  back(invoiceId, result.ok ? { wynik: 'ksef-upo' } : { blad: result.error });
}
