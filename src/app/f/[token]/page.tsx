import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, Download } from 'lucide-react';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import { getInvoiceByToken, getInvoiceItems, getInvoicePayments } from '@/lib/services/invoices';
import { formatMoney } from '@/lib/money';
import { formatDate, PAYMENT_METHODS } from '@/lib/constants';
import { stripeStatus } from '@/lib/billing/stripe';
import { PayButton } from '@/components/payments/pay-button';

export const metadata = { title: 'Faktura', robots: { index: false, follow: false } };

/** Portal klienta: podgląd faktury na podstawie tokenu z linku (bez logowania). */
export default async function PublicInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ platnosc?: string }>;
}) {
  const { token } = await params;
  const { platnosc } = await searchParams;
  const invoice = await getInvoiceByToken(token);
  if (!invoice) notFound();

  const [items, payments, orgRows] = await Promise.all([
    getInvoiceItems(invoice.id),
    getInvoicePayments(invoice.id),
    db.select().from(organizations).where(eq(organizations.id, invoice.organizationId)).limit(1),
  ]);

  const organization = orgRows[0];
  const currency = organization?.currency ?? 'PLN';
  const remaining = invoice.totalCents - invoice.paidCents;
  const stripe = stripeStatus();

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Faktura</p>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{invoice.number}</h1>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-ink-900">{organization?.name}</p>
            <p className="text-xs text-ink-500">
              {[organization?.city, organization?.phone].filter(Boolean).join(' · ') || 'Dane firmy'}
            </p>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="grid gap-4 border-b border-ink-100 px-6 py-5 sm:grid-cols-2">
            <div>
              <p className="stat-label">Sprzedawca</p>
              <p className="mt-1 font-medium text-ink-900">{organization?.name}</p>
              <p className="text-sm text-ink-600">
                {[organization?.street, organization?.postalCode, organization?.city].filter(Boolean).join(', ')}
              </p>
              {organization?.taxId ? <p className="text-sm text-ink-600">NIP {organization.taxId}</p> : null}
            </div>
            <div className="sm:text-right">
              <p className="stat-label">Nabywca</p>
              <p className="mt-1 font-medium text-ink-900">{invoice.buyerName}</p>
              <p className="text-sm text-ink-600">
                {[invoice.buyerStreet, invoice.buyerPostalCode, invoice.buyerCity].filter(Boolean).join(', ')}
              </p>
              {invoice.buyerTaxId ? <p className="text-sm text-ink-600">NIP {invoice.buyerTaxId}</p> : null}
              <p className="mt-2 text-sm text-ink-800">
                Data wystawienia: {formatDate(invoice.issueDate)}
                <span className="block">Termin płatności: {formatDate(invoice.dueDate)}</span>
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Nazwa</th>
                  <th>Ilość</th>
                  <th>Cena netto</th>
                  <th>Wartość netto</th>
                  <th>VAT</th>
                  <th>Brutto</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="font-medium text-ink-900">{item.name}</td>
                    <td className="tabular">{Number(item.quantity)}</td>
                    <td className="tabular">{formatMoney(item.unitPriceCents, currency)}</td>
                    <td className="tabular">{formatMoney(item.netCents, currency)}</td>
                    <td className="tabular">{(item.taxRateBps / 100).toFixed(0)}%</td>
                    <td className="tabular font-medium">{formatMoney(item.grossCents, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-ink-100 bg-ink-50/60 px-6 py-5">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-600">Netto</dt>
                <dd className="tabular">{formatMoney(invoice.subtotalCents, currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-600">VAT</dt>
                <dd className="tabular">{formatMoney(invoice.taxCents, currency)}</dd>
              </div>
              <div className="flex justify-between border-t border-ink-200 pt-2 text-lg font-semibold">
                <dt>Do zapłaty</dt>
                <dd className="tabular text-brand-700">{formatMoney(invoice.totalCents, currency)}</dd>
              </div>
              {invoice.paidCents > 0 ? (
                <>
                  <div className="flex justify-between text-emerald-700">
                    <dt>Opłacono</dt>
                    <dd className="tabular">{formatMoney(invoice.paidCents, currency)}</dd>
                  </div>
                  <div className="flex justify-between text-base font-semibold">
                    <dt>Pozostaje</dt>
                    <dd className="tabular">{formatMoney(remaining, currency)}</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </div>

          {payments.length > 0 ? (
            <div className="border-t border-ink-100 px-6 py-4">
              <p className="stat-label">Wpłaty</p>
              <ul className="mt-2 space-y-1 text-sm">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex justify-between">
                    <span className="text-ink-700">
                      {PAYMENT_METHODS.find((method) => method.value === payment.method)?.label ?? payment.method} ·{' '}
                      {formatDate(payment.paidAt)}
                    </span>
                    <span className="tabular text-ink-800">{formatMoney(payment.amountCents, currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="mt-6 card p-6">
          <h2 className="section-title">Płatność</h2>
          {remaining <= 0 ? (
            <p className="mt-1 text-sm text-emerald-700">Faktura jest opłacona w całości. Dziękujemy!</p>
          ) : stripe.configured ? (
            <p className="mt-1 text-sm text-ink-700">
              Płatność kartą obsługuje Stripe. Po kliknięciu zostaniesz przekierowany na stronę płatności — faktura
              zostanie oznaczona jako opłacona dopiero po potwierdzeniu z serwera Stripe.
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-700">
              Płać przelewem na numer konta wskazany przez wykonawcę. <strong>Płatność online nie jest aktywna</strong> —
              bramka płatności nie jest jeszcze skonfigurowana (system nie udaje płatności).
            </p>
          )}

          {platnosc === 'oczekuje' ? (
            <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Otwarto sesję płatności. Faktura zostanie oznaczona jako opłacona po potwierdzeniu z serwera Stripe.
            </p>
          ) : null}
          {platnosc === 'anulowana' ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Płatność została przerwana — faktura pozostaje nieopłacona.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            {stripe.configured && remaining > 0 ? (
              <PayButton token={token} amountLabel={formatMoney(remaining, currency)} />
            ) : null}
            <a href={`/api/faktury/${invoice.id}/pdf`} className="btn-secondary inline-flex items-center gap-2" target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" /> Pobierz PDF
            </a>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between text-xs text-ink-500">
          <span>Dokument wygenerowany w systemie ServiceFlow.</span>
          <Link href="/" className="hover:underline">
            ServiceFlow
          </Link>
        </div>
      </div>
    </div>
  );
}
