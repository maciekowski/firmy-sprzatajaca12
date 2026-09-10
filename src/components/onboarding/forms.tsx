'use client';

import { useActionState } from 'react';
import { Alert, Field, Input, Select } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { inviteFirstWorkerAction, saveFirstServiceAction, saveOrganizationSetupAction } from '@/app/onboarding/actions';
import { BUSINESS_TYPES, CURRENCIES, PRICING_MODES, UNITS, WEEKDAYS } from '@/lib/constants';
import type { FormState } from '@/lib/validation';

const initialState: FormState = { ok: false };

type OrgDefaults = {
  name: string;
  businessType: string;
  city: string;
  serviceArea: string;
  currency: string;
  taxRatePercent: number;
  taxId: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  workingHours: Record<string, { from: string; to: string } | null> | null;
};

export function OrganizationSetupForm({ defaults }: { defaults: OrgDefaults }) {
  const [state, formAction] = useActionState(saveOrganizationSetupAction, initialState);

  return (
    <form action={formAction} className="card p-6">
      <h2 className="section-title">1. Dane firmy</h2>
      <p className="mt-1 text-sm text-ink-600">Te dane pojawią się na ofertach i fakturach.</p>

      {state.error ? (
        <Alert tone="danger" className="mt-4">
          {state.error}
        </Alert>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Nazwa firmy" error={state.fieldErrors?.name} required>
          <Input name="name" defaultValue={defaults.name} required />
        </Field>
        <Field label="Rodzaj działalności" error={state.fieldErrors?.businessType} required>
          <Select name="businessType" defaultValue={defaults.businessType} required>
            {BUSINESS_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Miasto" error={state.fieldErrors?.city}>
          <Input name="city" defaultValue={defaults.city} placeholder="Kraków" />
        </Field>
        <Field label="Obszar działania" error={state.fieldErrors?.serviceArea} hint="Np. Kraków i okolice do 40 km.">
          <Input name="serviceArea" defaultValue={defaults.serviceArea} />
        </Field>
        <Field label="Waluta" required>
          <Select name="currency" defaultValue={defaults.currency}>
            {CURRENCIES.map((currency) => (
              <option key={currency.value} value={currency.value}>
                {currency.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Stawka VAT (%)" error={state.fieldErrors?.taxRatePercent} hint="Domyślna stawka na dokumentach.">
          <Input name="taxRatePercent" type="number" step="0.01" min={0} max={100} defaultValue={defaults.taxRatePercent} />
        </Field>
        <Field label="NIP">
          <Input name="taxId" defaultValue={defaults.taxId} />
        </Field>
        <Field label="E-mail firmy">
          <Input name="email" type="email" defaultValue={defaults.email} />
        </Field>
        <Field label="Telefon">
          <Input name="phone" defaultValue={defaults.phone} />
        </Field>
        <Field label="Ulica i numer">
          <Input name="street" defaultValue={defaults.street} />
        </Field>
        <Field label="Kod pocztowy">
          <Input name="postalCode" defaultValue={defaults.postalCode} />
        </Field>
      </div>

      <div className="mt-6">
        <p className="label">Godziny pracy</p>
        <div className="space-y-2">
          {WEEKDAYS.map((day) => {
            const value = defaults.workingHours?.[day.key] ?? null;
            const isWeekend = day.key === 'saturday' || day.key === 'sunday';
            return (
              <div key={day.key} className="flex items-center gap-3">
                <label className="flex w-40 items-center gap-2 text-sm text-ink-700">
                  <input
                    type="checkbox"
                    name={`hours.${day.key}.enabled`}
                    defaultChecked={value ? true : !isWeekend}
                    className="h-4 w-4 rounded border-ink-300"
                  />
                  {day.label}
                </label>
                <Input
                  type="time"
                  name={`hours.${day.key}.from`}
                  defaultValue={value?.from ?? '08:00'}
                  className="w-32"
                />
                <span className="text-sm text-ink-400">–</span>
                <Input type="time" name={`hours.${day.key}.to`} defaultValue={value?.to ?? '16:00'} className="w-32" />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <SubmitButton size="lg" pendingLabel="Zapisywanie…">
          Dalej
        </SubmitButton>
      </div>
    </form>
  );
}

export function FirstServiceForm() {
  const [state, formAction] = useActionState(saveFirstServiceAction, initialState);

  return (
    <form action={formAction} className="card p-6">
      <h2 className="section-title">2. Pierwsza usługa</h2>
      <p className="mt-1 text-sm text-ink-600">
        Dodaj usługę, którą wykonujesz najczęściej. Pozostałe dodasz później w ustawieniach.
      </p>

      {state.error ? (
        <Alert tone="danger" className="mt-4">
          {state.error}
        </Alert>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Nazwa usługi" error={state.fieldErrors?.name} required>
          <Input name="name" required placeholder="Mycie kostki" />
        </Field>
        <Field label="Jednostka" required>
          <Select name="unit" defaultValue="SQM">
            {UNITS.map((unit) => (
              <option key={unit.value} value={unit.value}>
                {unit.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sposób wyceny" required>
          <Select name="pricingMode" defaultValue="PER_UNIT">
            {PRICING_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cena (zł)" error={state.fieldErrors?.basePrice} hint="Cena za jednostkę lub cena stała.">
          <Input name="basePrice" type="number" step="0.01" min={0} defaultValue={4} />
        </Field>
        <Field label="Czas trwania (min)">
          <Input name="durationMinutes" type="number" min={5} defaultValue={60} />
        </Field>
        <Field label="Minimalna cena (zł)" hint="Opcjonalnie — np. minimum za zlecenie.">
          <Input name="minPrice" type="number" step="0.01" min={0} defaultValue={0} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Opis">
            <Input name="description" />
          </Field>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <SubmitButton variant="ghost" name="skip" value="1" pendingLabel="Pomijanie…">
          Pomiń ten krok
        </SubmitButton>
        <SubmitButton size="lg" pendingLabel="Zapisywanie…">
          Dalej
        </SubmitButton>
      </div>
    </form>
  );
}

export function FirstWorkerForm() {
  const [state, formAction] = useActionState(inviteFirstWorkerAction, initialState);

  return (
    <form action={formAction} className="card p-6">
      <h2 className="section-title">3. Pracownik</h2>
      <p className="mt-1 text-sm text-ink-600">
        Dodaj członka ekipy. Jeśli nie ma jeszcze konta, otrzyma zaproszenie e-mailem.
      </p>

      {state.error ? (
        <Alert tone="danger" className="mt-4">
          {state.error}
        </Alert>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="E-mail pracownika" error={state.fieldErrors?.email}>
          <Input name="email" type="email" placeholder="pracownik@firma.pl" />
        </Field>
        <Field label="Rola">
          <Select name="role" defaultValue="WORKER">
            <option value="WORKER">Pracownik</option>
            <option value="DISPATCHER">Dyspozytor</option>
            <option value="VIEWER">Podgląd</option>
          </Select>
        </Field>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <SubmitButton variant="ghost" name="skip" value="1" pendingLabel="Pomijanie…">
          Pomiń ten krok
        </SubmitButton>
        <SubmitButton size="lg" pendingLabel="Kończenie…">
          Zakończ konfigurację
        </SubmitButton>
      </div>
    </form>
  );
}
