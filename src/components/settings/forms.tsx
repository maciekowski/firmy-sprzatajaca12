'use client';

import { useActionState } from 'react';
import { Alert, Field, Input, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { inviteMemberAction, saveSettingsAction, type SettingsState } from '@/app/(app)/ustawienia/actions';

const initialState: SettingsState = { ok: false };

export type OrgSettings = {
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  serviceArea: string | null;
  currency: string;
  taxRateBps: number;
  paymentTermsDays: number;
  invoicePrefix: string;
  quotePrefix: string;
  jobPrefix: string;
  estimatePrefix: string;
  invoiceNotes: string | null;
  quoteTerms: string | null;
  travelFeeType: string;
  travelFlatFeeCents: number;
  travelPerKmCents: number;
  urgencySurchargeBps: number;
  minJobValueCents: number;
  completionRequirements: {
    requireChecklist: boolean;
    requireAfterPhotos: boolean;
    minAfterPhotos: number;
    requireNote: boolean;
  } | null;
};

export function SettingsForm({ organization }: { organization: OrgSettings }) {
  const [state, formAction] = useActionState(saveSettingsAction, initialState);
  const requirements = organization.completionRequirements;

  return (
    <form action={formAction} className="space-y-6">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <div className="card p-5">
        <h2 className="section-title">Dane firmy</h2>
        <p className="mt-1 text-sm text-ink-600">Dane trafiają na oferty i faktury.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Nazwa firmy" required>
            <Input name="name" required defaultValue={organization.name} />
          </Field>
          <Field label="NIP">
            <Input name="taxId" defaultValue={organization.taxId ?? ''} />
          </Field>
          <Field label="E-mail">
            <Input name="email" type="email" defaultValue={organization.email ?? ''} />
          </Field>
          <Field label="Telefon">
            <Input name="phone" defaultValue={organization.phone ?? ''} />
          </Field>
          <Field label="Ulica">
            <Input name="street" defaultValue={organization.street ?? ''} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kod pocztowy">
              <Input name="postalCode" defaultValue={organization.postalCode ?? ''} />
            </Field>
            <Field label="Miasto">
              <Input name="city" defaultValue={organization.city ?? ''} />
            </Field>
          </div>
          <Field label="Obszar działania">
            <Input name="serviceArea" defaultValue={organization.serviceArea ?? ''} placeholder="Kraków i okolice 30 km" />
          </Field>
          <Field label="Strona www">
            <Input name="website" defaultValue={organization.website ?? ''} />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="section-title">Pieniądze</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Waluta">
            <Select name="currency" defaultValue={organization.currency}>
              <option value="PLN">PLN</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="CZK">CZK</option>
            </Select>
          </Field>
          <Field label="Domyślna stawka VAT (%)">
            <Input name="taxRatePercent" type="number" step="0.5" min={0} max={100} defaultValue={organization.taxRateBps / 100} />
          </Field>
          <Field label="Termin płatności (dni)">
            <Input name="paymentTermsDays" type="number" min={0} defaultValue={organization.paymentTermsDays} />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Dojazd">
            <Select name="travelFeeType" defaultValue={organization.travelFeeType}>
              <option value="NONE">Brak opłaty</option>
              <option value="FLAT">Stała kwota</option>
              <option value="PER_KM">Za kilometr</option>
            </Select>
          </Field>
          <Field label="Stała kwota dojazdu (zł)">
            <Input name="travelFlatFee" defaultValue={(organization.travelFlatFeeCents / 100).toFixed(2)} />
          </Field>
          <Field label="Stawka za km (zł)">
            <Input name="travelPerKm" defaultValue={(organization.travelPerKmCents / 100).toFixed(2)} />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Dopłata za pilne zlecenie (%)">
            <Input name="urgencySurchargePercent" type="number" min={0} step={1} defaultValue={organization.urgencySurchargeBps / 100} />
          </Field>
          <Field label="Minimalna wartość zlecenia (zł)" hint="Jeśli wycena jest niższa, system doliczy do minimum.">
            <Input name="minJobValue" defaultValue={(organization.minJobValueCents / 100).toFixed(2)} />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="section-title">Numery dokumentów</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Field label="Wyceny">
            <Input name="estimatePrefix" defaultValue={organization.estimatePrefix} />
          </Field>
          <Field label="Oferty">
            <Input name="quotePrefix" defaultValue={organization.quotePrefix} />
          </Field>
          <Field label="Zlecenia">
            <Input name="jobPrefix" defaultValue={organization.jobPrefix} />
          </Field>
          <Field label="Faktury">
            <Input name="invoicePrefix" defaultValue={organization.invoicePrefix} />
          </Field>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Numeracja jest nadawana atomowo w bazie (licznik na firmę + rok + miesiąc). Nie ma ryzyka dwóch identycznych numerów.
        </p>
      </div>

      <div className="card p-5">
        <h2 className="section-title">Wymagania przy zakończeniu zlecenia</h2>
        <p className="mt-1 text-sm text-ink-600">
          Zaznacz, co musi być spełnione, zanim pracownik będzie mógł zakończyć zlecenie. System naprawdę to sprawdza.
        </p>
        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2 text-sm text-ink-800">
            <input type="checkbox" name="requireChecklist" defaultChecked={requirements?.requireChecklist ?? false} className="h-4 w-4 rounded border-ink-300" />
            Checklista w całości odhaczona
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-800">
            <input type="checkbox" name="requireAfterPhotos" defaultChecked={requirements?.requireAfterPhotos ?? false} className="h-4 w-4 rounded border-ink-300" />
            Zdjęcie „po” (minimum poniżej)
          </label>
          <Field label="Minimalna liczba zdjęć „po”">
            <Input name="minAfterPhotos" type="number" min={1} defaultValue={requirements?.minAfterPhotos ?? 1} className="w-32" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-800">
            <input type="checkbox" name="requireNote" defaultChecked={requirements?.requireNote ?? false} className="h-4 w-4 rounded border-ink-300" />
            Notatka końcowa
          </label>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="section-title">Szablony treści</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Domyślne uwagi na fakturze">
            <Textarea name="invoiceNotes" rows={3} defaultValue={organization.invoiceNotes ?? ''} />
          </Field>
          <Field label="Domyślne warunki oferty">
            <Textarea name="quoteTerms" rows={3} defaultValue={organization.quoteTerms ?? ''} />
          </Field>
        </div>
      </div>

      <SubmitButton>Zapisz ustawienia</SubmitButton>
    </form>
  );
}

export function InviteMemberForm() {
  const [state, formAction] = useActionState(inviteMemberAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="E-mail">
          <Input name="email" type="email" required placeholder="jan@firma.pl" />
        </Field>
        <Field label="Rola">
          <Select name="role" defaultValue="WORKER">
            <option value="ADMIN">Administrator</option>
            <option value="DISPATCHER">Dyspozytor</option>
            <option value="WORKER">Pracownik</option>
            <option value="VIEWER">Obserwator</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <SubmitButton variant="secondary" className="w-full">
            Dodaj osobę
          </SubmitButton>
        </div>
      </div>
      <p className="text-xs text-ink-500">
        Jeśli osoba nie ma konta, zostanie utworzone konto z losowym hasłem, którego nikt nie zna — hasło ustawia się
        przez „reset hasła”. Zaproszenie e-mail wymaga skonfigurowanej wysyłki (Resend); bez tego system nie udaje wysłania.
      </p>
    </form>
  );
}
