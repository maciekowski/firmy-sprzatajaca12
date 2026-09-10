import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCustomerPortalData } from '@/lib/services/portal';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime } from '@/lib/constants';

export const metadata = { title: 'Twoje zlecenia i faktury', robots: { index: false, follow: false } };

const QUOTE_STATUS: Record<string, string> = {
  SENT: 'Oczekuje na decyzję',
  VIEWED: 'Obejrzana',
  ACCEPTED: 'Zaakceptowana',
  REJECTED: 'Odrzucona',
  EXPIRED: 'Wygasła',
};

const JOB_STATUS: Record<string, string> = {
  SCHEDULED: 'Zaplanowane',
  CONFIRMED: 'Potwierdzone',
  EN_ROUTE: 'Ekipa w drodze',
  ON_SITE: 'Ekipa na miejscu',
  IN_PROGRESS: 'W realizacji',
  COMPLETED: 'Zrealizowane',
  CANCELLED: 'Anulowane',
  NO_SHOW: 'Nieobecność',
};

const INVOICE_STATUS: Record<string, string> = {
  SENT: 'Do zapłaty',
  PARTIALLY_PAID: 'Częściowo opłacona',
  PAID: 'Opłacona',
  OVERDUE: 'Po terminie',
  CANCELLED: 'Anulowana',
};

function toneFor(status: string): string {
  if (['ACCEPTED', 'PAID', 'COMPLETED'].includes(status)) return 'bg-emerald-50 text-emerald-800';
  if (['REJECTED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'OVERDUE'].includes(status)) return 'bg-red-50 text-red-800';
  if (['PARTIALLY_PAID', 'IN_PROGRESS', 'VIEWED'].includes(status)) return 'bg-amber-50 text-amber-800';
  return 'bg-ink-50 text-ink-700';
}

/**
 * Konto klienta — dostęp wyłącznie na podstawie tokenu klienta (bez logowania).
 * Dokumenty robocze (DRAFT) nie są widoczne.
 */
export default async function CustomerPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getCustomerPortalData(token);
  if (!data) notFound();

  const toPay = data.invoices
    .filter((invoice) => invoice.status !== 'PAID' && invoice.status !== 'CANCELLED')
    .reduce((sum, invoice) => sum + (invoice.totalCents - invoice.paidCents), 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <header className="mb-8">
        <p className="text-sm text-ink-500">{data.organizationName}</p>
        <h1 className="text-2xl font-semibold text-ink-900">Cześć, {data.customer.displayName}</h1>
        <p className="mt-1 text-sm text-ink-600">
          Tutaj znajdziesz swoje oferty, zlecenia i faktury. Link jest prywatny — nie udostępniaj go osobom nieuprawnionym.
        </p>
      </header>

      {toPay > 0 ? (
        <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Do zapłaty: <strong>{formatMoney(toPay, 'PLN')}</strong>
        </div>
      ) : null}

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-ink-900">Oferty</h2>
        {data.quotes.length === 0 ? (
          <p className="text-sm text-ink-500">Brak ofert.</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100">
            {data.quotes.map((quote) => (
              <li key={quote.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <Link href={`/p/${quote.publicToken}`} className="text-sm font-medium text-brand-700 hover:underline">
                    {quote.number}
                  </Link>
                  <p className="text-xs text-ink-500">
                    Wystawiona {formatDate(quote.createdAt)}
                    {quote.validUntil ? ` · ważna do ${formatDate(quote.validUntil)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-ink-900">{formatMoney(quote.totalCents, 'PLN')}</span>
                  <span className={`rounded-full px-2 py-1 text-xs ${toneFor(quote.status)}`}>
                    {QUOTE_STATUS[quote.status] ?? quote.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-ink-900">Zlecenia</h2>
        {data.jobs.length === 0 ? (
          <p className="text-sm text-ink-500">Brak zleceń.</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100">
            {data.jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">
                    {job.number} · {job.title}
                  </p>
                  <p className="text-xs text-ink-500">
                    {job.scheduledStart ? formatDateTime(job.scheduledStart) : 'Termin do ustalenia'}
                    {job.address ? ` · ${job.address}` : ''}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs ${toneFor(job.status)}`}>
                  {JOB_STATUS[job.status] ?? job.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink-900">Faktury</h2>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-ink-500">Brak faktur.</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100">
            {data.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <Link href={`/f/${invoice.publicToken}`} className="text-sm font-medium text-brand-700 hover:underline">
                    {invoice.number}
                  </Link>
                  <p className="text-xs text-ink-500">
                    {invoice.dueDate ? `Termin płatności ${formatDate(invoice.dueDate)}` : 'Brak terminu płatności'}
                    {invoice.paidCents > 0 ? ` · wpłacono ${formatMoney(invoice.paidCents, 'PLN')}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-ink-900">{formatMoney(invoice.totalCents, 'PLN')}</span>
                  <span className={`rounded-full px-2 py-1 text-xs ${toneFor(invoice.status)}`}>
                    {INVOICE_STATUS[invoice.status] ?? invoice.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-10 text-xs text-ink-400">
        Masz pytania? Skontaktuj się z nami: {data.customer.email ?? data.customer.phone ?? '—'}
      </footer>
    </main>
  );
}
