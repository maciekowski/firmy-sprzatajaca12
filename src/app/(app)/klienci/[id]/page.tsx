import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { getCustomer, getCustomerTimeline, listAddresses, listContacts } from '@/lib/data/customers';
import { Badge, ButtonLink, Card, CardBody, CardHeader, PageHeader, Stat } from '@/components/ui';
import { AddAddressForm, AddContactForm, CustomerForm } from '@/components/customers/forms';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime } from '@/lib/constants';
import { INVOICE_STATUS_TONES, JOB_STATUS_TONES, QUOTE_STATUS_TONES } from '@/lib/constants';
import { CustomerPreferencesForm } from '@/components/customers/preferences-form';
import { CustomerPortalCard } from '@/components/customers/portal-card';

export const metadata = { title: 'Klient' };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requirePermission('customer:read');
  const { id } = await params;
  const customer = await getCustomer(context.organization.id, id);
  if (!customer) notFound();

  const [addresses, contacts, timeline] = await Promise.all([
    listAddresses(context.organization.id, id),
    listContacts(context.organization.id, id),
    getCustomerTimeline(context.organization.id, id),
  ]);

  const currency = context.organization.currency;
  const totalInvoiced = timeline.invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const unpaid = timeline.invoices.reduce((sum, invoice) => sum + (invoice.totalCents - invoice.paidCents), 0);
  const lastJob = timeline.jobs[0];

  return (
    <>
      <PageHeader
        title={customer.displayName}
        description={customer.type === 'COMPANY' ? 'Klient firmowy' : 'Klient indywidualny'}
        breadcrumbs={
          <Link href="/klienci" className="hover:underline">
            Klienci
          </Link>
        }
        actions={
          <>
            <ButtonLink href={`/wyceny/nowa?klient=${customer.id}`} variant="primary">
              Nowa wycena
            </ButtonLink>
            <ButtonLink href={`/zlecenia/nowe?klient=${customer.id}`} variant="secondary">
              Nowe zlecenie
            </ButtonLink>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Wartość zleceń" value={formatMoney(customer && timeline.jobs.reduce((sum, job) => sum + job.totalCents, 0), currency)} hint={`${timeline.jobs.length} zleceń`} />
        <Stat label="Zafakturowane" value={formatMoney(totalInvoiced, currency)} hint={`${timeline.invoices.length} faktur`} />
        <Stat label="Niezapłacone" value={formatMoney(unpaid, currency)} tone={unpaid > 0 ? 'danger' : 'neutral'} />
        <Stat label="Ostatnie zlecenie" value={lastJob ? formatDate(lastJob.createdAt) : '—'} hint={lastJob?.number ?? ''} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Dane klienta" />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="stat-label">Kontakt</p>
                <p className="mt-1 text-sm text-ink-800">{customer.phone ?? '—'}</p>
                <p className="text-sm text-ink-800">{customer.email ?? '—'}</p>
              </div>
              <div>
                <p className="stat-label">Adres</p>
                <p className="mt-1 text-sm text-ink-800">
                  {[customer.street, customer.postalCode, customer.city].filter(Boolean).join(', ') || '—'}
                </p>
                {customer.taxId ? <p className="text-sm text-ink-500">NIP: {customer.taxId}</p> : null}
              </div>
              <div>
                <p className="stat-label">Źródło</p>
                <p className="mt-1 text-sm text-ink-800">{customer.source}</p>
              </div>
              <div>
                <p className="stat-label">Zgody</p>
                <p className="mt-1 text-sm text-ink-800">
                  E-mail: {customer.emailOptIn ? 'tak' : 'nie'} · SMS: {customer.smsOptIn ? 'tak' : 'nie'}
                </p>
              </div>
              {customer.notes ? (
                <div className="sm:col-span-2">
                  <p className="stat-label">Notatki</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{customer.notes}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Konto klienta" description="Prywatny link dla klienta — bez logowania widzi swoje oferty, zlecenia i faktury." />
            <CardBody>
              {context.can('customer:write') ? (
                <CustomerPortalCard
                  customerId={customer.id}
                  portalToken={customer.portalToken ?? null}
                  appUrl={process.env.APP_URL ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')}
                />
              ) : (
                <p className="text-sm text-ink-500">Brak uprawnień do zarządzania dostępem klienta.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Adresy realizacji" />
            <CardBody>
              {addresses.length === 0 ? (
                <p className="text-sm text-ink-500">Brak dodatkowych adresów.</p>
              ) : (
                <ul className="mb-5 divide-y divide-ink-100">
                  {addresses.map((address) => (
                    <li key={address.id} className="flex items-center justify-between gap-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-ink-900">
                          {address.label}
                          {address.isDefault ? (
                            <Badge tone="info" className="ml-2">
                              domyślny
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-xs text-ink-500">
                          {[address.street, address.postalCode, address.city].filter(Boolean).join(', ') || '—'}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {context.can('customer:write') ? <AddAddressForm customerId={customer.id} /> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Osoby kontaktowe" />
            <CardBody>
              {contacts.length === 0 ? (
                <p className="text-sm text-ink-500">Brak dodatkowych osób kontaktowych.</p>
              ) : (
                <ul className="mb-5 divide-y divide-ink-100">
                  {contacts.map((contact) => (
                    <li key={contact.id} className="flex items-center justify-between gap-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-ink-900">
                          {contact.name}
                          {contact.isPrimary ? (
                            <Badge tone="info" className="ml-2">
                              główny
                            </Badge>
                          ) : null}
                        </p>
                        <p className="text-xs text-ink-500">
                          {[contact.role, contact.phone, contact.email].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {context.can('customer:write') ? <AddContactForm customerId={customer.id} /> : null}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Zlecenia" />
            <CardBody>
              {timeline.jobs.length === 0 ? (
                <p className="text-sm text-ink-500">Brak zleceń.</p>
              ) : (
                <ul className="space-y-2">
                  {timeline.jobs.slice(0, 8).map((job) => (
                    <li key={job.id}>
                      <Link href={`/zlecenia/${job.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-50">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-900">{job.title}</p>
                          <p className="text-xs text-ink-500">{job.number}</p>
                        </div>
                        <Badge tone={JOB_STATUS_TONES[job.status] ?? 'neutral'}>{job.status}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Oferty" />
            <CardBody>
              {timeline.quotes.length === 0 ? (
                <p className="text-sm text-ink-500">Brak ofert.</p>
              ) : (
                <ul className="space-y-2">
                  {timeline.quotes.slice(0, 8).map((quote) => (
                    <li key={quote.id}>
                      <Link href={`/oferty/${quote.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-50">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-900">{quote.number}</p>
                          <p className="text-xs text-ink-500">{formatMoney(quote.totalCents, currency)}</p>
                        </div>
                        <Badge tone={QUOTE_STATUS_TONES[quote.status] ?? 'neutral'}>{quote.status}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Faktury" />
            <CardBody>
              {timeline.invoices.length === 0 ? (
                <p className="text-sm text-ink-500">Brak faktur.</p>
              ) : (
                <ul className="space-y-2">
                  {timeline.invoices.slice(0, 8).map((invoice) => (
                    <li key={invoice.id}>
                      <Link href={`/faktury/${invoice.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-50">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-900">{invoice.number}</p>
                          <p className="text-xs text-ink-500">
                            {formatMoney(invoice.totalCents, currency)} · termin {formatDate(invoice.dueDate)}
                          </p>
                        </div>
                        <Badge tone={INVOICE_STATUS_TONES[invoice.status] ?? 'neutral'}>{invoice.status}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {context.can('customer:write') ? (
        <>
          <Card className="mt-6">
            <CardHeader
              title="Preferencje wiadomości"
              description="Zgody są rozpatrywane osobno dla kanału i kategorii. Wiadomości marketingowe są domyślnie wyłączone — wymagają wyraźnej zgody klienta."
            />
            <CardBody>
              <CustomerPreferencesForm
                customerId={customer.id}
                preferences={{
                  emailOptIn: customer.emailOptIn,
                  smsOptIn: customer.smsOptIn,
                  emailTransactionalOptIn: customer.emailTransactionalOptIn,
                  emailSystemOptIn: customer.emailSystemOptIn,
                  emailAutomationOptIn: customer.emailAutomationOptIn,
                  emailMarketingOptIn: customer.emailMarketingOptIn,
                  consentBasis: customer.consentBasis,
                }}
              />
            </CardBody>
          </Card>

          <Card className="mt-6">
            <CardHeader title="Edycja danych" description="Zmiany zapisujesz tym samym formularzem, którego użyłeś przy dodawaniu klienta." />
            <CardBody>
              <CustomerForm customer={customer} />
            </CardBody>
          </Card>
        </>
      ) : null}
    </>
  );
}
