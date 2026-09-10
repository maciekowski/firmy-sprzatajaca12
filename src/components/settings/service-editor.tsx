'use client';

import { useActionState, useState } from 'react';
import { Alert, Field, Input, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { saveServiceAction, type ServiceFormState } from '@/app/(app)/ustawienia/uslugi/actions';
import { PRICING_MODES, UNITS } from '@/lib/constants';

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  customUnitLabel: string | null;
  pricingMode: string;
  basePriceCents: number;
  hourlyRateCents: number | null;
  minPriceCents: number;
  taxRateBps: number | null;
  durationMinutes: number;
  isActive: boolean;
  sortOrder: number;
  tiers: { minQuantity: string; maxQuantity: string | null; unitPriceCents: number; flatFeeCents: number }[];
};

const empty: ServiceRow = {
  id: '',
  name: '',
  description: null,
  unit: 'VISIT',
  customUnitLabel: null,
  pricingMode: 'FIXED',
  basePriceCents: 0,
  hourlyRateCents: null,
  minPriceCents: 0,
  taxRateBps: null,
  durationMinutes: 60,
  isActive: true,
  sortOrder: 0,
  tiers: [],
};

const initialState: ServiceFormState = { ok: false };

export function ServiceEditor({ service, onClose }: { service?: ServiceRow; onClose: () => void }) {
  const [state, formAction] = useActionState(saveServiceAction, initialState);
  const [mode, setMode] = useState(service?.pricingMode ?? 'FIXED');
  const [tierRows, setTierRows] = useState<{ min: string; max: string; price: string; fee: string }[]>(
    service?.tiers?.length
      ? service.tiers.map((tier) => ({
          min: String(Number(tier.minQuantity)),
          max: tier.maxQuantity === null ? '' : String(Number(tier.maxQuantity)),
          price: (tier.unitPriceCents / 100).toFixed(2),
          fee: (tier.flatFeeCents / 100).toFixed(2),
        }))
      : [{ min: '0', max: '', price: '', fee: '' }],
  );

  const value = service ?? empty;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4">
      <div className="card w-full max-w-2xl p-6">
        <div className="flex items-start justify-between">
          <h2 className="section-title">{service ? 'Edycja usługi' : 'Nowa usługa'}</h2>
          <button type="button" onClick={onClose} className="text-sm text-ink-500 hover:text-ink-800">
            Zamknij
          </button>
        </div>

        {state.error ? (
          <Alert tone="danger" className="mt-3">
            {state.error}
          </Alert>
        ) : null}
        {state.message ? (
          <Alert tone="success" className="mt-3">
            {state.message}
          </Alert>
        ) : null}

        <form action={formAction} className="mt-4 space-y-4">
          {service ? <input type="hidden" name="serviceId" value={service.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nazwa usługi" required>
              <Input name="name" required defaultValue={value.name} placeholder="Sprzątanie mieszkania" />
            </Field>
            <Field label="Jednostka" required>
              <Select name="unit" defaultValue={value.unit}>
                {UNITS.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sposób wyceny" required>
              <Select
                name="pricingMode"
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                {PRICING_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Czas trwania (min)">
              <Input name="durationMinutes" type="number" min={0} step={5} defaultValue={value.durationMinutes} />
            </Field>
          </div>

          <Field label="Opis">
            <Textarea name="description" rows={2} defaultValue={value.description ?? ''} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            {mode === 'HOURLY' ? (
              <Field label="Stawka godzinowa (netto)">
                <Input name="hourlyRate" defaultValue={value.hourlyRateCents ? (value.hourlyRateCents / 100).toFixed(2) : ''} />
              </Field>
            ) : (
              <Field label={mode === 'PER_UNIT' ? 'Cena za jednostkę (netto)' : 'Cena (netto)'}>
                <Input name="basePrice" defaultValue={(value.basePriceCents / 100).toFixed(2)} />
              </Field>
            )}
            <Field label="Minimalna kwota zlecenia">
              <Input name="minPrice" defaultValue={(value.minPriceCents / 100).toFixed(2)} />
            </Field>
            <Field label="VAT (%)">
              <Input
                name="taxRatePercent"
                defaultValue={value.taxRateBps === null ? '' : (value.taxRateBps / 100).toString()}
                placeholder="wg ustawień firmy"
              />
            </Field>
          </div>

          {mode === 'TIERED' ? (
            <div className="rounded-lg border border-ink-200 p-3">
              <p className="stat-label">Progi ilościowe</p>
              <p className="mb-2 text-xs text-ink-500">Cena jest wybierana na podstawie ilości. Puste „do” oznacza brak górnego limitu.</p>
              {tierRows.map((row, index) => (
                <div key={index} className="mb-2 grid grid-cols-4 gap-2">
                  <Input name="tierMin" placeholder="od" defaultValue={row.min} />
                  <Input name="tierMax" placeholder="do" defaultValue={row.max} />
                  <Input name="tierPrice" placeholder="cena jedn." defaultValue={row.price} />
                  <Input name="tierFee" placeholder="opłata stała" defaultValue={row.fee} />
                </div>
              ))}
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setTierRows((rows) => [...rows, { min: '', max: '', price: '', fee: '' }])}
              >
                Dodaj próg
              </button>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" name="isActive" defaultChecked={value.isActive} className="h-4 w-4 rounded border-ink-300" />
            Usługa aktywna (widoczna w wycenach)
          </label>

          <div className="flex gap-2">
            <SubmitButton>Zapisz usługę</SubmitButton>
            <button type="button" onClick={onClose} className="btn-secondary">
              Anuluj
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ServiceListManager({ services }: { services: ServiceRow[] }) {
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          Dodaj usługę
        </button>
      </div>

      {services.length === 0 ? (
        <p className="text-sm text-ink-500">Brak usług. Dodaj pierwszą, żeby móc wyceniać pracę.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Jednostka</th>
                <th>Wycena</th>
                <th>Cena</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.id}>
                  <td className="font-medium text-ink-900">{service.name}</td>
                  <td className="text-ink-600">{UNITS.find((unit) => unit.value === service.unit)?.label ?? service.unit}</td>
                  <td className="text-ink-600">{PRICING_MODES.find((mode) => mode.value === service.pricingMode)?.label ?? service.pricingMode}</td>
                  <td className="tabular">
                    {(service.pricingMode === 'HOURLY' ? (service.hourlyRateCents ?? 0) : service.basePriceCents) / 100} zł
                  </td>
                  <td>
                    <span className={service.isActive ? 'text-emerald-700' : 'text-ink-500'}>
                      {service.isActive ? 'Aktywna' : 'Nieaktywna'}
                    </span>
                  </td>
                  <td className="text-right">
                    <button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => setEditing(service)}>
                      Edytuj
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating ? <ServiceEditor onClose={() => setCreating(false)} /> : null}
      {editing ? <ServiceEditor service={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
