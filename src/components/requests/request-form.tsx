'use client';

import { useActionState } from 'react';
import { Alert, Field, Input, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { createRequestAction, type RequestFormState } from '@/app/(app)/zapytania/actions';

const initialState: RequestFormState = { ok: false };

export function RequestForm({
  services,
  customers,
}: {
  services: { id: string; name: string }[];
  customers: { id: string; displayName: string }[];
}) {
  const [state, formAction] = useActionState(createRequestAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <Field label="Treść zapytania" required hint="Wklej wiadomość od klienta — AI spróbuje wyłuskać zakres, termin i kontakt.">
        <Textarea
          name="description"
          rows={5}
          required
          placeholder="Dzień dobry, szukam kogoś do mycia kostki na podjeździe, około 60 m2, najlepiej w ten piątek po 14:00. Tel. 600100200"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Imię i nazwisko">
          <Input name="contactName" />
        </Field>
        <Field label="Telefon">
          <Input name="contactPhone" />
        </Field>
        <Field label="E-mail">
          <Input name="contactEmail" type="email" />
        </Field>
        <Field label="Istniejący klient">
          <Select name="customerId" defaultValue="">
            <option value="">Nowy kontakt (bez klienta)</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ulica">
          <Input name="street" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kod pocztowy">
            <Input name="postalCode" />
          </Field>
          <Field label="Miasto">
            <Input name="city" />
          </Field>
        </div>
        <Field label="Usługa (jeśli znana)">
          <Select name="serviceId" defaultValue="">
            <option value="">Nieokreślona</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kanał">
          <Select name="channel" defaultValue="MANUAL">
            <option value="MANUAL">Ręcznie</option>
            <option value="WEB_FORM">Formularz</option>
            <option value="EMAIL">E-mail</option>
            <option value="PHONE">Telefon</option>
            <option value="MESSENGER">Komunikator</option>
            <option value="API">API</option>
            <option value="OTHER">Inne</option>
          </Select>
        </Field>
        <Field label="Preferowana data">
          <Input name="preferredDate" type="date" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Godzina od">
            <Input name="preferredTimeFrom" type="time" />
          </Field>
          <Field label="Godzina do">
            <Input name="preferredTimeTo" type="time" />
          </Field>
        </div>
        <Field label="Pilność">
          <Select name="urgency" defaultValue="NORMAL">
            <option value="LOW">Niska</option>
            <option value="NORMAL">Normalna</option>
            <option value="HIGH">Wysoka</option>
          </Select>
        </Field>
      </div>

      <Field label="Notatki wewnętrzne">
        <Textarea name="notes" rows={2} />
      </Field>

      <SubmitButton>Zapisz zapytanie</SubmitButton>
    </form>
  );
}
