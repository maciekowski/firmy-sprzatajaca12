import { requirePermission } from '@/lib/auth/guards';
import { Card, CardBody, CardHeader, PageHeader, Field, Input, Textarea, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { createJobAction } from '@/app/(app)/zlecenia/actions';
import { listCustomersForSelect } from '@/lib/data/services';
import { listCrews, listMembers } from '@/lib/data/jobs';

export const metadata = { title: 'Nowe zlecenie' };

export default async function NewJobPage({ searchParams }: { searchParams: Promise<{ blad?: string }> }) {
  const context = await requirePermission('job:write');
  const { blad } = await searchParams;

  const [customers, crews, members] = await Promise.all([
    listCustomersForSelect(context.organization.id),
    listCrews(context.organization.id),
    listMembers(context.organization.id),
  ]);

  return (
    <>
      <PageHeader title="Nowe zlecenie" description="Zlecenie bez oferty — np. stała obsługa lub praca doraźna." />

      {blad ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
      ) : null}

      <form action={createJobAction}>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader title="Podstawowe informacje" />
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <Field label="Tytuł zlecenia" required className="sm:col-span-2">
                  <Input id="title" name="title" required placeholder="Sprzątanie biura po remoncie" />
                </Field>

                <Field label="Klient" required>
                  <Select id="customerId" name="customerId" required defaultValue="">
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

                <Field label="Adres realizacji">
                  <Select id="addressId" name="addressId" defaultValue="">
                    <option value="">Adres główny klienta</option>
                    {customers.flatMap((customer) =>
                      customer.addresses.map((address) => (
                        <option key={address.id} value={address.id}>
                          {customer.displayName} — {[address.label, address.city].filter(Boolean).join(', ')}
                        </option>
                      )),
                    )}
                  </Select>
                </Field>

                <Field label="Szacowany czas (min)">
                  <Input id="estimatedMinutes" name="estimatedMinutes" type="number" min={0} step={5} defaultValue={120} />
                </Field>

                <Field label="Uwagi dla ekipy" className="sm:col-span-2">
                  <Textarea id="notes" name="notes" rows={3} placeholder="Np. klucze u portiera, pies w mieszkaniu" />
                </Field>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Termin i ekipa" />
              <CardBody className="grid gap-4 sm:grid-cols-3">
                <Field label="Rozpoczęcie">
                  <Input id="scheduledStart" name="scheduledStart" type="datetime-local" />
                </Field>
                <Field label="Zakończenie">
                  <Input id="scheduledEnd" name="scheduledEnd" type="datetime-local" />
                </Field>
                <Field label="Ekipa">
                  <Select id="crewId" name="crewId" defaultValue="">
                    <option value="">Bez ekipy</option>
                    {crews.map((crew) => (
                      <option key={crew.id} value={crew.id}>
                        {crew.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </CardBody>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="Pracownicy" description="Osoby przypisane do zlecenia (pierwsza jest prowadzącym)." />
              <CardBody className="space-y-2">
                {members.length === 0 ? (
                  <p className="text-sm text-ink-500">Brak pracowników — dodaj ich w ustawieniach.</p>
                ) : (
                  members.map((member) => (
                    <label key={member.userId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50">
                      <input
                        type="checkbox"
                        name="assignedUserIds"
                        value={member.userId}
                        className="h-4 w-4 rounded border-ink-300"
                      />
                      <span className="text-ink-800">{member.name}</span>
                      <span className="ml-auto text-xs text-ink-500">{member.role}</span>
                    </label>
                  ))
                )}
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <SubmitButton className="w-full">Utwórz zlecenie</SubmitButton>
                <p className="mt-2 text-xs text-ink-500">
                  Zlecenie bez pozycji cenowych — wartość dodasz przy tworzeniu faktury lub przez ofertę.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </form>
    </>
  );
}
