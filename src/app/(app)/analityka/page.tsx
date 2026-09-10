import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guards';
import { getAging, getAnalytics } from '@/lib/queries/analytics';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { formatDate, INVOICE_STATUS_TONES, INVOICE_STATUSES } from '@/lib/constants';

export const metadata = { title: 'Analityka' };

export default async function AnalyticsPage() {
  const context = await requirePermission('analytics:read');
  const [analytics, aging] = await Promise.all([getAnalytics(context.organization.id), getAging(context.organization.id)]);

  const currency = context.organization.currency;
  const maxMonth = Math.max(1, ...analytics.revenueByMonth.map((row) => row.amountCents));
  const statusLabel = (value: string) => INVOICE_STATUSES.find((item) => item.value === value)?.label ?? value;

  return (
    <>
      <PageHeader title="Analityka" description="Wskaźniki liczone z bazy danych — żadnych stałych wartości." />

      {analytics.revenueByCurrency.length > 1 ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Faktury są wystawione w więcej niż jednej walucie — poniższe sumy są w {currency}. System nie przelicza
          walut po kursie, dlatego pozostałe pokazujemy osobno:{' '}
          {analytics.revenueByCurrency
            .filter((row) => row.currency !== currency)
            .map((row) => `${formatMoney(row.paidCents, row.currency)} opłacone`)
            .join(', ')}
          .
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Przychód (opłacone)" value={formatMoney(analytics.revenuePaidCents, currency)} tone="success" />
        <Stat label="Zafakturowano" value={formatMoney(analytics.revenueInvoicedCents, currency)} />
        <Stat label="Do zapłaty" value={formatMoney(analytics.outstandingCents, currency)} />
        <Stat
          label="Przeterminowane"
          value={formatMoney(analytics.overdueCents, currency)}
          hint={`${analytics.overdueCount} faktur`}
          tone={analytics.overdueCount > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Średnia wartość zlecenia" value={formatMoney(analytics.avgJobValueCents, currency)} hint={`z ${analytics.jobsCompleted} zakończonych`} />
        <Stat
          label="Konwersja ofert"
          value={analytics.conversionRate === null ? '—' : `${Math.round(analytics.conversionRate * 100)}%`}
          hint={`${analytics.quotesAccepted} z ${analytics.quotesSent} wysłanych`}
        />
        <Stat label="Klienci powracający" value={String(analytics.repeatCustomers)} hint={`z ${analytics.customersTotal} klientów`} />
        <Stat label="Przepracowane godziny" value={`${analytics.workedHours} h`} hint="na podstawie zatrzymanych liczników" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Przychód w miesiącach" description="Suma wartości faktur (bez anulowanych) w podziale na miesiące." />
          <CardBody>
            {analytics.revenueByMonth.length === 0 ? (
              <p className="text-sm text-ink-500">Brak faktur w analizowanym okresie.</p>
            ) : (
              <div className="space-y-2">
                {analytics.revenueByMonth.map((row) => (
                  <div key={row.month} className="flex items-center gap-3">
                    <span className="w-20 text-sm tabular text-ink-600">{row.month}</span>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-ink-100">
                      <div
                        className="h-full rounded bg-brand-600"
                        style={{ width: `${Math.max(2, Math.round((row.amountCents / maxMonth) * 100))}%` }}
                      />
                    </div>
                    <span className="w-32 text-right text-sm tabular text-ink-800">{formatMoney(row.amountCents, currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Najczęstsze usługi" description="Na podstawie pozycji zakończonych zleceń." />
          <CardBody>
            {analytics.topServices.length === 0 ? (
              <p className="text-sm text-ink-500">Brak danych.</p>
            ) : (
              <ul className="space-y-2">
                {analytics.topServices.map((service) => (
                  <li key={service.name} className="flex items-center justify-between text-sm">
                    <span className="truncate text-ink-800">{service.name}</span>
                    <span className="tabular text-ink-600">
                      ×{service.count} · {formatMoney(service.valueCents, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Należności" description="Faktury z pozostałą kwotą do zapłaty." />
        {aging.length === 0 ? (
          <EmptyState title="Brak nieopłaconych faktur" description="Wszystkie faktury są rozliczone." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Numer</th>
                  <th>Klient</th>
                  <th>Termin</th>
                  <th>Pozostało</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {aging.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="font-medium text-ink-900">
                      <Link href={`/faktury/${invoice.id}`} className="hover:underline">
                        {invoice.number}
                      </Link>
                    </td>
                    <td>{invoice.buyerName}</td>
                    <td className="tabular">{formatDate(invoice.dueDate)}</td>
                    <td className="tabular font-medium">{formatMoney(invoice.totalCents - invoice.paidCents, currency)}</td>
                    <td>
                      <Badge tone={INVOICE_STATUS_TONES[invoice.status] ?? 'neutral'}>{statusLabel(invoice.status)}</Badge>
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
