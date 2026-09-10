import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { listJobs } from '@/lib/services/jobs';
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatDate, formatTime, JOB_STATUSES, JOB_STATUS_TONES } from '@/lib/constants';

export const metadata = { title: 'Zlecenia' };

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; dzis?: string }> }) {
  const context = await requirePermission('job:read');
  const { status, dzis } = await searchParams;

  const jobs = await listJobs(context.organization.id, {
    status,
    today: dzis === '1',
  });

  const statusLabel = (value: string) => JOB_STATUSES.find((item) => item.value === value)?.label ?? value;

  return (
    <>
      <PageHeader
        title="Zlecenia"
        description="Planowanie, realizacja i rozliczenie pracy w terenie."
        actions={
          context.can('job:write') ? (
            <ButtonLink href="/zlecenia/nowy" variant="primary">
              <Plus className="h-4 w-4" /> Nowe zlecenie
            </ButtonLink>
          ) : null
        }
      />

      <Card className="mb-6">
        <form action="/zlecenia" method="get" className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="w-56">
            <label className="label" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status ?? 'ALL'} className="input">
              <option value="ALL">Wszystkie</option>
              {JOB_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" name="dzis" value="1" defaultChecked={dzis === '1'} className="h-4 w-4 rounded border-ink-300" />
            Tylko dzisiaj
          </label>
          <button type="submit" className="btn-primary">
            Filtruj
          </button>
        </form>
      </Card>

      <Card>
        {jobs.length === 0 ? (
          <EmptyState
            title="Brak zleceń"
            description="Zlecenia powstają z zaakceptowanej oferty albo tworzysz je ręcznie."
            action={
              context.can('job:write') ? (
                <ButtonLink href="/zlecenia/nowy" variant="primary" size="sm">
                  Nowe zlecenie
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Numer</th>
                  <th>Zlecenie</th>
                  <th>Klient</th>
                  <th>Termin</th>
                  <th>Ekipa</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="font-medium text-ink-900">
                      <Link href={`/zlecenia/${job.id}`} className="hover:underline">
                        {job.number}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/zlecenia/${job.id}`} className="text-ink-900 hover:underline">
                        {job.title}
                      </Link>
                      {job.addressCity ? <p className="text-xs text-ink-500">{job.addressCity}</p> : null}
                    </td>
                    <td>{job.customerName}</td>
                    <td className="tabular">
                      {job.scheduledStart ? (
                        <>
                          {formatDate(job.scheduledStart)}
                          <span className="block text-xs text-ink-500">
                            {formatTime(job.scheduledStart)}
                            {job.scheduledEnd ? ` – ${formatTime(job.scheduledEnd)}` : ''}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {job.crewName ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: job.crewColor ?? '#337dff' }} />
                          {job.crewName}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <Badge tone={JOB_STATUS_TONES[job.status] ?? 'neutral'}>{statusLabel(job.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
