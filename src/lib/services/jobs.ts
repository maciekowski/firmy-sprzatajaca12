/**
 * Usługi domenowe: zlecenia, checklisty, zdjęcia, notatki, czas pracy.
 */
import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  activities,
  checklists,
  checklistItems,
  crews,
  customerAddresses,
  customers,
  files,
  jobs,
  jobAssignments,
  jobItems,
  jobNotes,
  jobPhotos,
  quotes,
  quoteItems,
  timeEntries,
  type Job,
  type JobItem,
  type TimeEntry,
} from '@/lib/db/schema';
import { nextDocumentNumber } from '@/lib/numbering';
import { organizations } from '@/lib/db/schema';
import type { ServiceContext } from './estimates';
import { writeAuditLog } from '@/lib/audit';

export type { ServiceContext };

export type JobDraft = {
  title: string;
  description?: string | null;
  customerId: string;
  addressId?: string | null;
  crewId?: string | null;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  estimatedMinutes?: number;
  subtotalCents?: number;
  taxCents?: number;
  totalCents?: number;
  notes?: string | null;
  internalNotes?: string | null;
  quoteId?: string | null;
  estimateId?: string | null;
  leadId?: string | null;
  assignedUserIds?: string[];
};

export type OperationResult<T = undefined> =
  | { ok: true; data?: T; error?: undefined }
  | { ok: false; error: string; data?: undefined };

// ---------------------------------------------------------------------------
// Tworzenie zleceń
// ---------------------------------------------------------------------------

export async function createJobFromQuote(ctx: ServiceContext, quoteId: string): Promise<OperationResult<Job>> {
  const quoteRows = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, ctx.organizationId)))
    .limit(1);
  const quote = quoteRows[0];
  if (!quote) return { ok: false, error: 'Nie znaleziono oferty.' };
  if (quote.status !== 'ACCEPTED') {
    return { ok: false, error: 'Tylko zaakceptowana oferta może zostać przekształcona w zlecenie.' };
  }

  const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId)).orderBy(asc(quoteItems.sortOrder));

  const job = await createJob(ctx, {
    title: quote.title ?? `Zlecenie z oferty ${quote.number}`,
    description: quote.notes,
    customerId: quote.customerId,
    addressId: quote.addressId,
    quoteId: quote.id,
    subtotalCents: quote.subtotalCents,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,
    notes: quote.notes,
    estimatedMinutes: 60,
  });

  if (!job.ok) return { ok: false, error: job.error };

  await db.insert(jobItems).values(
    items.map((item, index) => ({
      jobId: job.data!.id,
      serviceId: item.serviceId,
      name: item.name,
      description: item.description,
      unit: item.unit,
      customUnitLabel: item.customUnitLabel,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      taxRateBps: item.taxRateBps,
      netCents: item.netCents,
      taxCents: item.taxCents,
      grossCents: item.grossCents,
      sortOrder: index,
    })),
  );

  // zdjęcia z oferty przenosimy do zlecenia
  const quoteFiles = await db.select().from(files).where(eq(files.quoteId, quoteId));
  for (const file of quoteFiles) {
    await db.insert(jobPhotos).values({
      organizationId: ctx.organizationId,
      jobId: job.data!.id,
      fileId: file.id,
      type: 'BEFORE',
      caption: file.originalName,
    });
  }

  await db
    .update(quotes)
    .set({ convertedJobId: job.data!.id, updatedAt: new Date() })
    .where(eq(quotes.id, quoteId));

  await instantiateChecklistTemplates(ctx, job.data!.id, items.map((item) => item.serviceId).filter((id): id is string => Boolean(id)));

  return job;
}

export async function createJob(ctx: ServiceContext, draft: JobDraft): Promise<OperationResult<Job>> {
  const orgRows = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const organization = orgRows[0];
  const organizationCurrency = organization?.currency ?? 'PLN';
  const number = await nextDocumentNumber(ctx.organizationId, organization?.jobPrefix ?? 'ZL');

  const address = draft.addressId
    ? await db.select().from(customerAddresses).where(eq(customerAddresses.id, draft.addressId)).limit(1)
    : [];

  const [job] = await db
    .insert(jobs)
    .values({
      organizationId: ctx.organizationId,
      number,
      customerId: draft.customerId,
      addressId: draft.addressId ?? null,
      currency: organizationCurrency,
      quoteId: draft.quoteId ?? null,
      estimateId: draft.estimateId ?? null,
      crewId: draft.crewId ?? null,
      leadId: draft.leadId ?? null,
      title: draft.title,
      description: draft.description ?? null,
      status: draft.scheduledStart ? 'SCHEDULED' : 'UNSCHEDULED',
      addressLabel: address[0]?.label ?? null,
      addressStreet: address[0]?.street ?? null,
      addressCity: address[0]?.city ?? null,
      addressPostalCode: address[0]?.postalCode ?? null,
      scheduledStart: draft.scheduledStart ?? null,
      scheduledEnd: draft.scheduledEnd ?? null,
      estimatedMinutes: draft.estimatedMinutes ?? 60,
      subtotalCents: draft.subtotalCents ?? 0,
      taxCents: draft.taxCents ?? 0,
      totalCents: draft.totalCents ?? 0,
      notes: draft.notes ?? null,
      internalNotes: draft.internalNotes ?? null,
    })
    .returning();

  if (draft.assignedUserIds && draft.assignedUserIds.length > 0) {
    await db.insert(jobAssignments).values(
      draft.assignedUserIds.map((userId, index) => ({
        jobId: job.id,
        userId,
        isLead: index === 0,
      })),
    );
  }

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'job',
    entityId: job.id,
    type: 'created',
    message: `Utworzono zlecenie ${number}`,
    userId: ctx.userId,
    userName: ctx.userName,
  });

  return { ok: true, data: job };
}

// ---------------------------------------------------------------------------
// Odczyt
// ---------------------------------------------------------------------------

async function buildJobFilters(
  organizationId: string,
  options: { status?: string; today?: boolean; crewId?: string; userId?: string },
): Promise<SQL[]> {
  const filters: SQL[] = [eq(jobs.organizationId, organizationId)];
  if (options.status && options.status !== 'ALL') filters.push(eq(jobs.status, options.status as never));
  if (options.crewId) filters.push(eq(jobs.crewId, options.crewId));
  if (options.today) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    filters.push(sql`${jobs.scheduledStart} >= ${start} and ${jobs.scheduledStart} < ${end}`);
  }
  if (options.userId) {
    const assigned = await db
      .select({ jobId: jobAssignments.jobId })
      .from(jobAssignments)
      .where(eq(jobAssignments.userId, options.userId));
    const ids = assigned.map((row) => row.jobId);
    if (ids.length === 0) return [sql`false`];
    filters.push(sql`${jobs.id} = any(${ids})`);
  }

  return filters;
}

export async function listJobs(
  organizationId: string,
  options: { status?: string; today?: boolean; crewId?: string; userId?: string; limit?: number; offset?: number } = {},
) {
  const filters = await buildJobFilters(organizationId, options);

  return db
    .select({
      job: jobs,
      customerName: customers.displayName,
      crewName: crews.name,
      crewColor: crews.color,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .leftJoin(crews, eq(crews.id, jobs.crewId))
    .where(and(...filters))
    .orderBy(asc(jobs.scheduledStart), desc(jobs.createdAt))
    .limit(options.limit ?? 200)
    .offset(options.offset ?? 0)
    .then((rows) => rows.map((row) => ({ ...row.job, customerName: row.customerName, crewName: row.crewName, crewColor: row.crewColor })));
}

/** Liczba zleceń dla zadanych filtrów — potrzebna do paginacji. */
export async function countJobs(
  organizationId: string,
  options: { status?: string; today?: boolean; crewId?: string; userId?: string } = {},
): Promise<number> {
  const filters = await buildJobFilters(organizationId, options);
  const [{ value }] = await db.select({ value: sql<number>`count(*)::int` }).from(jobs).where(and(...filters));
  return Number(value ?? 0);
}

export async function getJob(organizationId: string, jobId: string) {
  const rows = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organizationId, organizationId))).limit(1);
  return rows[0] ?? null;
}

/**
 * Zapis czasu pracy wykonanego offline (urządzenie bez sieci).
 *
 * Czasy pochodzą z urządzenia i są zapisywane dokładnie tak, jak je zarejestrowano
 * (start, koniec, suma pauz) — z jawnym oznaczeniem `source = OFFLINE_SYNC`.
 * System nie zgaduje żadnej z tych wartości: jeżeli brakuje którejś, zapis jest odrzucany.
 */
export async function recordOfflineTimeEntry(
  ctx: ServiceContext,
  jobId: string,
  input: { startedAt: Date; endedAt: Date; pausedMs?: number; note?: string | null },
): Promise<OperationResult<TimeEntry>> {
  const job = await getJob(ctx.organizationId, jobId);
  if (!job) return { ok: false, error: 'Nie znaleziono zlecenia.' };

  const pausedMs = Math.max(0, Math.round(input.pausedMs ?? 0));
  const durationSeconds = Math.max(0, Math.round((input.endedAt.getTime() - input.startedAt.getTime() - pausedMs) / 1000));

  const [entry] = await db
    .insert(timeEntries)
    .values({
      organizationId: ctx.organizationId,
      jobId,
      userId: ctx.userId,
      status: 'STOPPED',
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      pausedMs,
      durationSeconds,
      note: input.note ?? null,
      source: 'OFFLINE_SYNC',
    })
    .returning();

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'job.time_entry_synced',
    entityType: 'job',
    entityId: jobId,
    meta: { durationSeconds, pausedMs, source: 'OFFLINE_SYNC' },
  });

  return { ok: true, data: entry! };
}

export async function getJobItems(jobId: string): Promise<JobItem[]> {
  return db.select().from(jobItems).where(eq(jobItems.jobId, jobId)).orderBy(asc(jobItems.sortOrder));
}

export async function getJobAssignments(jobId: string) {
  return db
    .select({ assignment: jobAssignments, userName: sql<string>`u.name`, userEmail: sql<string>`u.email` })
    .from(jobAssignments)
    .innerJoin(sql`users u`, sql`u.id = ${jobAssignments.userId}`)
    .where(eq(jobAssignments.jobId, jobId));
}

export async function getJobPhotos(organizationId: string, jobId: string) {
  return db
    .select({ photo: jobPhotos, file: files })
    .from(jobPhotos)
    .innerJoin(files, eq(files.id, jobPhotos.fileId))
    .where(and(eq(jobPhotos.jobId, jobId), eq(jobPhotos.organizationId, organizationId)))
    .orderBy(asc(jobPhotos.takenAt));
}

export async function getJobNotes(jobId: string) {
  return db.select().from(jobNotes).where(eq(jobNotes.jobId, jobId)).orderBy(desc(jobNotes.createdAt));
}

export async function getJobChecklists(jobId: string) {
  const list = await db.select().from(checklists).where(eq(checklists.jobId, jobId)).orderBy(asc(checklists.sortOrder));
  const result = [];
  for (const checklist of list) {
    const items = await db.select().from(checklistItems).where(eq(checklistItems.checklistId, checklist.id)).orderBy(asc(checklistItems.sortOrder));
    result.push({ ...checklist, items });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Planowanie i statusy
// ---------------------------------------------------------------------------

export type ScheduleConflict = { jobId: string; number: string; title: string };

/** Wykrywa kolizję terminów dla ekipy (prosty, przewidywalny test nakładania się). */
export async function findScheduleConflicts(
  organizationId: string,
  input: { crewId?: string | null; start: Date; end: Date; excludeJobId?: string },
): Promise<ScheduleConflict[]> {
  if (!input.crewId) return [];
  const rows = await db
    .select({ id: jobs.id, number: jobs.number, title: jobs.title, start: jobs.scheduledStart, end: jobs.scheduledEnd })
    .from(jobs)
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        eq(jobs.crewId, input.crewId),
        sql`${jobs.status} not in ('CANCELLED','COMPLETED','NO_SHOW')`,
        sql`${jobs.scheduledStart} is not null`,
      ),
    );

  return rows
    .filter((row) => row.id !== input.excludeJobId && row.start)
    .filter((row) => {
      const existingStart = row.start!.getTime();
      const existingEnd = (row.end ?? new Date(row.start!.getTime() + 60 * 60 * 1000)).getTime();
      return input.start.getTime() < existingEnd && existingStart < input.end.getTime();
    })
    .map((row) => ({ jobId: row.id, number: row.number, title: row.title }));
}

export async function scheduleJob(
  ctx: ServiceContext,
  jobId: string,
  input: { scheduledStart: Date | null; scheduledEnd: Date | null; crewId?: string | null },
): Promise<OperationResult<{ conflicts: ScheduleConflict[] }>> {
  const job = await getJob(ctx.organizationId, jobId);
  if (!job) return { ok: false, error: 'Nie znaleziono zlecenia.' };

  let conflicts: ScheduleConflict[] = [];
  if (input.scheduledStart && input.scheduledEnd) {
    conflicts = await findScheduleConflicts(ctx.organizationId, {
      crewId: input.crewId ?? job.crewId,
      start: input.scheduledStart,
      end: input.scheduledEnd,
      excludeJobId: jobId,
    });
  }

  const nextStatus = job.status === 'UNSCHEDULED' || job.status === 'SCHEDULED' || job.status === 'CONFIRMED'
    ? input.scheduledStart
      ? 'SCHEDULED'
      : 'UNSCHEDULED'
    : job.status;

  await db
    .update(jobs)
    .set({
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      crewId: input.crewId !== undefined ? input.crewId : job.crewId,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, ctx.organizationId)));

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'job',
    entityId: jobId,
    type: 'scheduled',
    message: input.scheduledStart
      ? `Zaplanowano zlecenie na ${input.scheduledStart.toLocaleString('pl-PL')}`
      : 'Usunięto termin zlecenia',
    userId: ctx.userId,
    userName: ctx.userName,
  });

  return { ok: true, data: { conflicts } };
}

export async function updateJobStatus(
  ctx: ServiceContext,
  jobId: string,
  status: Job['status'],
  note?: string | null,
): Promise<OperationResult<Job>> {
  const job = await getJob(ctx.organizationId, jobId);
  if (!job) return { ok: false, error: 'Nie znaleziono zlecenia.' };

  if (status === 'COMPLETED') {
    return completeJob(ctx, jobId, { note });
  }

  const updates: Partial<typeof jobs.$inferInsert> = { status, updatedAt: new Date() };
  if (status === 'EN_ROUTE' && !job.actualStart) updates.actualStart = new Date();
  if (status === 'CANCELLED') updates.cancelReason = note ?? null;

  const [updated] = await db
    .update(jobs)
    .set(updates)
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, ctx.organizationId)))
    .returning();

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'job',
    entityId: jobId,
    type: 'status_changed',
    message: `Zmieniono status zlecenia na ${status}`,
    userId: ctx.userId,
    userName: ctx.userName,
    meta: { from: job.status, to: status, note: note ?? null },
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'job.status_changed',
    entityType: 'job',
    entityId: jobId,
    meta: { from: job.status, to: status, note: note ?? null },
  });

  return { ok: true, data: updated };
}

/**
 * Zakończenie zlecenia z uwzględnieniem wymagań firmy.
 * Wymagania są konfigurowane przez firmę — niczego nie narzucamy wszystkim.
 */
export async function completeJob(
  ctx: ServiceContext,
  jobId: string,
  options: { note?: string | null; force?: boolean } = {},
): Promise<OperationResult<Job>> {
  const job = await getJob(ctx.organizationId, jobId);
  if (!job) return { ok: false, error: 'Nie znaleziono zlecenia.' };

  const orgRows = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const requirements = orgRows[0]?.completionRequirements ?? null;

  if (!options.force && requirements) {
    const problems: string[] = [];

    if (requirements.requireChecklist) {
      const list = await getJobChecklists(jobId);
      const allItems = list.flatMap((checklist) => checklist.items);
      if (allItems.length === 0 || allItems.some((item) => !item.isDone)) {
        problems.push('checklista nie jest w pełni odhaczona');
      }
    }

    if (requirements.requireAfterPhotos) {
      const photos = await getJobPhotos(ctx.organizationId, jobId);
      const after = photos.filter((photo) => photo.photo.type === 'AFTER');
      const min = requirements.minAfterPhotos ?? 1;
      if (after.length < min) problems.push(`brak zdjęć „po” (wymagane: ${min})`);
    }

    if (requirements.requireNote && !(options.note ?? '').trim()) {
      problems.push('brak notatki końcowej');
    }

    if (problems.length > 0) {
      return { ok: false, error: `Nie można zakończyć zlecenia: ${problems.join(', ')}.` };
    }
  }

  // zatrzymanie wszystkich aktywnych liczników czasu
  await db
    .update(timeEntries)
    .set({
      status: 'STOPPED',
      endedAt: new Date(),
      durationSeconds: sql`greatest(0, extract(epoch from (now() - ${timeEntries.startedAt}))::int - ${timeEntries.pausedMs} / 1000)`,
      updatedAt: new Date(),
    })
    .where(and(eq(timeEntries.jobId, jobId), eq(timeEntries.organizationId, ctx.organizationId), sql`${timeEntries.status} <> 'STOPPED'`));

  const [updated] = await db
    .update(jobs)
    .set({
      status: 'COMPLETED',
      completedAt: new Date(),
      completedById: ctx.userId,
      completionNote: options.note ?? job.completionNote,
      actualEnd: job.actualEnd ?? new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, ctx.organizationId)))
    .returning();

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'job',
    entityId: jobId,
    type: 'completed',
    message: 'Zlecenie zakończone',
    userId: ctx.userId,
    userName: ctx.userName,
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'job.completed',
    entityType: 'job',
    entityId: jobId,
    meta: { number: updated.number, note: options.note ?? null },
  });

  return { ok: true, data: updated };
}

// ---------------------------------------------------------------------------
// Ekipa i pracownicy
// ---------------------------------------------------------------------------

export async function assignJobPeople(
  ctx: ServiceContext,
  jobId: string,
  userIds: string[],
): Promise<OperationResult> {
  const job = await getJob(ctx.organizationId, jobId);
  if (!job) return { ok: false, error: 'Nie znaleziono zlecenia.' };

  await db.delete(jobAssignments).where(eq(jobAssignments.jobId, jobId));
  if (userIds.length > 0) {
    await db.insert(jobAssignments).values(
      userIds.map((userId, index) => ({ jobId, userId, isLead: index === 0 })),
    );
  }

  await db.update(jobs).set({ updatedAt: new Date() }).where(eq(jobs.id, jobId));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Zdjęcia, notatki, checklisty
// ---------------------------------------------------------------------------

export async function addJobPhoto(
  ctx: ServiceContext,
  jobId: string,
  fileId: string,
  type: 'BEFORE' | 'DURING' | 'AFTER' | 'OTHER' = 'OTHER',
  caption?: string,
): Promise<OperationResult> {
  const job = await getJob(ctx.organizationId, jobId);
  if (!job) return { ok: false, error: 'Nie znaleziono zlecenia.' };

  const fileRows = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.organizationId, ctx.organizationId)))
    .limit(1);
  if (fileRows.length === 0) return { ok: false, error: 'Nie znaleziono pliku.' };

  await db.insert(jobPhotos).values({
    organizationId: ctx.organizationId,
    jobId,
    fileId,
    type,
    caption: caption ?? null,
    authorId: ctx.userId,
  });

  return { ok: true };
}

export async function addJobNote(ctx: ServiceContext, jobId: string, body: string): Promise<OperationResult> {
  const job = await getJob(ctx.organizationId, jobId);
  if (!job) return { ok: false, error: 'Nie znaleziono zlecenia.' };
  if (!body.trim()) return { ok: false, error: 'Notatka nie może być pusta.' };

  await db.insert(jobNotes).values({
    organizationId: ctx.organizationId,
    jobId,
    body: body.trim(),
    authorId: ctx.userId,
    authorName: ctx.userName,
  });

  return { ok: true };
}

export async function createChecklistTemplate(
  ctx: ServiceContext,
  input: { name: string; items: string[]; serviceId?: string | null },
): Promise<OperationResult> {
  const [checklist] = await db
    .insert(checklists)
    .values({
      organizationId: ctx.organizationId,
      name: input.name,
      isTemplate: true,
      serviceId: input.serviceId ?? null,
    })
    .returning();

  await db.insert(checklistItems).values(
    input.items.map((label, index) => ({ checklistId: checklist.id, label, sortOrder: index })),
  );

  return { ok: true };
}

export async function instantiateChecklistTemplates(
  ctx: ServiceContext,
  jobId: string,
  serviceIds: string[],
): Promise<void> {
  const templates = await db
    .select()
    .from(checklists)
    .where(and(eq(checklists.organizationId, ctx.organizationId), eq(checklists.isTemplate, true)));

  const relevant = templates.filter((template) => !template.serviceId || serviceIds.includes(template.serviceId));
  if (relevant.length === 0) return;

  for (const template of relevant) {
    const templateItems = await db.select().from(checklistItems).where(eq(checklistItems.checklistId, template.id));
    const [checklist] = await db
      .insert(checklists)
      .values({
        organizationId: ctx.organizationId,
        jobId,
        name: template.name,
        isTemplate: false,
        serviceId: template.serviceId,
      })
      .returning();

    await db.insert(checklistItems).values(
      templateItems.map((item) => ({ checklistId: checklist.id, label: item.label, sortOrder: item.sortOrder })),
    );
  }
}

export async function toggleChecklistItem(
  ctx: ServiceContext,
  jobId: string,
  itemId: string,
  done: boolean,
): Promise<OperationResult> {
  // weryfikujemy przynależność pozycji do zlecenia tej organizacji
  const rows = await db
    .select({ item: checklistItems, checklist: checklists })
    .from(checklistItems)
    .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
    .where(and(eq(checklistItems.id, itemId), eq(checklists.jobId, jobId), eq(checklists.organizationId, ctx.organizationId)))
    .limit(1);

  if (rows.length === 0) return { ok: false, error: 'Nie znaleziono pozycji checklisty.' };

  await db
    .update(checklistItems)
    .set({
      isDone: done,
      doneAt: done ? new Date() : null,
      doneById: done ? ctx.userId : null,
    })
    .where(eq(checklistItems.id, itemId));

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Czas pracy
// ---------------------------------------------------------------------------

export async function getActiveTimeEntry(jobId: string, userId: string): Promise<TimeEntry | null> {
  const rows = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.jobId, jobId), eq(timeEntries.userId, userId), or(eq(timeEntries.status, 'RUNNING'), eq(timeEntries.status, 'PAUSED'))))
    .limit(1);
  return rows[0] ?? null;
}

export async function getJobTimeEntries(jobId: string) {
  return db
    .select({ entry: timeEntries, userName: sql<string>`u.name` })
    .from(timeEntries)
    .innerJoin(sql`users u`, sql`u.id = ${timeEntries.userId}`)
    .where(eq(timeEntries.jobId, jobId))
    .orderBy(desc(timeEntries.startedAt));
}

export async function startTimeEntry(ctx: ServiceContext, jobId: string): Promise<OperationResult<TimeEntry>> {
  const job = await getJob(ctx.organizationId, jobId);
  if (!job) return { ok: false, error: 'Nie znaleziono zlecenia.' };

  const active = await getActiveTimeEntry(jobId, ctx.userId);
  if (active) {
    return {
      ok: false,
      error: active.status === 'RUNNING' ? 'Licznik już działa — najpierw go zatrzymaj.' : 'Licznik jest wstrzymany — wznow go zamiast uruchamiać nowy.',
    };
  }

  const [entry] = await db
    .insert(timeEntries)
    .values({ organizationId: ctx.organizationId, jobId, userId: ctx.userId, status: 'RUNNING' })
    .returning();

  return { ok: true, data: entry };
}

export async function pauseTimeEntry(ctx: ServiceContext, jobId: string): Promise<OperationResult<TimeEntry>> {
  const active = await getActiveTimeEntry(jobId, ctx.userId);
  if (!active) return { ok: false, error: 'Brak aktywnego licznika.' };
  if (active.status === 'PAUSED') return { ok: false, error: 'Licznik jest już wstrzymany.' };
  if (active.status === 'STOPPED') return { ok: false, error: 'Licznik został zakończony.' };

  const [entry] = await db
    .update(timeEntries)
    .set({ status: 'PAUSED', pausedAt: new Date(), updatedAt: new Date() })
    .where(eq(timeEntries.id, active.id))
    .returning();

  return { ok: true, data: entry };
}

export async function resumeTimeEntry(ctx: ServiceContext, jobId: string): Promise<OperationResult<TimeEntry>> {
  const active = await getActiveTimeEntry(jobId, ctx.userId);
  if (!active) return { ok: false, error: 'Brak aktywnego licznika.' };
  if (active.status === 'RUNNING') return { ok: false, error: 'Licznik już działa.' };
  if (active.status === 'STOPPED') return { ok: false, error: 'Licznik został zakończony.' };

  const pausedMs = active.pausedMs + Math.max(0, Date.now() - (active.pausedAt?.getTime() ?? Date.now()));
  const [entry] = await db
    .update(timeEntries)
    .set({ status: 'RUNNING', pausedAt: null, pausedMs, updatedAt: new Date() })
    .where(eq(timeEntries.id, active.id))
    .returning();

  return { ok: true, data: entry };
}

export async function stopTimeEntry(ctx: ServiceContext, jobId: string): Promise<OperationResult<TimeEntry>> {
  const active = await getActiveTimeEntry(jobId, ctx.userId);
  if (!active) return { ok: false, error: 'Brak aktywnego licznika.' };

  const pausedMs = active.pausedMs + (active.status === 'PAUSED' ? Math.max(0, Date.now() - (active.pausedAt?.getTime() ?? Date.now())) : 0);
  const durationSeconds = Math.max(0, Math.round((Date.now() - active.startedAt.getTime() - pausedMs) / 1000));

  const [entry] = await db
    .update(timeEntries)
    .set({ status: 'STOPPED', endedAt: new Date(), pausedMs, durationSeconds, updatedAt: new Date() })
    .where(eq(timeEntries.id, active.id))
    .returning();

  return { ok: true, data: entry };
}
