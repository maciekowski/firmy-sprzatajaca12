import Link from 'next/link';
import { ArrowRight, CalendarDays, ClipboardList, FileText, Inbox, Users, Wallet, AlertTriangle } from 'lucide-react';
import { requireOrgContext } from '@/lib/auth/guards';
import { getDashboardData } from '@/lib/queries/dashboard';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat, ButtonLink } from '@/components/ui';
import { JOB_STATUSES, JOB_STATUS_TONES as statusTones, formatTime } from '@/lib/constants';
import { formatMoney } from '@/lib/money';

const tones = statusTones;

export const metadata = { title: 'Dashboard' };

function statusLabel(status: string): string {
  return JOB_STATUSES.find((item) => item.value === status)?.label ?? status;
}

export default async function DashboardPage() {
  const context = await requireOrgContext();
  const data = await getDashboardData(context.organization.id);
  const currency = context.organization.currency;

  const quickLinks = [
    { href: '/zlecenia?dzisiaj=1', label: 'Dzisiejsze zlecenia', value: data.jobsToday, icon: ClipboardList },
    { href: '/ekipy', label: 'Wolne ekipy', value: data.availableCrews.length, icon: Users },
    { href: '/kalendarz?konflikty=1', label: 'Konflikty terminów', value: data.conflicts, icon: AlertTriangle, danger: data.conflicts > 0 },
    { href: '/leady?status=NEW', label: 'Nowe leady', value: data.newLeads, icon: FileText },
    { href: '/zapytania?status=NEW', label: 'Nowe zapytania', value: data.newRequests, icon: Inbox },
    { href: '/oferty?status=SENT', label: 'Oczekujące oferty', value: data.openQuotes, icon: FileText },
    { href: '/faktury?status=OVERDUE', label: 'Zaległe faktury', value: data.overdueInvoices, icon: Wallet, danger: data.overdueInvoices > 0 },
    { href: '/kalendarz', label: 'Kalendarz', value: null, icon: CalendarDays },
  ];

  const maxRevenue = Math.max(1, ...data.revenueByMonth.map((row) => row.amountCents));

  return (
    <>
      <PageHeader
        title={`Dzień dobry, ${context.user.name.split(' ')[0]}`}
        description={`${context.organization.name} — stan na dziś, dane z systemu.`}
        actions={
          <>
            <ButtonLink href="/wyceny/nowa" variant="primary">
              Nowa wycena
            </ButtonLink>
            <ButtonLink href="/zlecenia/nowe" variant="secondary">
              Nowe zlecenie
            </ButtonLink>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Przychód (zapłacone)"
          value={formatMoney(data.revenuePaidCents, currency)}
          hint={`W tym miesiącu: ${formatMoney(data.revenueMonthCents, currency)}`}
          tone="success"
        />
        <Stat
          label="Otwarte oferty"
          value={data.openQuotes}
          hint={`Wartość oczekująca: ${formatMoney(data.openQuotesValueCents, currency)}`}
          tone="info"
        />
        <Stat
          label="Zlecenia dzisiaj"
          value={data.jobsToday}
          hint={data.conflicts > 0 ? `Wykryto konflikty: ${data.conflicts}` : 'Zaplanowane na dziś'}
          tone={data.conflicts > 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label="Nieopłacone faktury"
          value={formatMoney(data.unpaidInvoicesCents, currency)}
          hint={`${data.unpaidInvoices} faktur · przeterminowane: ${formatMoney(data.overdueInvoicesCents, currency)}`}
          tone={data.overdueInvoices > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Konwersja ofert" value={data.conversionRate !== null ? `${data.conversionRate}%` : '—'} hint={`${data.quotesAccepted} z ${data.quotesDecided} rozstrzygniętych`} />
        <Stat label="Leady w tym miesiącu" value={data.newLeads} hint="Nowo dodane zapytania sprzedażowe" />
        <Stat label="Wartość zafakturowana" value={formatMoney(data.revenueInvoiceTotalCents, currency)} hint="Suma faktur bez anulowanych" />
        <Stat
          label="Czas pracy (zarejestrowany)"
          value={`${(data.workedSeconds / 3600).toFixed(1)} h`}
          hint="Zakończone wpisy czasu"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Dzisiejsze zlecenia"
            description={data.todayJobs.length === 0 ? 'Brak zaplanowanych zleceń na dziś.' : `${data.todayJobs.length} zaplanowanych`}
            actions={
              <Link href="/kalendarz" className="text-sm font-medium text-brand-700 hover:underline">
                Kalendarz →
              </Link>
            }
          />
          {data.todayJobs.length === 0 ? (
            <EmptyState
              title="Dziś nic zaplanowanego"
              description="Zaplanuj zlecenie w kalendarzu lub utwórz je z zaakceptowanej oferty."
              action={
                <ButtonLink href="/zlecenia" variant="secondary" size="sm">
                  Zobacz zlecenia
                </ButtonLink>
              }
            />
          ) : (
            <div className="divide-y divide-ink-100">
              {data.todayJobs.map((job) => (
                <Link key={job.id} href={`/zlecenia/${job.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-ink-50">
                  <div className="w-14 shrink-0 text-sm font-medium tabular text-ink-900">{formatTime(job.scheduledStart)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{job.title}</p>
                    <p className="truncate text-xs text-ink-500">
                      {job.customerName}
                      {job.city ? ` · ${job.city}` : ''}
                      {job.crewName ? ` · ${job.crewName}` : ''}
                    </p>
                  </div>
                  <Badge tone={tones[job.status] ?? 'neutral'}>{statusLabel(job.status)}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Szybki dostęp" />
          <CardBody className="grid gap-2">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2.5 text-sm hover:bg-ink-50"
              >
                <span className="flex items-center gap-2 text-ink-700">
                  <link.icon className={`h-4 w-4 ${link.danger ? 'text-red-500' : 'text-ink-400'}`} />
                  {link.label}
                </span>
                <span className={`font-semibold tabular ${link.danger ? 'text-red-600' : 'text-ink-900'}`}>
                  {link.value ?? <ArrowRight className="h-4 w-4 text-ink-300" />}
                </span>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Przychód z płatności (6 miesięcy)" />
          <CardBody>
            {data.revenueByMonth.length === 0 ? (
              <EmptyState
                title="Brak zarejestrowanych płatności"
                description="Gdy zarejestrujesz płatność do faktury, wykres wypełni się realnymi danymi."
              />
            ) : (
              <div className="flex h-44 items-end gap-3">
                {data.revenueByMonth.map((row) => (
                  <div key={row.month} className="flex flex-1 flex-col items-center gap-2">
                    <div
                      className="w-full rounded-t bg-brand-500"
                      style={{ height: `${Math.max(4, (row.amountCents / maxRevenue) * 140)}px` }}
                      title={formatMoney(row.amountCents, currency)}
                    />
                    <span className="text-[11px] text-ink-500">{row.month.slice(5)}/{row.month.slice(2, 4)}</span>
                    <span className="text-[11px] font-medium tabular text-ink-700">{formatMoney(row.amountCents, currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Zlecenia według statusu" />
          <CardBody>
            {data.jobsByStatus.length === 0 ? (
              <EmptyState title="Brak zleceń" description="Utwórz pierwsze zlecenie z oferty lub ręcznie." />
            ) : (
              <div className="space-y-3">
                {data.jobsByStatus.map((row) => {
                  const total = data.jobsByStatus.reduce((sum, item) => sum + item.count, 0);
                  const percent = total > 0 ? Math.round((row.count / total) * 100) : 0;
                  return (
                    <div key={row.status}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-ink-700">{statusLabel(row.status)}</span>
                        <span className="tabular text-ink-500">
                          {row.count} ({percent}%)
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Najnowsze zlecenia"
          actions={
            <Link href="/zlecenia" className="text-sm font-medium text-brand-700 hover:underline">
              Wszystkie →
            </Link>
          }
        />
        {data.latestJobs.length === 0 ? (
          <EmptyState
            title="Brak zleceń"
            description="Zlecenia tworzą się automatycznie z zaakceptowanych ofert albo ręcznie."
            action={
              <ButtonLink href="/zlecenia/nowe" variant="primary" size="sm">
                Utwórz zlecenie
              </ButtonLink>
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
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.latestJobs.map((job) => (
                  <tr key={job.id}>
                    <td className="font-medium text-ink-900">
                      <Link href={`/zlecenia/${job.id}`} className="hover:underline">
                        {job.number}
                      </Link>
                    </td>
                    <td>{job.title}</td>
                    <td>{job.customerName}</td>
                    <td className="tabular">{job.scheduledStart ? formatTime(job.scheduledStart) : '—'}</td>
                    <td>
                      <Badge tone={statusTones[job.status] ?? 'neutral'}>{statusLabel(job.status)}</Badge>
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
