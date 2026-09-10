'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { createAutomation, deleteAutomation, toggleAutomation, updateAutomation } from '@/lib/services/automations';
import { processDueRuns } from '@/lib/automation/engine';
import { rateLimit } from '@/lib/rate-limit';

export type AutomationFormState = { ok: boolean; error?: string; message?: string };

function parse(formData: FormData) {
  const delayDays = Number(formData.get('delayDays') ?? 0);
  const delayHours = Number(formData.get('delayHours') ?? 0);
  const minValue = String(formData.get('minValue') ?? '').trim();

  return {
    name: String(formData.get('name') ?? '').trim(),
    trigger: String(formData.get('trigger') ?? 'QUOTE_SENT'),
    action: String(formData.get('action') ?? 'SEND_EMAIL'),
    delayMinutes: Math.max(0, Math.round(delayDays * 24 * 60 + delayHours * 60)),
    conditions: {
      onlyIfUnaccepted: formData.get('onlyIfUnaccepted') === 'on',
      minValueCents: minValue ? Math.round(Number(minValue.replace(',', '.')) * 100) : undefined,
    },
    actionConfig: {
      subject: String(formData.get('subject') ?? '') || undefined,
      body: String(formData.get('body') ?? '') || undefined,
      message: String(formData.get('message') ?? '') || undefined,
      status: String(formData.get('status') ?? '') || undefined,
      channel: String(formData.get('channel') ?? '') || undefined,
    },
    isActive: formData.get('isActive') === 'on',
  };
}

export async function saveAutomationAction(_prev: AutomationFormState, formData: FormData): Promise<AutomationFormState> {
  const context = await requirePermissionOrThrow('automation:manage');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const automationId = String(formData.get('automationId') ?? '');

  const result = automationId
    ? await updateAutomation(ctx, automationId, parse(formData))
    : await createAutomation(ctx, parse(formData));

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/automatyzacje');
  return { ok: true, message: 'Automatyzacja zapisana.' };
}

export async function toggleAutomationAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('automation:manage');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  await toggleAutomation(ctx, String(formData.get('automationId') ?? ''), String(formData.get('isActive') ?? '') === 'true');
  revalidatePath('/automatyzacje');
}

export async function deleteAutomationAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('automation:manage');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  await deleteAutomation(ctx, String(formData.get('automationId') ?? ''));
  revalidatePath('/automatyzacje');
}

/**
 * Ręczne uruchomienie przetwarzania kolejki (to samo, co robi worker/cron).
 * Wykonuje realną pracę — brak „symulacji” uruchomienia.
 */
export async function runDueAutomationsAction(): Promise<void> {
  const context = await requirePermissionOrThrow('automation:manage');

  const limit = rateLimit(`automation-run:${context.organization.id}`, 10, 60_000);
  if (!limit.allowed) {
    revalidatePath('/automatyzacje');
    redirect(`/automatyzacje?blad=${encodeURIComponent(`Zbyt częste uruchamianie. Spróbuj ponownie za ${limit.retryAfterSeconds} s.`)}`);
  }

  await processDueRuns(50);
  revalidatePath('/automatyzacje');
}
