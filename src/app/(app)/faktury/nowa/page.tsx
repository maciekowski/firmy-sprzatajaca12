import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guards';
import { Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { createInvoiceAction, createInvoiceFromJobAction } from '@/app/(app)/faktury/actions';
import { listCustomersForSelect } from '@/lib/data/services';
import { listInvoiceableJobs } from '@/lib/data/jobs';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/constants';

export const metadata = { title: 'Nowa faktura' };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ zlecenie?: string; blad?: string }>;
}) {
  const context = await requirePermission('invoice:write');
  const { zlecenie, blad } = await searchParams;

  const [jobs, customers] = await Promise.all([
    listInvoiceableJobs(context.organization.id),
    listCustomersForSelect(context.organization.id),
  ]);

  const currency = context.organization.currency;

  return (
    <>
      <PageHeader title="Nowa faktura" description="Wystaw fakturę z zakończonego zlecenia albo wpisz pozycje ręcznie." />

      {blad ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Z zakończonego zlecenia" description="Pozycje i kwoty są kopiowane ze zlecenia — bez ręcznego przepisywania." />
          <CardBody>
            {jobs.length === 0 ? (
              <EmptyState
                title="Brak zleceń do zafakturowania"
                description="Zakończ zlecenie, żeby pojawiło się na liście. Zlecenia z fakturą są pomijane."
              />
            ) : (
              <ul className="space-y-2">
                {jobs.map((job) => (
                  <li
                    key={job.id}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                      zlecenie === job.id ? 'border-brand-300 bg-brand-50' : 'border-ink-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <Link href={`/zlecenia/${job.id}`} className="text-sm font-medium text-ink-900 hover:underline">
                        {job.number} · {job.title}
                      </Link>
                      <p className="text-xs text-ink-500">
                        {job.customerName} · zakończone {formatDate(job.completedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular text-sm text-ink-800">{formatMoney(job.totalCents ?? 0, currency)}</span>
                      <form action={createInvoiceFromJobAction}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <SubmitButton size="sm">Wystaw</SubmitButton>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Faktura ręczna" description="Gdy fakturujesz coś spoza zlecenia (np. usługę stałą)." />
          <CardBody>
            <form action={createInvoiceAction} className="space-y-3">
              <Field label="Klient">
                <Select name="customerId" required defaultValue="">
                  <option value="" disabled>
                    Wybierz klienta
                  </option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.displayName}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="space-y-2 rounded-lg border border-ink-200 p-3">
                <p className="stat-label">Pozycje</p>
                {[0, 1, 2].map((index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-3">
                    <Input name="name" placeholder="Nazwa usługi" className="sm:col-span-1" />
                    <Input name="quantity" type="number" step="0.01" min="0" placeholder="Ilość" />
                    <Input name="unitPrice" type="number" step="0.01" min="0" placeholder="Cena netto" />
                  </div>
                ))}
                <p className="text-xs text-ink-500">Puste wiersze są pomijane. Ceny podajesz w złotówkach (netto).</p>
              </div>

              <Field label="Termin płatności (dni)">
                <Input name="paymentDays" type="number" min={0} defaultValue={14} />
              </Field>

              <Field label="Uwagi">
                <Textarea name="notes" rows={2} placeholder="Np. numer umowy" />
              </Field>

              <SubmitButton className="w-full">Utwórz fakturę</SubmitButton>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
