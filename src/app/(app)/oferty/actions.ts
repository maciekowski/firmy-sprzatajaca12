'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { acceptQuoteManually, cancelQuote } from '@/lib/services/quotes';
import { createJobFromQuote } from '@/lib/services/jobs';
import { enqueueAutomations } from '@/lib/automation/engine';

export async function acceptQuoteManuallyAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('quote:write');
  const quoteId = String(formData.get('quoteId') ?? '');
  const result = await acceptQuoteManually(
    { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name },
    quoteId,
    'Zaakceptowana telefonicznie / ustnie — odnotowano w systemie.',
  );
  revalidatePath(`/oferty/${quoteId}`);
  redirect(`/oferty/${quoteId}?wynik=${result.ok ? 'zaakceptowana' : 'blad'}`);
}

export async function cancelQuoteAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('quote:write');
  const quoteId = String(formData.get('quoteId') ?? '');
  await cancelQuote(
    { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name },
    quoteId,
  );
  revalidatePath(`/oferty/${quoteId}`);
  redirect(`/oferty/${quoteId}`);
}

/** Utworzenie zlecenia z zaakceptowanej oferty. */
export async function createJobFromQuoteAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const quoteId = String(formData.get('quoteId') ?? '');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const result = await createJobFromQuote(ctx, quoteId);
  if (!result.ok) {
    redirect(`/oferty/${quoteId}?blad=${encodeURIComponent(result.error)}`);
  }

  await enqueueAutomations({ organizationId: context.organization.id, trigger: 'JOB_CREATED', targetType: 'job', targetId: result.data!.id });

  revalidatePath('/zlecenia');
  redirect(`/zlecenia/${result.data!.id}`);
}
