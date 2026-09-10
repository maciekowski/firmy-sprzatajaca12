import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Camera, Check, Play, Square, Timer } from 'lucide-react';
import { requireJobExecutionAccess } from '@/lib/auth/guards';
import { getActiveTimeEntry, getJob } from '@/lib/services/jobs';
import { getJobChecklists, getJobNotesWithAuthors, getJobPhotosWithFiles } from '@/lib/data/jobs';
import { db } from '@/lib/db/client';
import { customers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { Badge, Card, CardBody, CardHeader, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import {
  addJobNoteAction,
  completeJobAction,
  pauseTimeEntryAction,
  resumeTimeEntryAction,
  startTimeEntryAction,
  stopTimeEntryAction,
  toggleChecklistItemAction,
  updateJobStatusAction,
} from '@/app/(app)/zlecenia/actions';
import { formatDateTime, JOB_STATUSES, PHOTO_TYPES } from '@/lib/constants';

export const metadata = { title: 'Realizacja zlecenia' };

/** Widok mobilny dla pracownika w terenie: duże przyciski, obsługa jedną ręką. */
export default async function JobExecutionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ blad?: string }>;
}) {
  const { id } = await params;
  const { blad } = await searchParams;
  // pracownik może realizować zlecenie tylko wtedy, gdy jest do niego przypisany
  const context = await requireJobExecutionAccess(id);

  const job = await getJob(context.organization.id, id);
  if (!job) notFound();

  const [photos, notes, checklists, activeEntry, customerRows] = await Promise.all([
    getJobPhotosWithFiles(context.organization.id, id),
    getJobNotesWithAuthors(id),
    getJobChecklists(id),
    getActiveTimeEntry(id, context.user.id),
    db.select().from(customers).where(eq(customers.id, job.customerId)).limit(1),
  ]);

  const customer = customerRows[0];
  const isDone = job.status === 'COMPLETED' || job.status === 'CANCELLED' || job.status === 'NO_SHOW';
  const statusLabel = JOB_STATUSES.find((item) => item.value === job.status)?.label ?? job.status;

  const nextStatuses: Record<string, string[]> = {
    UNSCHEDULED: ['SCHEDULED'],
    SCHEDULED: ['EN_ROUTE'],
    CONFIRMED: ['EN_ROUTE'],
    EN_ROUTE: ['ON_SITE', 'NO_SHOW'],
    ON_SITE: ['IN_PROGRESS'],
    IN_PROGRESS: [],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
  };

  return (
    <div className="mx-auto max-w-xl px-4 pb-28 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <Link href={`/zlecenia/${job.id}`} className="inline-flex items-center gap-1 text-sm text-ink-600">
          <ArrowLeft className="h-4 w-4" /> Szczegóły
        </Link>
        <Badge tone={job.status === 'COMPLETED' ? 'success' : 'info'}>{statusLabel}</Badge>
      </div>

      <h1 className="text-xl font-semibold tracking-tight text-ink-900">{job.title}</h1>
      <p className="text-sm text-ink-600">
        {customer?.displayName}
        {job.addressCity ? ` · ${[job.addressStreet, job.addressCity].filter(Boolean).join(', ')}` : ''}
      </p>
      {customer?.phone ? (
        <a href={`tel:${customer.phone}`} className="mt-1 inline-block text-sm font-medium text-brand-700">
          Zadzwoń: {customer.phone}
        </a>
      ) : null}

      {blad ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
      ) : null}

      {!isDone ? (
        <Card className="mt-4">
          <CardHeader title="Status" />
          <CardBody className="grid gap-2">
            {(nextStatuses[job.status] ?? []).map((statusValue) => (
              <form key={statusValue} action={updateJobStatusAction}>
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="status" value={statusValue} />
                <SubmitButton className="w-full py-4 text-base">
                  {JOB_STATUSES.find((item) => item.value === statusValue)?.label ?? statusValue}
                </SubmitButton>
              </form>
            ))}
            {nextStatuses[job.status]?.length === 0 && job.status === 'IN_PROGRESS' ? (
              <p className="text-sm text-ink-600">Praca w toku — zakończ zlecenie na dole ekranu.</p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader title="Czas pracy" />
        <CardBody className="space-y-3">
          <div className="flex gap-2">
            {!activeEntry ? (
              <form action={startTimeEntryAction} className="flex-1">
                <input type="hidden" name="jobId" value={job.id} />
                <SubmitButton className="w-full py-4">
                  <Play className="h-5 w-5" /> Start
                </SubmitButton>
              </form>
            ) : (
              <>
                {activeEntry.status === 'RUNNING' ? (
                  <form action={pauseTimeEntryAction} className="flex-1">
                    <input type="hidden" name="jobId" value={job.id} />
                    <SubmitButton variant="secondary" className="w-full py-4">
                      Pauza
                    </SubmitButton>
                  </form>
                ) : (
                  <form action={resumeTimeEntryAction} className="flex-1">
                    <input type="hidden" name="jobId" value={job.id} />
                    <SubmitButton variant="secondary" className="w-full py-4">
                      Wznów
                    </SubmitButton>
                  </form>
                )}
                <form action={stopTimeEntryAction} className="flex-1">
                  <input type="hidden" name="jobId" value={job.id} />
                  <SubmitButton variant="danger" className="w-full py-4">
                    <Square className="h-5 w-5" /> Stop
                  </SubmitButton>
                </form>
              </>
            )}
          </div>
          {activeEntry ? (
            <p className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
              <Timer className="h-4 w-4" />
              {activeEntry.status === 'PAUSED' ? 'Wstrzymany' : 'Licznik działa'} od {formatDateTime(activeEntry.startedAt)}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Checklista" />
        <CardBody className="space-y-3">
          {checklists.length === 0 ? (
            <p className="text-sm text-ink-500">Brak checklisty.</p>
          ) : (
            checklists.map((list) => (
              <div key={list.id} className="space-y-2">
                <p className="text-sm font-medium text-ink-900">{list.name}</p>
                {list.items.map((item) => (
                  <form key={item.id} action={toggleChecklistItemAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="done" value={item.isDone ? 'false' : 'true'} />
                    <button
                      type="submit"
                      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-4 text-left text-base ${
                        item.isDone ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-ink-200 bg-white text-ink-900'
                      }`}
                    >
                      <span
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                          item.isDone ? 'bg-emerald-500 text-white' : 'border border-ink-300'
                        }`}
                      >
                        {item.isDone ? <Check className="h-4 w-4" /> : null}
                      </span>
                      <span className={item.isDone ? 'line-through' : ''}>{item.label}</span>
                    </button>
                  </form>
                ))}
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {!isDone ? (
        <Card className="mt-4">
          <CardHeader title="Zdjęcia" />
          <CardBody className="space-y-3">
            {[
              { type: 'BEFORE', label: 'Zrób zdjęcie „przed”' },
              { type: 'AFTER', label: 'Zrób zdjęcie „po”' },
            ].map((action) => (
              <form
                key={action.type}
                action={`/api/zlecenia/${job.id}/zdjecia`}
                method="post"
                encType="multipart/form-data"
                className="flex items-center gap-2"
              >
                <input type="hidden" name="type" value={action.type} />
                <label className="flex-1">
                  <span className="sr-only">{action.label}</span>
                  <input
                    type="file"
                    name="plik"
                    accept="image/*"
                    capture="environment"
                    required
                    className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-3 file:text-sm file:font-medium file:text-brand-700"
                  />
                </label>
                <SubmitButton variant="secondary" className="py-3">
                  <Camera className="h-4 w-4" /> Wyślij
                </SubmitButton>
              </form>
            ))}

            {photos.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo) => (
                  <figure key={photo.id} className="overflow-hidden rounded-lg border border-ink-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/pliki/${photo.fileId}`} alt={photo.caption ?? photo.originalName} className="h-20 w-full object-cover" />
                    <figcaption className="px-1 py-0.5 text-[11px] text-ink-500">
                      {PHOTO_TYPES.find((type) => type.value === photo.type)?.label ?? photo.type}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader title="Notatka" />
        <CardBody>
          <form action={addJobNoteAction} className="space-y-2">
            <input type="hidden" name="jobId" value={job.id} />
            <Textarea name="body" rows={3} placeholder="Co trzeba przekazać dalej?" required />
            <SubmitButton variant="secondary" className="w-full py-3">
              Dodaj notatkę
            </SubmitButton>
          </form>
          {notes.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {notes.map((note) => (
                <li key={note.id} className="rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800">
                  {note.body}
                  <span className="mt-1 block text-xs text-ink-500">
                    {formatDateTime(note.createdAt)} · {note.authorUserName ?? note.authorName ?? 'system'}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      {job.status === 'IN_PROGRESS' ? (
        <Card className="mt-4">
          <CardHeader title="Zakończenie" />
          <CardBody>
            <form action={completeJobAction} className="space-y-2">
              <input type="hidden" name="jobId" value={job.id} />
              <Textarea name="note" rows={3} placeholder="Notatka końcowa (wymagana, jeśli firma tego wymaga)" />
              <SubmitButton variant="success" className="w-full py-4 text-base" confirm="Zakończyć zlecenie?">
                Zakończ zlecenie
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
