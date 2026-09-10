import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { listJobsInRange } from '@/lib/data/jobs';
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { formatTime, JOB_STATUS_TONES } from '@/lib/constants';

export const metadata = { title: 'Kalendarz' };

const DAY_NAMES = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nie'];

function parseWeekStart(value?: string): Date {
  let base = value ? new Date(`${value}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) base = new Date();
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7; // poniedziałek = 0
  date.setDate(date.getDate() - day);
  return date;
}

function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ tydzien?: string }> }) {
  const context = await requirePermission('job:read');
  const { tydzien } = await searchParams;

  const weekStart = parseWeekStart(tydzien);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const jobs = await listJobsInRange(context.organization.id, weekStart, weekEnd);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart.getTime() + index * 24 * 60 * 60 * 1000);
    return {
      date,
      key: toISODate(date),
      label: `${DAY_NAMES[index]} ${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`,
      jobs: jobs.filter((job) => job.scheduledStart && toISODate(new Date(job.scheduledStart)) === toISODate(date)),
    };
  });

  const unscheduled = jobs.length - days.reduce((sum, day) => sum + day.jobs.length, 0);

  return (
    <>
      <PageHeader
        title="Kalendarz"
        description={`Tydzień ${toISODate(weekStart)} – ${toISODate(new Date(weekEnd.getTime() - 24 * 60 * 60 * 1000))}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/kalendarz?tydzien=${toISODate(new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000))}`} className="btn-secondary">
              <ChevronLeft className="h-4 w-4" /> Poprzedni
            </Link>
            <Link href="/kalendarz" className="btn-secondary">
              Dzisiaj
            </Link>
            <Link href={`/kalendarz?tydzien=${toISODate(new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000))}`} className="btn-secondary">
              Następny <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      <Card>
        {jobs.length === 0 ? (
          <EmptyState
            title="Pusty tydzień"
            description="Zaplanuj zlecenia, żeby widzieć je w kalendarzu."
          />
        ) : (
          <div className="grid grid-cols-1 divide-y divide-ink-100 sm:grid-cols-7 sm:divide-x sm:divide-y-0">
            {days.map((day) => (
              <div key={day.key} className="min-h-40 p-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{day.label}</p>
                <ul className="space-y-1.5">
                  {day.jobs.map((job) => (
                    <li key={job.id}>
                      <Link
                        href={`/zlecenia/${job.id}`}
                        className="block rounded-lg border-l-4 bg-ink-50 px-2 py-1.5 text-xs hover:bg-ink-100"
                        style={{ borderLeftColor: job.crewColor ?? JOB_STATUS_TONES[job.status] === 'success' ? '#10b981' : '#337dff' }}
                      >
                        <span className="font-medium text-ink-900">
                          {job.scheduledStart ? formatTime(job.scheduledStart) : '—'} {job.title}
                        </span>
                        <span className="block text-ink-500">{job.customerName}</span>
                        {job.crewName ? (
                          <span className="inline-flex items-center gap-1 text-ink-500">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: job.crewColor ?? '#337dff' }} />
                            {job.crewName}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Podsumowanie tygodnia" />
        <CardBody>
          <p className="text-sm text-ink-700">
            Zaplanowanych zleceń: <strong>{days.reduce((sum, day) => sum + day.jobs.length, 0)}</strong>
            {unscheduled > 0 ? ` · poza zakresem: ${unscheduled}` : ''}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Kolor z lewej strony kafelka to kolor ekipy. Zlecenia bez terminu nie pojawiają się w kalendarzu.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
