import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, Camera, CheckSquare, ClipboardList, Timer } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { getJob, getJobItems, getActiveTimeEntry } from '@/lib/services/jobs';
import {
  getJobAssignmentsWithUsers,
  getJobChecklists,
  getJobNotesWithAuthors,
  getJobPhotosWithFiles,
  getJobTimeEntriesWithUsers,
  listCrews,
  listMembers,
} from '@/lib/data/jobs';
import { db } from '@/lib/db/client';
import { customers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { Badge, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Stat, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import {
  addJobNoteAction,
  assignJobPeopleAction,
  completeJobAction,
  pauseTimeEntryAction,
  resumeTimeEntryAction,
  scheduleJobAction,
  startTimeEntryAction,
  stopTimeEntryAction,
  toggleChecklistItemAction,
  updateJobStatusAction,
} from '@/app/(app)/zlecenia/actions';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime, formatTime, JOB_STATUSES, JOB_STATUS_TONES, PHOTO_TYPES, unitLabel } from '@/lib/constants';

export const metadata = { title: 'Zlecenie' };

const WYNIK: Record<string, string> = {
  zaplanowano: 'Termin zapisany.',
  status: 'Status zaktualizowany.',
  zakonczono: 'Zlecenie zakończone.',
  przypisano: 'Przypisania zapisane.',
  notatka: 'Notatka dodana.',
  zdjecie: 'Zdjęcie dodane.',
  checklista: 'Checklista zaktualizowana.',
  'czas-start': 'Czas rozpoczęty.',
  'czas-pauza': 'Czas wstrzymany.',
  'czas-wznowiono': 'Czas wznowiony.',
  'czas-stop': 'Czas zatrzymany.',
};

function toLocalInputValue(value: Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wynik?: string; blad?: string; kolizja?: string }>;
}) {
  const context = await requirePermission('job:read');
  const { id } = await params;
  const { wynik, blad, kolizja } = await searchParams;

  const job = await getJob(context.organization.id, id);
  if (!job) notFound();

  const [items, photos, notes, checklists, assignments, timeEntries, crews, members, activeEntry, customerRows] =
    await Promise.all([
      getJobItems(id),
      getJobPhotosWithFiles(context.organization.id, id),
      getJobNotesWithAuthors(id),
      getJobChecklists(id),
      getJobAssignmentsWithUsers(id),
      getJobTimeEntriesWithUsers(id),
      listCrews(context.organization.id),
      listMembers(context.organization.id),
      getActiveTimeEntry(id, context.user.id),
      db.select().from(customers).where(eq(customers.id, job.customerId)).limit(1),
    ]);

  const currency = context.organization.currency;
  const customer = customerRows[0];
  const statusLabel = JOB_STATUSES.find((item) => item.value === job.status)?.label ?? job.status;
  const isDone = job.status === 'COMPLETED' || job.status === 'CANCELLED' || job.status === 'NO_SHOW';

  const nextStatuses: Record<string, string[]> = {
    UNSCHEDULED: ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['CONFIRMED', 'EN_ROUTE', 'CANCELLED'],
    CONFIRMED: ['EN_ROUTE', 'CANCELLED'],
    EN_ROUTE: ['ON_SITE', 'NO_SHOW'],
    ON_SITE: ['IN_PROGRESS'],
    IN_PROGRESS: ['COMPLETED'],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
  };

  return (
    <>
      <PageHeader
        title={job.title}
        description={`${job.number} · ${customer?.displayName ?? '—'} · utworzono ${formatDate(job.createdAt)}`}
        breadcrumbs={
          <Link href="/zlecenia" className="hover:underline">
            Zlecenia
          </Link>
        }
        actions={
          context.can('job:write') ? (
            <Link href={`/zlecenia/${job.id}/wykonanie`} className="btn-primary">
              <Camera className="h-4 w-4" /> Widok realizacji
            </Link>
          ) : null
        }
      />

      <div className="mb-4 space-y-2">
        {wynik && WYNIK[wynik] ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{WYNIK[wynik]}</div>
        ) : null}
        {blad ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
        ) : null}
        {kolizja ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Uwaga: termin nakłada się z innym zleceniem tej ekipy ({kolizja}). Termin został zapisany, ale sprawdź plan.
            </span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Status" value={statusLabel} hint={job.scheduledStart ? `Termin: ${formatDateTime(job.scheduledStart)}` : 'Brak terminu'} />
        <Stat label="Wartość" value={formatMoney(job.totalCents ?? 0, currency)} hint={`Netto ${formatMoney(job.subtotalCents ?? 0, currency)}`} />
        <Stat label="Czas pracy" value={formatDuration(timeEntries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0) || null)} hint={`${timeEntries.length} wpisów`} />
        <Stat label="Zdjęcia" value={String(photos.length)} hint={`Checklista: ${checklists.reduce((sum, list) => sum + list.items.length, 0)} pozycji`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Zakres prac" description={job.description ?? undefined} />
            {items.length === 0 ? (
              <CardBody>
                <p className="text-sm text-ink-500">Zlecenie nie ma pozycji (utworzone ręcznie lub z oferty bez pozycji).</p>
              </CardBody>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nazwa</th>
                      <th>Ilość</th>
                      <th>Cena</th>
                      <th>Netto</th>
                      <th>Brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td className="font-medium text-ink-900">{item.name}</td>
                        <td className="tabular">
                          {String(item.quantity)} {unitLabel(item.unit, item.customUnitLabel)}
                        </td>
                        <td className="tabular">{formatMoney(item.unitPriceCents, currency)}</td>
                        <td className="tabular">{formatMoney(item.netCents, currency)}</td>
                        <td className="tabular font-medium">{formatMoney(item.grossCents, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Checklista realizacji" description="Odhaczaj na bieżąco — wymagania firmy są sprawdzane przy zakończeniu." />
            <CardBody className="space-y-4">
              {checklists.length === 0 ? (
                <p className="text-sm text-ink-500">Brak checklisty dla tego zlecenia.</p>
              ) : (
                checklists.map((list) => {
                  const done = list.items.filter((item) => item.isDone).length;
                  return (
                    <div key={list.id} className="rounded-lg border border-ink-200">
                      <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
                        <p className="text-sm font-medium text-ink-900">{list.name}</p>
                        <span className="text-xs text-ink-500">
                          {done}/{list.items.length}
                        </span>
                      </div>
                      <ul className="divide-y divide-ink-100">
                        {list.items.map((item) => (
                          <li key={item.id}>
                            <form action={toggleChecklistItemAction}>
                              <input type="hidden" name="jobId" value={job.id} />
                              <input type="hidden" name="itemId" value={item.id} />
                              <input type="hidden" name="done" value={item.isDone ? 'false' : 'true'} />
                              <button type="submit" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-50">
                                <span
                                  className={`grid h-5 w-5 shrink-0 place-items-center rounded border text-xs ${
                                    item.isDone ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-ink-300 bg-white'
                                  }`}
                                >
                                  {item.isDone ? '✓' : ''}
                                </span>
                                <span className={item.isDone ? 'text-sm text-ink-500 line-through' : 'text-sm text-ink-900'}>{item.label}</span>
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Zdjęcia z realizacji" description="Wymagane zdjęcia „po” są sprawdzane przy zakończeniu (jeśli firma to włączyła)." />
            <CardBody className="space-y-4">
              {context.can('job:write') && !isDone ? (
                <form action={`/api/zlecenia/${job.id}/zdjecia`} method="post" encType="multipart/form-data" className="flex flex-wrap items-end gap-3">
                  <Field label="Zdjęcie">
                    <input
                      id="plik"
                      name="plik"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      required
                      className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
                    />
                  </Field>
                  <Field label="Typ">
                    <Select id="type" name="type" defaultValue="AFTER">
                      {PHOTO_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Opis">
                    <Input id="caption" name="caption" placeholder="Opcjonalnie" />
                  </Field>
                  <SubmitButton variant="secondary">Dodaj zdjęcie</SubmitButton>
                </form>
              ) : null}

              {photos.length === 0 ? (
                <p className="text-sm text-ink-500">Brak zdjęć.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {photos.map((photo) => (
                    <figure key={photo.id} className="overflow-hidden rounded-lg border border-ink-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/pliki/${photo.fileId}`} alt={photo.caption ?? photo.originalName} className="h-32 w-full object-cover" />
                      <figcaption className="px-2 py-1.5 text-xs text-ink-600">
                        <span className="font-medium text-ink-800">
                          {PHOTO_TYPES.find((type) => type.value === photo.type)?.label ?? photo.type}
                        </span>
                        {photo.caption ? ` · ${photo.caption}` : ''}
                        <span className="block text-ink-400">
                          {formatDateTime(photo.takenAt)}
                          {photo.authorName ? ` · ${photo.authorName}` : ''}
                        </span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Notatki" />
            <CardBody className="space-y-4">
              {context.can('job:write') && !isDone ? (
                <form action={addJobNoteAction} className="space-y-2">
                  <input type="hidden" name="jobId" value={job.id} />
                  <Textarea name="body" rows={2} placeholder="Co się wydarzyło? Co przekazać dalej?" required />
                  <SubmitButton variant="secondary" size="sm">
                    Dodaj notatkę
                  </SubmitButton>
                </form>
              ) : null}

              {notes.length === 0 ? (
                <p className="text-sm text-ink-500">Brak notatek.</p>
              ) : (
                <ul className="space-y-3">
                  {notes.map((note) => (
                    <li key={note.id} className="rounded-lg border border-ink-200 px-3 py-2">
                      <p className="whitespace-pre-wrap text-sm text-ink-800">{note.body}</p>
                      <p className="mt-1 text-xs text-ink-500">
                        {formatDateTime(note.createdAt)} · {note.authorUserName ?? note.authorName ?? 'system'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Termin i ekipa" />
            <CardBody className="space-y-3">
              {context.can('job:assign') ? (
                <form action={scheduleJobAction} className="space-y-3">
                  <input type="hidden" name="jobId" value={job.id} />
                  <Field label="Rozpoczęcie">
                    <Input id="scheduledStart" name="scheduledStart" type="datetime-local" defaultValue={toLocalInputValue(job.scheduledStart)} />
                  </Field>
                  <Field label="Zakończenie">
                    <Input id="scheduledEnd" name="scheduledEnd" type="datetime-local" defaultValue={toLocalInputValue(job.scheduledEnd)} />
                  </Field>
                  <Field label="Ekipa">
                    <Select id="crewId" name="crewId" defaultValue={job.crewId ?? ''}>
                      <option value="">Bez ekipy</option>
                      {crews.map((crew) => (
                        <option key={crew.id} value={crew.id}>
                          {crew.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <SubmitButton className="w-full">Zapisz termin</SubmitButton>
                </form>
              ) : (
                <p className="text-sm text-ink-600">
                  {job.scheduledStart ? `${formatDate(job.scheduledStart)} ${formatTime(job.scheduledStart)}${job.scheduledEnd ? ` – ${formatTime(job.scheduledEnd)}` : ''}` : 'Brak terminu'}
                </p>
              )}

              {job.addressCity ? (
                <p className="text-sm text-ink-600">
                  Adres: {[job.addressStreet, job.addressPostalCode, job.addressCity].filter(Boolean).join(', ')}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Pracownicy" />
            <CardBody className="space-y-3">
              {assignments.length > 0 ? (
                <ul className="space-y-1">
                  {assignments.map((assignment) => (
                    <li key={assignment.userId} className="flex items-center justify-between text-sm">
                      <span className="text-ink-800">{assignment.name}</span>
                      {assignment.isLead ? <Badge tone="info">Prowadzący</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-500">Brak przypisanych osób.</p>
              )}

              {context.can('job:assign') ? (
                <form action={assignJobPeopleAction} className="space-y-2 border-t border-ink-100 pt-3">
                  <input type="hidden" name="jobId" value={job.id} />
                  {members.map((member) => (
                    <label key={member.userId} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="assignedUserIds"
                        value={member.userId}
                        defaultChecked={assignments.some((assignment) => assignment.userId === member.userId)}
                        className="h-4 w-4 rounded border-ink-300"
                      />
                      {member.name}
                    </label>
                  ))}
                  <SubmitButton variant="secondary" size="sm">
                    Zapisz skład
                  </SubmitButton>
                </form>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Czas pracy" />
            <CardBody className="space-y-3">
              {context.can('job:write') ? (
                <div className="flex flex-wrap gap-2">
                  {!activeEntry ? (
                    <form action={startTimeEntryAction}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <SubmitButton size="sm">
                        <Timer className="h-3.5 w-3.5" /> Start
                      </SubmitButton>
                    </form>
                  ) : (
                    <>
                      {activeEntry.status === 'RUNNING' ? (
                        <form action={pauseTimeEntryAction}>
                          <input type="hidden" name="jobId" value={job.id} />
                          <SubmitButton variant="secondary" size="sm">
                            Pauza
                          </SubmitButton>
                        </form>
                      ) : (
                        <form action={resumeTimeEntryAction}>
                          <input type="hidden" name="jobId" value={job.id} />
                          <SubmitButton variant="secondary" size="sm">
                            Wznów
                          </SubmitButton>
                        </form>
                      )}
                      <form action={stopTimeEntryAction}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <SubmitButton variant="danger" size="sm">
                          Stop
                        </SubmitButton>
                      </form>
                    </>
                  )}
                </div>
              ) : null}

              {activeEntry ? (
                <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
                  Licznik aktywny od {formatTime(activeEntry.startedAt)}
                  {activeEntry.status === 'PAUSED' ? ' (wstrzymany)' : ''}
                </p>
              ) : null}

              {timeEntries.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {timeEntries.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-2 border-b border-ink-100 pb-1">
                      <span className="text-ink-700">{entry.userName}</span>
                      <span className="tabular text-ink-600">
                        {entry.status === 'STOPPED' ? formatDuration(entry.durationSeconds) : entry.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Status zlecenia" />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-500">Aktualny</span>
                <Badge tone={JOB_STATUS_TONES[job.status] ?? 'neutral'}>{statusLabel}</Badge>
              </div>

              {context.can('job:write') && !isDone ? (
                <div className="space-y-2 border-t border-ink-100 pt-3">
                  {nextStatuses[job.status]?.map((statusValue) => (
                    <form key={statusValue} action={updateJobStatusAction}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <input type="hidden" name="status" value={statusValue} />
                      <SubmitButton variant="secondary" size="sm" className="w-full">
                        {JOB_STATUSES.find((item) => item.value === statusValue)?.label ?? statusValue}
                      </SubmitButton>
                    </form>
                  ))}

                  <form action={completeJobAction} className="space-y-2 border-t border-ink-100 pt-3">
                    <input type="hidden" name="jobId" value={job.id} />
                    <Textarea name="note" rows={2} placeholder="Notatka końcowa (wymagana, jeśli firma tego wymaga)" />
                    <SubmitButton variant="success" className="w-full" confirm="Zakończyć zlecenie?">
                      Zakończ zlecenie
                    </SubmitButton>
                  </form>
                </div>
              ) : null}

              {job.status === 'COMPLETED' ? (
                <div className="space-y-2 border-t border-ink-100 pt-3 text-sm">
                  <p className="text-emerald-700">Zakończone {job.completedAt ? formatDateTime(job.completedAt) : ''}</p>
                  {job.completionNote ? <p className="whitespace-pre-wrap text-ink-700">{job.completionNote}</p> : null}
                  {context.can('invoice:write') ? (
                    <Link href={`/faktury/nowa?zlecenie=${job.id}`} className="btn-primary w-full">
                      <ClipboardList className="h-4 w-4" /> Wystaw fakturę
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
