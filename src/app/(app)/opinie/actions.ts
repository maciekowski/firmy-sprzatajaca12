'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { createReviewRequest } from '@/lib/services/reviews';

export async function createReviewRequestAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('review:manage');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const customerId = String(formData.get('customerId') ?? '');
  const jobId = String(formData.get('jobId') ?? '') || null;
  const channel = (String(formData.get('channel') ?? 'OWN_FORM') || 'OWN_FORM') as 'GOOGLE' | 'OWN_FORM' | 'OTHER';
  const externalUrl = String(formData.get('externalUrl') ?? '') || null;

  if (!customerId) redirect('/opinie?blad=Nie%20wybrano%20klienta');

  const result = await createReviewRequest(ctx, { customerId, jobId, channel, externalUrl });
  revalidatePath('/opinie');
  if (!result.ok) redirect(`/opinie?blad=${encodeURIComponent(result.error)}`);
  redirect('/opinie');
}
