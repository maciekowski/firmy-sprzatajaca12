import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, Send } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { getQuote, getQuoteItems, getQuoteEvents } from '@/lib/services/estimates';
import { getQuote as getQuoteRecord } from '@/lib/services/estimates';
import { communications } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { Badge, Card, CardBody, CardHeader, PageHeader, Stat } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { createQuoteAction, sendQuoteAction } from '@/app/(app)/wyceny/actions';
import { acceptQuoteManuallyAction, cancelQuoteAction, createJobFromQuoteAction } from '@/app/(app)/oferty/actions';
import { CopyLinkButton } from '@/components/quotes/copy-link';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime, QUOTE_STATUSES, QUOTE_STATUS_TONES, unitLabel } from '@/lib/constants';

export const metadata = { title: 'Oferta' };

const RESULT_MESSAGES: Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  wyslano: { tone: 'success', text: 'Ofertę oznaczono jako wysłaną. Status wiadomości sprawdzisz w sekcji Komunikacja.' },
  zaakceptowana: { tone: 'success', text: 'Oferta została zaakceptowana.' },
  blad: { tone: 'danger', text: 'Operacja nie powiodła się — sprawdź sekcję Komunikacja.' },
};

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wynik?: string; blad?: string }>;
}) {
  const context = await requirePermission('quote:read');
  const { id } = await params;
  const { wynik, blad } = await searchParams;

  const quote = await getQuote(context.organization.id, id);
  if (!quote) notFound();

  const [items, events, messages] = await Promise.all([
    getQuoteItems(id),
    getQuoteEvents(id),
    db
      .select()
      .from(communications)
      .where(and(eq(communications.quoteId, id), eq(communications.organizationId, context.organization.id)))
      .orderBy(desc(communications.createdAt))
      .limit(10),
  ]);

  const currency = context.organization.currency;
  const publicUrl = `${(process.env.APP_URL ?? '').replace(/\/$/, '')}/p/${quote.publicToken}`;
  const statusLabel = QUOTE_STATUSES.find((item) => item.value === quote.status)?.label ?? quote.status;
  const notification = wynik ? RESULT_MESSAGES[wynik] : undefined;

  return (
    <>
      <PageHeader
        title={`Oferta ${quote.number}`}
        description={`Wersja ${quote.version} · utworzona ${formatDate(quote.createdAt)}`}
        breadcrumbs={
          <Link href="/oferty" className="hover:underline">
            Oferty
          </Link>
        }
        actions={
          <>
            <a href={`/api/oferty/${quote.id}/pdf`} className="btn-secondary" target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" /> PDF
            </a>
            {context.can('quote:send') && quote.status !== 'ACCEPTED' && quote.status !== 'CANCELLED' ? (
              <form action={sendQuoteAction}>
                <input type="hidden" name="quoteId" value={quote.id} />
                <SubmitButton>
                  <Send className="h-4 w-4" /> Wyślij ofertę
                </SubmitButton>
              </form>
            ) : null}
          </>
        }
      />

      {notification ? (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            notification.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : notification.tone === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {notification.text}
        </div>
      ) : null}

      {blad ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Wartość brutto" value={formatMoney(quote.totalCents, currency)} hint={`Netto ${formatMoney(quote.subtotalCents, currency)}`} />
        <Stat label="Status" value={statusLabel} hint={quote.sentAt ? `Wysłana ${formatDate(quote.sentAt)}` : 'Nie wysłana'} />
        <Stat
          label="Reakcja klienta"
          value={quote.viewedAt ? 'Otworzył ofertę' : 'Brak otwarcia'}
          hint={quote.viewedAt ? formatDateTime(quote.viewedAt) : 'Klient nie otworzył jeszcze linku'}
        />
        <Stat label="Ważna do" value={quote.validUntil ? formatDate(quote.validUntil) : '—'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Pozycje oferty" />
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Nazwa</th>
                    <th>Ilość</th>
                    <th>Cena</th>
                    <th>Netto</th>
                    <th>VAT</th>
                    <th>Brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="font-medium text-ink-900">{item.name}</td>
                      <td className="tabular">
                        {item.quantity.replace(/\.0+$/, '')} {unitLabel(item.unit, item.customUnitLabel)}
                      </td>
                      <td className="tabular">{formatMoney(item.unitPriceCents, currency)}</td>
                      <td className="tabular">{formatMoney(item.netCents, currency)}</td>
                      <td className="tabular">{(item.taxRateBps / 100).toFixed(0)}%</td>
                      <td className="tabular font-medium">{formatMoney(item.grossCents, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CardBody className="border-t border-ink-100 bg-ink-50/60">
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
                <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-semibold">
                  <dt>Razem</dt>
                  <dd className="tabular text-brand-700">{formatMoney(quote.totalCents, currency)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Historia oferty" description="Każde zdarzenie jest zapisywane wraz z czasem i autorem." />
            <CardBody>
              {events.length === 0 ? (
                <p className="text-sm text-ink-500">Brak zdarzeń.</p>
              ) : (
                <ol className="space-y-3">
                  {events.map((event) => (
                    <li key={event.id} className="flex gap-3">
                      <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-500">
                        {event.type === 'ACCEPTED' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        ) : event.type === 'REJECTED' ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                        ) : (
                          <FileText className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-ink-900">{event.message ?? event.type}</p>
                        <p className="text-xs text-ink-500">
                          {formatDateTime(event.createdAt)}
                          {event.actorName ? ` · ${event.actorName}` : ''}
                          {event.ip ? ` · IP ${event.ip}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          {messages.length > 0 ? (
            <Card>
              <CardHeader title="Wiadomości" description="Rzeczywisty status wysyłki (brak providera oznacza brak wysyłki)." />
              <CardBody>
                <ul className="space-y-2">
                  {messages.map((message) => (
                    <li key={message.id} className="flex items-start justify-between gap-3 border-b border-ink-100 pb-2 last:border-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink-800">{message.subject ?? message.body.slice(0, 80)}</p>
                        <p className="text-xs text-ink-500">
                          {message.channel} · {formatDateTime(message.createdAt)}
                          {message.error ? ` · ${message.error}` : ''}
                        </p>
                      </div>
                      <Badge
                        tone={
                          message.status === 'SENT'
                            ? 'success'
                            : message.status === 'SKIPPED_NO_PROVIDER'
                              ? 'warning'
                              : message.status === 'FAILED'
                                ? 'danger'
                                : 'neutral'
                        }
                      >
                        {message.status === 'SENT'
                          ? 'Wysłana'
                          : message.status === 'SKIPPED_NO_PROVIDER'
                            ? 'Brak providera'
                            : message.status === 'FAILED'
                              ? 'Błąd'
                              : message.status === 'SKIPPED_NO_CONSENT'
                                ? 'Brak zgody'
                                : message.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Link dla klienta" />
            <CardBody className="space-y-3">
              <p className="text-sm text-ink-600">
                Klient zobaczy ofertę, może ją zaakceptować, odrzucić lub poprosić o zmiany.
              </p>
              <div className="rounded-lg border border-ink-200 bg-ink-50 p-2 text-xs break-all text-ink-700">{publicUrl}</div>
              <div className="flex gap-2">
                <CopyLinkButton url={publicUrl} />
                <a href={`/p/${quote.publicToken}`} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                  <ExternalLink className="h-3.5 w-3.5" /> Podgląd
                </a>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Działania" />
            <CardBody className="space-y-3">
              {quote.status === 'ACCEPTED' ? (
                <>
                  {quote.convertedJobId ? (
                    <Link href={`/zlecenia/${quote.convertedJobId}`} className="btn-primary w-full">
                      Przejdź do zlecenia
                    </Link>
                  ) : context.can('job:write') ? (
                    <form action={createJobFromQuoteAction}>
                      <input type="hidden" name="quoteId" value={quote.id} />
                      <SubmitButton className="w-full">Utwórz zlecenie</SubmitButton>
                    </form>
                  ) : null}
                </>
              ) : null}

              {context.can('quote:write') && quote.status !== 'ACCEPTED' && quote.status !== 'CANCELLED' ? (
                <form action={acceptQuoteManuallyAction}>
                  <input type="hidden" name="quoteId" value={quote.id} />
                  <SubmitButton variant="secondary" className="w-full" confirm="Odnotować akceptację oferty (np. decyzja telefoniczna)?">
                    Odnotuj akceptację
                  </SubmitButton>
                </form>
              ) : null}

              {context.can('quote:write') && quote.status !== 'ACCEPTED' && quote.status !== 'CANCELLED' ? (
                <form action={cancelQuoteAction}>
                  <input type="hidden" name="quoteId" value={quote.id} />
                  <SubmitButton variant="danger" className="w-full" confirm="Anulować ofertę?">
                    Anuluj ofertę
                  </SubmitButton>
                </form>
              ) : null}

              {quote.estimateId && context.can('quote:write') ? (
                <form action={createQuoteAction}>
                  <input type="hidden" name="estimateId" value={quote.estimateId} />
                  <input type="hidden" name="validDays" value="14" />
                  <SubmitButton variant="ghost" className="w-full">
                    Utwórz nową wersję oferty
                  </SubmitButton>
                </form>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Szczegóły" />
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-500">Status</span>
                <Badge tone={QUOTE_STATUS_TONES[quote.status] ?? 'neutral'}>{statusLabel}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Wersja</span>
                <span className="text-ink-800">{quote.version}</span>
              </div>
              {quote.decidedAt ? (
                <div className="flex justify-between">
                  <span className="text-ink-500">Decyzja</span>
                  <span className="text-ink-800">{formatDateTime(quote.decidedAt)}</span>
                </div>
              ) : null}
              {quote.rejectionReason ? (
                <div>
                  <p className="text-ink-500">Powód odrzucenia</p>
                  <p className="text-ink-800">{quote.rejectionReason}</p>
                </div>
              ) : null}
              {quote.changeRequest ? (
                <div>
                  <p className="text-ink-500">Prośba o zmiany</p>
                  <p className="text-ink-800">{quote.changeRequest}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
