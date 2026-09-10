import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guards';
import { getEstimate, getEstimateItems, listEstimates } from '@/lib/services/estimates';
import { listQuotes } from '@/lib/services/estimates';
import { Badge, Card, CardBody, CardHeader, PageHeader, ButtonLink } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { deleteEstimateAction, createQuoteAction } from '@/app/(app)/wyceny/actions';
import { formatMoney } from '@/lib/money';
import { formatDate, unitLabel } from '@/lib/constants';

export const metadata = { title: 'Wycena' };

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission('estimate:read');
  const { id } = await params;
  const estimate = await getEstimate(context.organization.id, id);
  if (!estimate) notFound();

  const [items, quotes] = await Promise.all([getEstimateItems(id), listQuotes(context.organization.id)]);
  const relatedQuotes = quotes.filter((quote) => quote.estimateId === id);
  const currency = context.organization.currency;

  return (
    <>
      <PageHeader
        title={`Wycena ${estimate.number}`}
        description={`Utworzona ${formatDate(estimate.createdAt)}`}
        breadcrumbs={
          <Link href="/wyceny" className="hover:underline">
            Wyceny
          </Link>
        }
        actions={
          context.can('quote:write') ? (
            <form action={createQuoteAction}>
              <input type="hidden" name="estimateId" value={estimate.id} />
              <input type="hidden" name="validDays" value="14" />
              <SubmitButton>Utwórz ofertę</SubmitButton>
            </form>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Pozycje" />
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nazwa</th>
                    <th>Ilość</th>
                    <th>Cena jedn.</th>
                    <th>Netto</th>
                    <th>VAT</th>
                    <th>Brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <p className="font-medium text-ink-900">{item.name}</p>
                        {item.description ? <p className="text-xs text-ink-500">{item.description}</p> : null}
                      </td>
                      <td className="tabular">
                        {item.quantity.replace(/\.0+$/, '')} {unitLabel(item.unit, item.customUnitLabel)}
                      </td>
                      <td className="tabular">{formatMoney(item.unitPriceCents, currency)}</td>
                      <td className="tabular">{formatMoney(item.netCents, currency)}</td>
                      <td className="tabular">
                        {(item.taxRateBps / 100).toFixed(0)}%
                        <span className="block text-xs text-ink-500">{formatMoney(item.taxCents, currency)}</span>
                      </td>
                      <td className="tabular font-medium">{formatMoney(item.grossCents, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {estimate.notes || estimate.terms ? (
            <Card>
              <CardHeader title="Uwagi i warunki" />
              <CardBody className="space-y-3">
                {estimate.notes ? (
                  <div>
                    <p className="stat-label">Uwagi</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{estimate.notes}</p>
                  </div>
                ) : null}
                {estimate.terms ? (
                  <div>
                    <p className="stat-label">Warunki</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{estimate.terms}</p>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Podsumowanie" />
            <CardBody>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-600">Suma netto</dt>
                  <dd className="tabular">{formatMoney(estimate.subtotalCents, currency)}</dd>
                </div>
                {estimate.discountCents > 0 ? (
                  <div className="flex justify-between text-emerald-700">
                    <dt>Rabat</dt>
                    <dd className="tabular">-{formatMoney(estimate.discountCents, currency)}</dd>
                  </div>
                ) : null}
                {estimate.travelCents > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Dojazd</dt>
                    <dd className="tabular">{formatMoney(estimate.travelCents, currency)}</dd>
                  </div>
                ) : null}
                {estimate.urgencyFeeCents > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Dopłata za pilność</dt>
                    <dd className="tabular">{formatMoney(estimate.urgencyFeeCents, currency)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="text-ink-600">VAT</dt>
                  <dd className="tabular">{formatMoney(estimate.taxCents, currency)}</dd>
                </div>
                <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-semibold">
                  <dt>Razem</dt>
                  <dd className="tabular text-brand-700">{formatMoney(estimate.totalCents, currency)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Oferty z tej wyceny" />
            <CardBody>
              {relatedQuotes.length === 0 ? (
                <p className="text-sm text-ink-500">Nie utworzono jeszcze oferty.</p>
              ) : (
                <ul className="space-y-2">
                  {relatedQuotes.map((quote) => (
                    <li key={quote.id}>
                      <Link href={`/oferty/${quote.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-ink-50">
                        <span className="text-sm font-medium text-ink-900">{quote.number}</span>
                        <Badge tone={quote.status === 'ACCEPTED' ? 'success' : 'neutral'}>{quote.status}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {context.can('estimate:write') ? (
            <Card>
              <CardHeader title="Zarządzanie" />
              <CardBody className="space-y-3">
                <ButtonLink href={`/wyceny/${estimate.id}/edytuj`} variant="secondary" className="w-full">
                  Edytuj wycenę
                </ButtonLink>
                <form action={deleteEstimateAction}>
                  <input type="hidden" name="estimateId" value={estimate.id} />
                  <SubmitButton variant="danger" className="w-full" confirm="Usunąć wycenę? Tej operacji nie można cofnąć.">
                    Usuń wycenę
                  </SubmitButton>
                </form>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
