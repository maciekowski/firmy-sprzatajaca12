import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { listCustomers } from '@/lib/data/customers';
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/constants';

export const metadata = { title: 'Klienci' };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const context = await requirePermission('customer:read');
  const { q, status } = await searchParams;
  const customers = await listCustomers(context.organization.id, { search: q, status });

  return (
    <>
      <PageHeader
        title="Klienci"
        description="Klienci indywidualni i firmy, z adresami realizacji, kontaktami i historią."
        actions={
          context.can('customer:write') ? (
            <ButtonLink href="/klienci/nowy" variant="primary">
              <Plus className="h-4 w-4" /> Dodaj klienta
            </ButtonLink>
          ) : null
        }
      />

      <Card className="mb-6">
        <form action="/klienci" method="get" className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="min-w-[240px] flex-1">
            <label className="label" htmlFor="q">
              Szukaj
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                id="q"
                name="q"
                defaultValue={q ?? ''}
                placeholder="Nazwa, telefon, e-mail, miasto"
                className="input pl-9"
              />
            </div>
          </div>
          <div className="w-48">
            <label className="label" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status ?? 'ALL'} className="input">
              <option value="ALL">Wszyscy</option>
              <option value="ACTIVE">Aktywni</option>
              <option value="INACTIVE">Nieaktywni</option>
              <option value="BLOCKED">Zablokowani</option>
            </select>
          </div>
          <button type="submit" className="btn-primary">
            Filtruj
          </button>
          {q || status ? (
            <Link href="/klienci" className="btn-ghost">
              Wyczyść
            </Link>
          ) : null}
        </form>
      </Card>

      <Card>
        {customers.length === 0 ? (
          <EmptyState
            title="Brak klientów"
            description="Dodaj pierwszego klienta — będziesz mógł od razu przygotować dla niego wycenę i ofertę."
            action={
              context.can('customer:write') ? (
                <ButtonLink href="/klienci/nowy" variant="primary" size="sm">
                  Dodaj klienta
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Klient</th>
                  <th>Kontakt</th>
                  <th>Ostatnie zlecenie</th>
                  <th>Wartość zleceń</th>
                  <th>Niezapłacone</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <Link href={`/klienci/${customer.id}`} className="font-medium text-ink-900 hover:underline">
                        {customer.displayName}
                      </Link>
                      {customer.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {customer.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} tone="neutral">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-sm text-ink-600">
                      {customer.phone ?? '—'}
                      {customer.email ? <div className="text-xs text-ink-500">{customer.email}</div> : null}
                    </td>
                    <td className="text-sm tabular">{customer.lastJobAt ? formatDate(customer.lastJobAt) : '—'}</td>
                    <td className="text-sm tabular">
                      {formatMoney(customer.totalJobsValueCents, context.organization.currency)}
                      <div className="text-xs text-ink-500">{customer.jobsCount} zleceń</div>
                    </td>
                    <td className="text-sm tabular">
                      {customer.unpaidInvoicesCents > 0 ? (
                        <span className="font-medium text-red-600">
                          {formatMoney(customer.unpaidInvoicesCents, context.organization.currency)}
                        </span>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td>
                      <Badge
                        tone={
                          customer.status === 'ACTIVE' ? 'success' : customer.status === 'INACTIVE' ? 'neutral' : 'danger'
                        }
                      >
                        {customer.status === 'ACTIVE' ? 'Aktywny' : customer.status === 'INACTIVE' ? 'Nieaktywny' : 'Zablokowany'}
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
