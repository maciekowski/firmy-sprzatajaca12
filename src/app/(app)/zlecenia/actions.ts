'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import {
  addJobNote,
  addJobPhoto,
  assignJobPeople,
  completeJob,
  createJob,
  scheduleJob,
  startTimeEntry,
  pauseTimeEntry,
  resumeTimeEntry,
  stopTimeEntry,
  toggleChecklistItem,
  updateJobStatus,
} from '@/lib/services/jobs';
import { enqueueAutomations } from '@/lib/automation/engine';

function parseDate(value: FormDataEntryValue | null): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function backTo(jobId: string, params: Record<string, string> = {}) {
  const query = new URLSearchParams(params).toString();
  redirect(`/zlecenia/${jobId}${query ? `?${query}` : ''}`);
}

/** Ręczne utworzenie zlecenia (bez oferty). */
export async function createJobAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const customerId = String(formData.get('customerId') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (!customerId || !title) redirect('/zlecenia/nowy?blad=1');

  const result = await createJob(ctx, {
    title,
    description: null,
    customerId,
    addressId: formData.get('addressId') ? String(formData.get('addressId')) : null,
    crewId: formData.get('crewId') ? String(formData.get('crewId')) : null,
    scheduledStart: parseDate(formData.get('scheduledStart')),
    scheduledEnd: parseDate(formData.get('scheduledEnd')),
    estimatedMinutes: Number(formData.get('estimatedMinutes') ?? 0) || undefined,
    notes: String(formData.get('notes') ?? '') || null,
    assignedUserIds: formData.getAll('assignedUserIds').map(String),
  });

  if (!result.ok) redirect(`/zlecenia/nowy?blad=${encodeURIComponent(result.error)}`);

  await enqueueAutomations({ organizationId: context.organization.id, trigger: 'JOB_CREATED', targetType: 'job', targetId: result.data!.id });

  revalidatePath('/zlecenia');
  redirect(`/zlecenia/${result.data!.id}`);
}

/** Planowanie: termin + ekipa. Kolizje są zwracane, a nie przemilczane. */
export async function scheduleJobAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:assign');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const jobId = String(formData.get('jobId') ?? '');
  const start = parseDate(formData.get('scheduledStart'));
  const end = parseDate(formData.get('scheduledEnd'));
  const crewId = formData.get('crewId') ? String(formData.get('crewId')) : null;

  if (start && end && end <= start) {
    backTo(jobId, { blad: 'Data zakończenia musi być późniejsza niż rozpoczęcia.' });
  }

  const result = await scheduleJob(ctx, jobId, { scheduledStart: start, scheduledEnd: end, crewId });
  if (!result.ok) backTo(jobId, { blad: result.error });

  const conflicts = result.data?.conflicts ?? [];
  if (conflicts.length > 0) {
    revalidatePath(`/zlecenia/${jobId}`);
    backTo(jobId, { kolizja: conflicts.map((conflict) => conflict.number).join(', ') });
  }

  await enqueueAutomations({ organizationId: context.organization.id, trigger: 'JOB_SCHEDULED', targetType: 'job', targetId: jobId });

  revalidatePath(`/zlecenia/${jobId}`);
  backTo(jobId, { wynik: 'zaplanowano' });
}

export async function updateJobStatusAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const jobId = String(formData.get('jobId') ?? '');
  const status = String(formData.get('status') ?? '') as never;
  const note = String(formData.get('note') ?? '') || null;

  const result = await updateJobStatus(ctx, jobId, status, note);
  if (!result.ok) backTo(jobId, { blad: result.error });

  if (status === 'COMPLETED') {
    await enqueueAutomations({ organizationId: context.organization.id, trigger: 'JOB_COMPLETED', targetType: 'job', targetId: jobId });
  }
  if (status === 'NO_SHOW') {
    await enqueueAutomations({ organizationId: context.organization.id, trigger: 'JOB_NO_SHOW', targetType: 'job', targetId: jobId });
  }

  revalidatePath(`/zlecenia/${jobId}`);
  revalidatePath('/zlecenia');
  backTo(jobId, { wynik: 'status' });
}

export async function completeJobAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const jobId = String(formData.get('jobId') ?? '');
  const note = String(formData.get('note') ?? '') || null;

  const result = await completeJob(ctx, jobId, { note });
  if (!result.ok) backTo(jobId, { blad: result.error });

  await enqueueAutomations({ organizationId: context.organization.id, trigger: 'JOB_COMPLETED', targetType: 'job', targetId: jobId });

  revalidatePath(`/zlecenia/${jobId}`);
  revalidatePath('/zlecenia');
  backTo(jobId, { wynik: 'zakonczono' });
}

export async function assignJobPeopleAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:assign');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const jobId = String(formData.get('jobId') ?? '');

  const result = await assignJobPeople(
    ctx,
    jobId,
    formData.getAll('assignedUserIds').map(String).filter(Boolean),
  );

  revalidatePath(`/zlecenia/${jobId}`);
  backTo(jobId, result.ok ? { wynik: 'przypisano' } : { blad: result.error });
}

export async function addJobNoteAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const jobId = String(formData.get('jobId') ?? '');
  const body = String(formData.get('body') ?? '').trim();

  if (!body) backTo(jobId, { blad: 'Notatka nie może być pusta.' });

  const result = await addJobNote(ctx, jobId, body);
  revalidatePath(`/zlecenia/${jobId}`);
  backTo(jobId, result.ok ? { wynik: 'notatka' } : { blad: result.error });
}

/** Zdjęcie jest wgrywane przez /api/pliki, a tu tylko wiązane ze zleceniem. */
export async function addJobPhotoAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const jobId = String(formData.get('jobId') ?? '');
  const fileId = String(formData.get('fileId') ?? '');
  const type = (String(formData.get('type') ?? 'OTHER') || 'OTHER') as 'BEFORE' | 'DURING' | 'AFTER' | 'OTHER';
  const caption = String(formData.get('caption') ?? '') || undefined;

  if (!fileId) backTo(jobId, { blad: 'Nie wybrano zdjęcia.' });

  const result = await addJobPhoto(ctx, jobId, fileId, type, caption);
  revalidatePath(`/zlecenia/${jobId}`);
  backTo(jobId, result.ok ? { wynik: 'zdjecie' } : { blad: result.error });
}

export async function toggleChecklistItemAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const jobId = String(formData.get('jobId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  const done = String(formData.get('done') ?? '') !== 'false';

  const result = await toggleChecklistItem(ctx, jobId, itemId, done);
  revalidatePath(`/zlecenia/${jobId}`);
  backTo(jobId, result.ok ? { wynik: 'checklista' } : { blad: result.error });
}

async function jobOf(jobId: string) {
  return jobId;
}

export async function startTimeEntryAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const jobId = await jobOf(String(formData.get('jobId') ?? ''));

  const result = await startTimeEntry(ctx, jobId);
  revalidatePath(`/zlecenia/${jobId}`);
  backTo(jobId, result.ok ? { wynik: 'czas-start' } : { blad: result.error });
}

export async function pauseTimeEntryAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const jobId = String(formData.get('jobId') ?? '');

  const result = await pauseTimeEntry(ctx, jobId);
  revalidatePath(`/zlecenia/${jobId}`);
  backTo(jobId, result.ok ? { wynik: 'czas-pauza' } : { blad: result.error });
}

export async function resumeTimeEntryAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const jobId = String(formData.get('jobId') ?? '');

  const result = await resumeTimeEntry(ctx, jobId);
  revalidatePath(`/zlecenia/${jobId}`);
  backTo(jobId, result.ok ? { wynik: 'czas-wznowiono' } : { blad: result.error });
}

export async function stopTimeEntryAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const jobId = String(formData.get('jobId') ?? '');

  const result = await stopTimeEntry(ctx, jobId);
  revalidatePath(`/zlecenia/${jobId}`);
  backTo(jobId, result.ok ? { wynik: 'czas-stop' } : { blad: result.error });
}
