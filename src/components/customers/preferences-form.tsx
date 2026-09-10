'use client';

import { useActionState } from 'react';
import { Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { updateCustomerPreferencesAction } from '@/app/(app)/klienci/actions';
import type { FormState } from '@/lib/validation';

const initialState: FormState = { ok: false };

export type CustomerPreferences = {
  emailOptIn: boolean;
  smsOptIn: boolean;
  emailTransactionalOptIn: boolean;
  emailSystemOptIn: boolean;
  emailAutomationOptIn: boolean;
  emailMarketingOptIn: boolean;
  consentBasis: string | null;
};

const TOGGLES: { name: keyof CustomerPreferences; label: string; hint: string }[] = [
  { name: 'emailOptIn', label: 'Kanał: e-mail', hint: 'Wyłączenie blokuje wszystkie wiadomości e-mail.' },
  { name: 'smsOptIn', label: 'Kanał: SMS', hint: 'Wymaga skonfigurowanego providera SMS.' },
  { name: 'emailTransactionalOptIn', label: 'Transakcyjne', hint: 'Oferty, faktury, potwierdzenia realizacji usługi.' },
  { name: 'emailSystemOptIn', label: 'Systemowe', hint: 'Linki do portalu, zmiany terminów.' },
  { name: 'emailAutomationOptIn', label: 'Automatyczne', hint: 'Follow-upy i prośby o opinię.' },
  { name: 'emailMarketingOptIn', label: 'Marketingowe', hint: 'Promocje i oferty specjalne — domyślnie wyłączone.' },
];

/**
 * Preferencje wiadomości klienta.
 * Kategoria marketingowa jest domyślnie wyłączona — wymaga wyraźnej zgody.
 */
export function CustomerPreferencesForm({
  customerId,
  preferences,
}: {
  customerId: string;
  preferences: CustomerPreferences;
}) {
  const [state, formAction] = useActionState(updateCustomerPreferencesAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="customerId" value={customerId} />

      <div className="space-y-2">
        {TOGGLES.map((toggle) => (
          <label key={toggle.name} className="flex items-start gap-3 rounded-lg border border-ink-200 p-3">
            <input
              type="checkbox"
              name={toggle.name}
              defaultChecked={Boolean(preferences[toggle.name])}
              className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              <span className="block text-sm font-medium text-ink-900">{toggle.label}</span>
              <span className="block text-xs text-ink-500">{toggle.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <Field label="Podstawa zgody" hint="np. umowa, formularz kontaktowy, zgoda ustna — pole opcjonalne.">
        <Input name="consentBasis" defaultValue={preferences.consentBasis ?? ''} placeholder="Umowa nr …" />
      </Field>

      {state.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{state.error}</p>
      ) : null}
      {state.ok && state.message ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{state.message}</p>
      ) : null}

      <SubmitButton>Zapisz preferencje</SubmitButton>
    </form>
  );
}
