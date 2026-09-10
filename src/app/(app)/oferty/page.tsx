import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guards';
import { listQuotes } from '@/lib/services/estimates';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { formatDate, QUOTE_STATUSES, QUOTE_STATUS_TONES } from '@/lib/constants';

export const metadata = { title: 'Oferty' };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await requirePermission('quote:read');
  const { status } = await searchParams;
  const quotes = await listQuotes(context.organization.id, { status });

  return (
    <>
      <PageHeader
        title="Oferty"
        description="Oferty wysłane klientom z linkiem do akceptacji. Widzisz status i historię zdarzeń."
      />

      <Card className="mb-6">
        <form action="/oferty" method="get" className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="w-56">
            <label className="label" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status ?? 'ALL'} className="input">
              <option value="ALL">Wszystkie</option>
              {QUOTE_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary">
            Filtruj
          </button>
        </form>
      </Card>

      <Card>
        {quotes.length === 0 ? (
          <EmptyState
            title="Brak ofert"
            description="Oferty tworzy się z wycen. Po wysłaniu klient dostaje link do akceptacji."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Numer</th>
                  <th>Klient</th>
                  <th>Wysłana</th>
                  <th>Ważna do</th>
                  <th>Wartość</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => (
                  <tr key={quote.id}>
                    <td className="font-medium text-ink-900">
                      <Link href={`/oferty/${quote.id}`} className="hover:underline">
                        {quote.number}
                      </Link>
                      {quote.version > 1 ? <span className="ml-1 text-xs text-ink-400">v{quote.version}</span> : null}
                    </td>
                    <td>{quote.customerName}</td>
                    <td className="tabular">{quote.sentAt ? formatDate(quote.sentAt) : '—'}</td>
                    <td className="tabular">{quote.validUntil ? formatDate(quote.validUntil) : '—'}</td>
                    <td className="tabular font-medium">{formatMoney(quote.totalCents, context.organization.currency)}</td>
                    <td>
                      <Badge tone={QUOTE_STATUS_TONES[quote.status] ?? 'neutral'}>
                        {QUOTE_STATUSES.find((item) => item.value === quote.status)?.label ?? quote.status}
                      </Badge>
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
