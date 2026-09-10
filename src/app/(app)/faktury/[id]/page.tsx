import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CreditCard, Download, Send } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { getInvoice, getInvoiceItems, getInvoicePayments } from '@/lib/services/invoices';
import { Badge, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Stat } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { cancelInvoiceAction, markInvoiceSentAction, recordPaymentAction } from '@/app/(app)/faktury/actions';
import {
  downloadKsefUpoAction,
  markInvoiceReadyForKsefAction,
  refreshKsefStatusAction,
  submitInvoiceToKsefAction,
} from '@/app/(app)/faktury/actions-ksef';
import { KSEF_STATUS_LABELS } from '@/lib/ksef/config';
import { CopyLinkButton } from '@/components/quotes/copy-link';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime, INVOICE_STATUSES, INVOICE_STATUS_TONES, PAYMENT_METHODS } from '@/lib/constants';

export const metadata = { title: 'Faktura' };

const WYNIK: Record<string, string> = {
  wyslano: 'Faktura oznaczona jako wysłana.',
  platnosc: 'Płatność zapisana.',
  anulowano: 'Faktura anulowana.',
  'ksef-gotowa': 'Faktura oznaczona jako gotowa do wysłania do KSeF.',
  'ksef-wyslana': 'Faktura przekazana do KSeF. Status ostateczny ustali KSeF — odśwież za chwilę.',
  'ksef-przyjeta': 'KSeF przyjął fakturę.',
  'ksef-stan': 'Stan KSeF odświeżony.',
  'ksef-upo': 'UPO pobrane z KSeF i zapisane w plikach firmy.',
};

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wynik?: string; blad?: string }>;
}) {
  const context = await requirePermission('invoice:read');
  const { id } = await params;
  const { wynik, blad } = await searchParams;

  const invoice = await getInvoice(context.organization.id, id);
  if (!invoice) notFound();

  const [items, payments] = await Promise.all([getInvoiceItems(id), getInvoicePayments(id)]);

  const currency = context.organization.currency;
  const statusLabel = INVOICE_STATUSES.find((item) => item.value === invoice.status)?.label ?? invoice.status;
  const remaining = invoice.totalCents - invoice.paidCents;
  const publicUrl = `${(process.env.APP_URL ?? '').replace(/\/$/, '')}/f/${invoice.publicToken}`;
  const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);
  const ksefEnabled = Boolean(process.env.KSEF_TOKEN && process.env.KSEF_NIP && process.env.KSEF_MODE);

  return (
    <>
      <PageHeader
        title={`Faktura ${invoice.number}`}
        description={`Wystawiona ${formatDate(invoice.issueDate)} · termin ${formatDate(invoice.dueDate)}`}
        breadcrumbs={
          <Link href="/faktury" className="hover:underline">
            Faktury
          </Link>
        }
        actions={
          <>
            <a href={`/api/faktury/${invoice.id}/pdf`} target="_blank" rel="noreferrer" className="btn-secondary">
              <Download className="h-4 w-4" /> PDF
            </a>
            {context.can('invoice:write') && invoice.status === 'DRAFT' ? (
              <form action={markInvoiceSentAction}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <SubmitButton>
                  <Send className="h-4 w-4" /> Oznacz jako wysłaną
                </SubmitButton>
              </form>
            ) : null}
          </>
        }
      />

      <div className="mb-4 space-y-2">
        {wynik && WYNIK[wynik] ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{WYNIK[wynik]}</div>
        ) : null}
        {blad ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Do zapłaty" value={formatMoney(remaining, currency)} tone={remaining > 0 ? 'danger' : 'success'} hint={`Brutto ${formatMoney(invoice.totalCents, currency)}`} />
        <Stat label="Opłacono" value={formatMoney(invoice.paidCents, currency)} tone="success" hint={`${payments.length} wpłat`} />
        <Stat label="Status" value={statusLabel} />
        <Stat label="Nabywca" value={invoice.buyerName} hint={invoice.buyerTaxId ? `NIP ${invoice.buyerTaxId}` : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Pozycje faktury" />
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
                      <td className="tabular">{Number(item.quantity)}</td>
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
            <CardBody className="border-t border-ink-100 bg-ink-50/60">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-600">Netto</dt>
                  <dd className="tabular">{formatMoney(invoice.subtotalCents, currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-600">VAT</dt>
                  <dd className="tabular">{formatMoney(invoice.taxCents, currency)}</dd>
                </div>
                <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-semibold">
                  <dt>Brutto</dt>
                  <dd className="tabular text-brand-700">{formatMoney(invoice.totalCents, currency)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Płatności" description="Wpłaty są księgowane ręcznie lub przez webhook Stripe (po skonfigurowaniu kluczy)." />
            <CardBody className="space-y-4">
              {payments.length === 0 ? (
                <p className="text-sm text-ink-500">Brak wpłat.</p>
              ) : (
                <ul className="space-y-2">
                  {payments.map((payment) => (
                    <li key={payment.id} className="flex items-center justify-between border-b border-ink-100 pb-2 text-sm">
                      <span className="text-ink-800">
                        {PAYMENT_METHODS.find((method) => method.value === payment.method)?.label ?? payment.method}
                        {payment.reference ? ` · ${payment.reference}` : ''}
                      </span>
                      <span className="tabular text-ink-600">
                        {formatMoney(payment.amountCents, currency)} · {formatDate(payment.paidAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {context.can('invoice:write') && invoice.status !== 'CANCELLED' && remaining > 0 ? (
                <form action={recordPaymentAction} className="space-y-3 rounded-lg border border-ink-200 p-3">
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Kwota">
                      <Input name="amount" type="number" step="0.01" min="0.01" required defaultValue={(remaining / 100).toFixed(2)} />
                    </Field>
                    <Field label="Sposób">
                      <Select name="method" defaultValue="BANK_TRANSFER">
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method.value} value={method.value}>
                            {method.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Referencja">
                      <Input name="reference" placeholder="Nr przelewu" />
                    </Field>
                  </div>
                  <SubmitButton variant="success">Zapisz wpłatę</SubmitButton>
                </form>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Link dla klienta" />
            <CardBody className="space-y-3">
              <p className="text-sm text-ink-600">Klient zobaczy fakturę bez logowania — tylko osoby znające link.</p>
              <div className="rounded-lg border border-ink-200 bg-ink-50 p-2 text-xs break-all text-ink-700">{publicUrl}</div>
              <CopyLinkButton url={publicUrl} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Płatność online" />
            <CardBody className="space-y-2 text-sm">
              {stripeEnabled ? (
                <>
                  <p className="text-ink-700">
                    Stripe jest skonfigurowany — płatność kartą jest obsługiwana przez webhook (status aktualizuje się po
                    potwierdzeniu z serwera Stripe).
                  </p>
                  <p className="inline-flex items-center gap-2 text-ink-500">
                    <CreditCard className="h-4 w-4" /> Formularz płatności pojawia się po zapisaniu metody „Stripe”.
                  </p>
                </>
              ) : (
                <p className="text-amber-800">
                  Płatności online są <strong>nieaktywne</strong>. Brak kluczy Stripe w konfiguracji — system ich nie
                  symuluje. Fakturę można opłacić przelewem: wpłatę księgujesz ręcznie powyżej.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="KSeF" description="Integracja zewnętrzna — numer KSeF nadaje wyłącznie KSeF." />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-500">Status KSeF</span>
                <Badge
                  tone={
                    invoice.ksefStatus === 'ACCEPTED'
                      ? 'success'
                      : invoice.ksefStatus === 'REJECTED' || invoice.ksefStatus === 'ERROR'
                        ? 'danger'
                        : invoice.ksefStatus === 'NOT_CONFIGURED'
                          ? 'neutral'
                          : 'info'
                  }
                >
                  {KSEF_STATUS_LABELS[invoice.ksefStatus] ?? invoice.ksefStatus}
                </Badge>
              </div>

              <div className="text-sm">
                <span className="text-ink-500">Numer KSeF: </span>
                {invoice.ksefNumber ? (
                  <span className="tabular font-medium text-ink-900">{invoice.ksefNumber}</span>
                ) : (
                  <span className="text-ink-500">nie nadano (numer przydziela KSeF)</span>
                )}
              </div>

              {invoice.ksefReferenceNumber ? (
                <p className="text-xs text-ink-500">Numer referencyjny: {invoice.ksefReferenceNumber}</p>
              ) : null}
              {invoice.ksefErrorMessage ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {invoice.ksefErrorMessage}
                </p>
              ) : null}
              {invoice.ksefUpoAvailable ? (
                <p className="text-xs text-emerald-700">
                  UPO pobrane{invoice.ksefUpoDownloadedAt ? ` (${formatDateTime(invoice.ksefUpoDownloadedAt)})` : ''}.
                </p>
              ) : null}

              {!ksefEnabled ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Integracja KSeF nie jest jeszcze skonfigurowana. Status faktury nie jest wysyłany ani udawany.
                </p>
              ) : context.can('invoice:ksef') ? (
                <div className="space-y-2">
                  {invoice.ksefStatus === 'NOT_CONFIGURED' || invoice.ksefStatus === 'REJECTED' || invoice.ksefStatus === 'ERROR' ? (
                    <form action={markInvoiceReadyForKsefAction}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <SubmitButton variant="secondary" className="w-full" size="sm">
                        Oznacz jako gotową
                      </SubmitButton>
                    </form>
                  ) : null}

                  {['READY', 'REJECTED', 'ERROR'].includes(invoice.ksefStatus) ? (
                    <form action={submitInvoiceToKsefAction}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <SubmitButton className="w-full" size="sm" confirm="Wysłać fakturę do KSeF?">
                        Wyślij do KSeF
                      </SubmitButton>
                    </form>
                  ) : null}

                  {['SUBMITTED', 'PROCESSING', 'ACCEPTED', 'SUBMITTING'].includes(invoice.ksefStatus) ? (
                    <form action={refreshKsefStatusAction}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <SubmitButton variant="secondary" className="w-full" size="sm">
                        Odśwież stan z KSeF
                      </SubmitButton>
                    </form>
                  ) : null}

                  {invoice.ksefStatus === 'ACCEPTED' && !invoice.ksefUpoAvailable ? (
                    <form action={downloadKsefUpoAction}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <SubmitButton variant="secondary" className="w-full" size="sm">
                        Pobierz UPO
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Szczegóły" />
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-500">Status</span>
                <Badge tone={INVOICE_STATUS_TONES[invoice.status] ?? 'neutral'}>{statusLabel}</Badge>
              </div>
              {invoice.sentAt ? (
                <div className="flex justify-between">
                  <span className="text-ink-500">Wysłana</span>
                  <span className="text-ink-800">{formatDateTime(invoice.sentAt)}</span>
                </div>
              ) : null}
              {invoice.paidAt ? (
                <div className="flex justify-between">
                  <span className="text-ink-500">Opłacona</span>
                  <span className="text-ink-800">{formatDateTime(invoice.paidAt)}</span>
                </div>
              ) : null}
              {invoice.notes ? <p className="whitespace-pre-wrap pt-2 text-ink-700">{invoice.notes}</p> : null}
            </CardBody>
          </Card>

          {context.can('invoice:write') && invoice.status !== 'CANCELLED' ? (
            <Card>
              <CardBody>
                <form action={cancelInvoiceAction}>
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <SubmitButton variant="danger" className="w-full" confirm="Anulować fakturę?">
                    Anuluj fakturę
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
