import Link from 'next/link';
import { Download, Plus } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { countInvoices, getInvoiceSummary, listInvoices } from '@/lib/services/invoices';
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { formatMoney } from '@/lib/money';
import { formatDate, INVOICE_STATUSES, INVOICE_STATUS_TONES } from '@/lib/constants';
import { Pagination } from '@/components/ui/pagination';
import { parsePage, totalPages } from '@/lib/pagination';

export const metadata = { title: 'Faktury' };

/** Domyślny okres eksportu: bieżący miesiąc kalendarzowy. */
function monthRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function defaultFrom(): string {
  return monthRange().from;
}

function defaultTo(): string {
  return monthRange().to;
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; blad?: string; strona?: string }> }) {
  const context = await requirePermission('invoice:read');
  const { status, blad, strona } = await searchParams;
  const page = parsePage(strona);

  const [invoices, total, summary] = await Promise.all([
    listInvoices(context.organization.id, { status, limit: page.limit, offset: page.offset }),
    countInvoices(context.organization.id, { status }),
    getInvoiceSummary(context.organization.id),
  ]);

  const currency = context.organization.currency;
  const statusLabel = (value: string) => INVOICE_STATUSES.find((item) => item.value === value)?.label ?? value;

  return (
    <>
      <PageHeader
        title="Faktury"
        description="Faktury wystawiasz zrealizowanych zleceń. Płatności księgujesz ręcznie lub przez Stripe."
        actions={
          context.can('invoice:write') ? (
            <ButtonLink href="/faktury/nowa" variant="primary">
              <Plus className="h-4 w-4" /> Nowa faktura
            </ButtonLink>
          ) : null
        }
      />

      {blad ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
      ) : null}

      <Card className="mb-6">
        <CardHeader title="Eksport JPK_FA" description="Plik dla urzędu skarbowego — powstaje wyłącznie z zapisanych faktur (bez roboczych i anulowanych)." />
        <CardBody>
          <form action="/api/faktury/jpk" method="get" className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label" htmlFor="od">
                Data od
              </label>
              <input id="od" name="od" type="date" required className="input" defaultValue={defaultFrom()} />
            </div>
            <div>
              <label className="label" htmlFor="do">
                Data do
              </label>
              <input id="do" name="do" type="date" required className="input" defaultValue={defaultTo()} />
            </div>
            <SubmitButton variant="secondary">
              <Download className="h-4 w-4" /> Pobierz JPK_FA
            </SubmitButton>
          </form>
        </CardBody>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Wystawiono" value={formatMoney(summary.totalCents, currency)} />
        <Stat label="Opłacono" value={formatMoney(summary.paidCents, currency)} tone="success" />
        <Stat label="Do zapłaty" value={formatMoney(summary.totalCents - summary.paidCents, currency)} />
        <Stat label="Przeterminowane" value={String(summary.overdueCount)} hint={formatMoney(summary.overdueCents, currency)} tone={summary.overdueCount > 0 ? 'danger' : 'neutral'} />
      </div>

      <Card className="mt-6">
        <form action="/faktury" method="get" className="flex flex-wrap items-end gap-3 border-b border-ink-100 px-5 py-4">
          <div className="w-56">
            <label className="label" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status ?? 'ALL'} className="input">
              <option value="ALL">Wszystkie</option>
              {INVOICE_STATUSES.map((item) => (
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

        {invoices.length === 0 ? (
          <EmptyState title="Brak faktur" description="Wystaw fakturę z zakończonego zlecenia lub ręcznie." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Numer</th>
                  <th>Klient</th>
                  <th>Wystawiona</th>
                  <th>Termin</th>
                  <th>Kwota</th>
                  <th>Do zapłaty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="font-medium text-ink-900">
                      <Link href={`/faktury/${invoice.id}`} className="hover:underline">
                        {invoice.number}
                      </Link>
                    </td>
                    <td>{invoice.buyerName}</td>
                    <td className="tabular">{formatDate(invoice.issueDate)}</td>
                    <td className="tabular">{formatDate(invoice.dueDate)}</td>
                    <td className="tabular">{formatMoney(invoice.totalCents, currency)}</td>
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
        <Pagination page={page.page} pages={totalPages(total, page.limit)} basePath="/faktury" query={{ status }} />
      </Card>
    </>
  );
}
