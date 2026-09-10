import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { customers, organizations, quoteItems, quotes } from '@/lib/db/schema';
import { markQuoteViewed, getQuoteByToken } from '@/lib/services/estimates';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime, unitLabel } from '@/lib/constants';

export const metadata = { title: 'Oferta', robots: { index: false, follow: false } };

const RESULT: Record<string, { tone: string; text: string }> = {
  zaakceptowana: {
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    text: 'Dziękujemy! Oferta została zaakceptowana. Skontaktujemy się w sprawie terminu.',
  },
  odrzucona: {
    tone: 'border-ink-200 bg-ink-50 text-ink-800',
    text: 'Oferta została odrzucona. Dziękujemy za informację.',
  },
  zmiany: {
    tone: 'border-amber-200 bg-amber-50 text-amber-900',
    text: 'Prośba o zmiany została przekazana. Wrócimy do Ciebie z poprawioną propozycją.',
  },
  blad: { tone: 'border-red-200 bg-red-50 text-red-900', text: 'Nie udało się zapisać decyzji.' },
};

/**
 * Portal klienta — dostęp wyłącznie na podstawie tokenu z linku.
 * Brak logowania: token jest jednorazowym sekretem przypisanym do konkretnej oferty.
 */
export default async function PublicQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ wynik?: string; blad?: string }>;
}) {
  const { token } = await params;
  const { wynik, blad } = await searchParams;

  const quote = await getQuoteByToken(token);
  if (!quote) notFound();

  const [organization] = await db.select().from(organizations).where(eq(organizations.id, quote.organizationId)).limit(1);
  const [customer] = await db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1);
  const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quote.id));

  // Rejestracja faktu otwarcia oferty (operacja idempotentna — tylko pierwsze otwarcie).
  const requestHeaders = await headers();
  await markQuoteViewed(quote.id);
  void requestHeaders;

  const currency = organization?.currency ?? 'PLN';
  const expired = quote.validUntil ? quote.validUntil < new Date() : false;
  const decided = quote.status === 'ACCEPTED' || quote.status === 'REJECTED';
  const notification = blad ? RESULT.blad : wynik ? RESULT[wynik] : undefined;
  const canDecide = !decided && quote.status !== 'CANCELLED' && quote.status !== 'DRAFT' && !expired;

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Oferta</p>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{quote.number}</h1>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-ink-900">{organization?.name}</p>
            <p className="text-xs text-ink-500">
              {[organization?.city, organization?.phone].filter(Boolean).join(' · ') || 'Dane firmy'}
            </p>
          </div>
        </div>

        {notification ? (
          <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${notification.tone}`}>{notification.text}</div>
        ) : null}

        {quote.status === 'ACCEPTED' ? (
          <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Ta oferta została już zaakceptowana{quote.decidedAt ? ` (${formatDateTime(quote.decidedAt)})` : ''}.
          </div>
        ) : null}
        {quote.status === 'REJECTED' ? (
          <div className="mb-6 rounded-lg border border-ink-200 bg-white px-4 py-3 text-sm text-ink-700">
            Ta oferta została odrzucona{quote.decidedAt ? ` (${formatDateTime(quote.decidedAt)})` : ''}.
          </div>
        ) : null}
        {expired && !decided ? (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Oferta wygasła {quote.validUntil ? formatDate(quote.validUntil) : ''}. Skontaktuj się z nami po aktualną
            wycenę.
          </div>
        ) : null}

        <div className="card overflow-hidden">
          <div className="border-b border-ink-100 px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="stat-label">Dla</p>
                <p className="mt-1 font-medium text-ink-900">{customer?.displayName}</p>
                {customer?.companyName ? <p className="text-sm text-ink-600">{customer.companyName}</p> : null}
                <p className="text-sm text-ink-600">
                  {[customer?.street, customer?.postalCode, customer?.city].filter(Boolean).join(', ')}
                </p>
                {customer?.email ? <p className="text-sm text-ink-600">{customer.email}</p> : null}
              </div>
              <div className="sm:text-right">
                <p className="stat-label">Terminy</p>
                <p className="mt-1 text-sm text-ink-800">Wystawiona: {formatDate(quote.createdAt)}</p>
                <p className="text-sm text-ink-800">Ważna do: {quote.validUntil ? formatDate(quote.validUntil) : '—'}</p>
              </div>
            </div>
            {[quote.addressLabel, quote.addressStreet, quote.addressCity].filter(Boolean).length > 0 ? (
              <p className="mt-3 text-sm text-ink-600">
                Adres realizacji: {[quote.addressLabel, quote.addressStreet, quote.addressCity].filter(Boolean).join(', ')}
              </p>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Usługa</th>
                  <th>Zakres</th>
                  <th>Cena</th>
                  <th>Razem</th>
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
                    <td className="tabular font-medium">{formatMoney(item.grossCents, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-ink-100 bg-ink-50/60 px-6 py-5">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-600">Suma netto</dt>
                <dd className="tabular">{formatMoney(quote.subtotalCents, currency)}</dd>
              </div>
              {quote.discountCents > 0 ? (
                <div className="flex justify-between text-emerald-700">
                  <dt>Rabat</dt>
                  <dd className="tabular">-{formatMoney(quote.discountCents, currency)}</dd>
                </div>
              ) : null}
              {quote.travelCents > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-600">Dojazd</dt>
                  <dd className="tabular">{formatMoney(quote.travelCents, currency)}</dd>
                </div>
              ) : null}
              {quote.urgencyFeeCents > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-600">Dopłata za pilność</dt>
                  <dd className="tabular">{formatMoney(quote.urgencyFeeCents, currency)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-ink-600">VAT</dt>
                <dd className="tabular">{formatMoney(quote.taxCents, currency)}</dd>
              </div>
              <div className="flex justify-between border-t border-ink-200 pt-2 text-lg font-semibold">
                <dt>Razem</dt>
                <dd className="tabular text-brand-700">{formatMoney(quote.totalCents, currency)}</dd>
              </div>
            </dl>
          </div>

          {quote.notes || quote.terms ? (
            <div className="grid gap-4 border-t border-ink-100 px-6 py-5 sm:grid-cols-2">
              {quote.notes ? (
                <div>
                  <p className="stat-label">Uwagi</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{quote.notes}</p>
                </div>
              ) : null}
              {quote.terms ? (
                <div>
                  <p className="stat-label">Warunki</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{quote.terms}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {canDecide ? (
          <div className="mt-6 card p-6">
            <h2 className="section-title">Twoja decyzja</h2>
            <p className="mt-1 text-sm text-ink-600">
              Możesz zaakceptować ofertę, odrzucić ją albo poprosić o zmiany. Informacja trafi do nas natychmiast.
            </p>

            <form action={`/api/portal/${token}/decyzja`} method="post" className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="imie">
                    Imię i nazwisko
                  </label>
                  <input id="imie" name="imie" className="input" placeholder="Jan Kowalski" />
                </div>
                <div>
                  <label className="label" htmlFor="notatka">
                    Komentarz (opcjonalnie)
                  </label>
                  <input id="notatka" name="notatka" className="input" placeholder="Np. proszę o termin po 15:00" />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button type="submit" name="decyzja" value="akceptuj" className="btn-success">
                  Akceptuję ofertę
                </button>
                <button type="submit" name="decyzja" value="zmiany" className="btn-secondary">
                  Proszę o zmiany
                </button>
                <button type="submit" name="decyzja" value="odrzuc" className="btn-danger">
                  Odrzucam
                </button>
              </div>
            </form>
          </div>
        ) : null}

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
