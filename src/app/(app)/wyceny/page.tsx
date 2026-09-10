import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { countEstimates, listEstimates } from '@/lib/services/estimates';
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/constants';
import { Pagination } from '@/components/ui/pagination';
import { parsePage, totalPages } from '@/lib/pagination';

export const metadata = { title: 'Wyceny' };

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Szkic',
  SENT: 'Wysłana',
  ACCEPTED: 'Zaakceptowana',
  REJECTED: 'Odrzucona',
  EXPIRED: 'Wygasła',
};

const STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'warning',
};

export default async function EstimatesPage({ searchParams }: { searchParams?: Promise<{ strona?: string }> }) {
  const context = await requirePermission('estimate:read');
  const page = parsePage((await searchParams)?.strona);
  const [estimates, total] = await Promise.all([
    listEstimates(context.organization.id, page.limit, page.offset),
    countEstimates(context.organization.id),
  ]);

  return (
    <>
      <PageHeader
        title="Wyceny"
        description="Kalkulacje przygotowane dla klientów. Z wyceny tworzysz ofertę z linkiem do akceptacji."
        actions={
          context.can('estimate:write') ? (
            <ButtonLink href="/wyceny/nowa" variant="primary">
              <Plus className="h-4 w-4" /> Nowa wycena
            </ButtonLink>
          ) : null
        }
      />

      <Card>
        {estimates.length === 0 ? (
          <EmptyState
            title="Brak wycen"
            description="Utwórz pierwszą wycenę — silnik cenowy policzy netto, rabat, VAT i brutto."
            action={
              context.can('estimate:write') ? (
                <ButtonLink href="/wyceny/nowa" variant="primary" size="sm">
                  Nowa wycena
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
                  <th>Klient</th>
                  <th>Data</th>
                  <th>Wartość netto</th>
                  <th>Wartość brutto</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {estimates.map((estimate) => (
                  <tr key={estimate.id}>
                    <td className="font-medium text-ink-900">
                      <Link href={`/wyceny/${estimate.id}`} className="hover:underline">
                        {estimate.number}
                      </Link>
                    </td>
                    <td>{estimate.customerName}</td>
                    <td className="tabular">{formatDate(estimate.createdAt)}</td>
                    <td className="tabular">{formatMoney(estimate.subtotalCents, context.organization.currency)}</td>
                    <td className="tabular font-medium">{formatMoney(estimate.totalCents, context.organization.currency)}</td>
                    <td>
                      <Badge tone={STATUS_TONES[estimate.status] ?? 'neutral'}>{STATUS_LABELS[estimate.status] ?? estimate.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page.page} pages={totalPages(total, page.limit)} basePath="/wyceny" />
      </Card>
    </>
  );
}
