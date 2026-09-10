'use client';

import { useActionState } from 'react';
import { Alert, Field, Input, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import {
  addCustomerAddressAction,
  addCustomerContactAction,
  createCustomerAction,
  updateCustomerAction,
} from '@/app/(app)/klienci/actions';
import { LEAD_SOURCES } from '@/lib/constants';
import type { FormState } from '@/lib/validation';
import type { Customer } from '@/lib/db/schema';

const initialState: FormState = { ok: false };

export function CustomerForm({ customer }: { customer?: Customer }) {
  const action = customer ? updateCustomerAction : createCustomerAction;
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-6">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}

      {customer ? <input type="hidden" name="customerId" value={customer.id} /> : null}

      <div className="card p-5">
        <h2 className="section-title">Dane podstawowe</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Typ klienta" required>
            <Select name="type" defaultValue={customer?.type ?? 'INDIVIDUAL'}>
              <option value="INDIVIDUAL">Klient indywidualny</option>
              <option value="COMPANY">Firma</option>
            </Select>
          </Field>
          <Field label="Źródło">
            <Select name="source" defaultValue={customer?.source ?? 'MANUAL'}>
              {LEAD_SOURCES.map((source) => (
                <option key={source.value} value={source.value}>
                  {source.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Imię" error={state.fieldErrors?.firstName}>
            <Input name="firstName" defaultValue={customer?.firstName ?? ''} />
          </Field>
          <Field label="Nazwisko" error={state.fieldErrors?.lastName}>
            <Input name="lastName" defaultValue={customer?.lastName ?? ''} />
          </Field>
          <Field label="Nazwa firmy" error={state.fieldErrors?.companyName}>
            <Input name="companyName" defaultValue={customer?.companyName ?? ''} />
          </Field>
          <Field label="NIP">
            <Input name="taxId" defaultValue={customer?.taxId ?? ''} />
          </Field>
          <Field label="Telefon" error={state.fieldErrors?.phone}>
            <Input name="phone" defaultValue={customer?.phone ?? ''} placeholder="+48 600 100 200" />
          </Field>
          <Field label="E-mail" error={state.fieldErrors?.email}>
            <Input name="email" type="email" defaultValue={customer?.email ?? ''} />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="section-title">Adres rozliczeniowy</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field label="Ulica i numer">
            <Input name="street" defaultValue={customer?.street ?? ''} />
          </Field>
          <Field label="Kod pocztowy">
            <Input name="postalCode" defaultValue={customer?.postalCode ?? ''} />
          </Field>
          <Field label="Miasto">
            <Input name="city" defaultValue={customer?.city ?? ''} />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="section-title">Dodatkowe</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Tagi" hint="Oddziel przecinkami, np. stały, biura">
            <Input name="tags" defaultValue={customer?.tags?.join(', ') ?? ''} />
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={customer?.status ?? 'ACTIVE'}>
              <option value="ACTIVE">Aktywny</option>
              <option value="INACTIVE">Nieaktywny</option>
              <option value="BLOCKED">Zablokowany</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Notatki">
              <Textarea name="notes" defaultValue={customer?.notes ?? ''} />
            </Field>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="section-title">Zgody na kontakt</h2>
        <p className="mt-1 text-sm text-ink-600">
          System nie wyśle wiadomości, jeśli klient nie wyraził zgody na dany kanał — komunikacja jest wtedy
          oznaczana jako pominięta.
        </p>
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              name="emailOptIn"
              defaultChecked={customer ? customer.emailOptIn : true}
              className="h-4 w-4 rounded border-ink-300"
            />
            Zgoda na kontakt e-mail
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              name="smsOptIn"
              defaultChecked={customer?.smsOptIn ?? false}
              className="h-4 w-4 rounded border-ink-300"
            />
            Zgoda na kontakt SMS
          </label>
          <Field label="Podstawa komunikacji" hint="Np. umowa, prawnie uzasadniony interes, zgoda.">
            <Input name="consentBasis" defaultValue={customer?.consentBasis ?? ''} />
          </Field>
        </div>
      </div>

      <div className="flex justify-end">
        <SubmitButton size="lg" pendingLabel="Zapisywanie…">
          {customer ? 'Zapisz zmiany' : 'Dodaj klienta'}
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddAddressForm({ customerId }: { customerId: string }) {
  const [state, formAction] = useActionState(addCustomerAddressAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">{state.message ?? 'Zapisano.'}</Alert> : null}
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Nazwa">
          <Input name="label" placeholder="Adres realizacji" />
        </Field>
        <Field label="Ulica">
          <Input name="street" />
        </Field>
        <Field label="Miasto">
          <Input name="city" />
        </Field>
        <Field label="Kod">
          <Input name="postalCode" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" name="isDefault" className="h-4 w-4 rounded border-ink-300" />
        Adres domyślny
      </label>
      <SubmitButton size="sm" pendingLabel="Dodawanie…">
        Dodaj adres
      </SubmitButton>
    </form>
  );
}

export function AddContactForm({ customerId }: { customerId: string }) {
  const [state, formAction] = useActionState(addCustomerContactAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">{state.message ?? 'Zapisano.'}</Alert> : null}
      <input type="hidden" name="customerId" value={customerId} />
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Imię i nazwisko" required>
          <Input name="name" required />
        </Field>
        <Field label="Rola">
          <Input name="role" placeholder="Kierownik" />
        </Field>
        <Field label="Telefon">
          <Input name="phone" />
        </Field>
        <Field label="E-mail">
          <Input name="email" type="email" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" name="isPrimary" className="h-4 w-4 rounded border-ink-300" />
        Główna osoba kontaktowa
      </label>
      <SubmitButton size="sm" pendingLabel="Dodawanie…">
        Dodaj kontakt
      </SubmitButton>
    </form>
  );
}
