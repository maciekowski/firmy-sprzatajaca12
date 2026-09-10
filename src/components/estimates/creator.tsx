'use client';

import { useActionState, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { saveEstimateAction } from '@/app/(app)/wyceny/actions';
import { formatMoney } from '@/lib/money';
import { unitLabel } from '@/lib/constants';

export type CreatorService = {
  id: string;
  name: string;
  unit: string;
  customUnitLabel: string | null;
  pricingMode: string;
  basePriceCents: number;
  hourlyRateCents: number | null;
  minPriceCents: number;
  taxRateBps: number | null;
  durationMinutes: number;
  tiers: { minQuantity: string; maxQuantity: string | null; unitPriceCents: number; flatFeeCents: number }[];
};

export type CreatorCustomer = {
  id: string;
  displayName: string;
  addresses: { id: string; label: string; street: string | null; city: string | null }[];
};

export type CreatorLine = {
  key: string;
  serviceId: string | null;
  name: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string; // w złotych — wygodne dla użytkownika
  taxRatePercent: string;
  isCustom: boolean;
};

type Preview = {
  subtotalCents: number;
  discountCents: number;
  travelCents: number;
  urgencyFeeCents: number;
  taxCents: number;
  totalCents: number;
  warnings: string[];
  lines: { netCents: number; grossCents: number; taxCents: number; discountCents: number }[];
};

function newLine(service?: CreatorService): CreatorLine {
  return {
    key: Math.random().toString(36).slice(2),
    serviceId: service?.id ?? null,
    name: service?.name ?? '',
    description: '',
    quantity: '1',
    unit: service?.unit ?? 'VISIT',
    unitPrice: service ? (service.basePriceCents / 100).toFixed(2) : '0.00',
    taxRatePercent: service?.taxRateBps != null ? (service.taxRateBps / 100).toFixed(2) : '',
    isCustom: !service,
  };
}

export function EstimateCreator({
  services,
  customers,
  organization,
  estimateId,
  initial,
}: {
  services: CreatorService[];
  customers: CreatorCustomer[];
  organization: {
    currency: string;
    defaultTaxRatePercent: number;
    travelFeeType: string;
    travelFlatFeeCents: number;
    travelPerKmCents: number;
    urgencySurchargePercent: number;
    minJobValueCents: number;
  };
  estimateId?: string;
  initial?: {
    customerId?: string;
    addressId?: string;
    lines?: CreatorLine[];
    discountPercent?: string;
    notes?: string;
    terms?: string;
    validUntil?: string;
    isUrgent?: boolean;
    travelDistanceKm?: string;
  };
}) {
  const [state, formAction] = useActionState(saveEstimateAction, { ok: false });

  const [customerId, setCustomerId] = useState(initial?.customerId ?? customers[0]?.id ?? '');
  const [addressId, setAddressId] = useState(initial?.addressId ?? '');
  const [lines, setLines] = useState<CreatorLine[]>(
    initial?.lines ?? (services.length > 0 ? [newLine(services[0])] : [newLine()]),
  );
  const [discountPercent, setDiscountPercent] = useState(initial?.discountPercent ?? '0');
  const [discountAmount, setDiscountAmount] = useState('0');
  const [isUrgent, setIsUrgent] = useState(initial?.isUrgent ?? false);
  const [travelType, setTravelType] = useState(organization.travelFeeType || 'NONE');
  const [travelFlatFee, setTravelFlatFee] = useState((organization.travelFlatFeeCents / 100).toFixed(2));
  const [travelPerKm, setTravelPerKm] = useState((organization.travelPerKmCents / 100).toFixed(2));
  const [travelDistanceKm, setTravelDistanceKm] = useState(initial?.travelDistanceKm ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [terms, setTerms] = useState(initial?.terms ?? '');
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedCustomer = useMemo(() => customers.find((customer) => customer.id === customerId), [customers, customerId]);

  const draftPayload = useMemo(
    () => ({
      customerId,
      addressId: addressId || null,
      lines: lines
        .filter((line) => line.name.trim().length > 0)
        .map((line) => ({
          serviceId: line.serviceId,
          name: line.name,
          description: line.description || null,
          quantity: Number(line.quantity.replace(',', '.')) || 0,
          unit: line.unit,
          unitPriceCents: Math.round((Number(line.unitPrice.replace(',', '.')) || 0) * 100),
          taxRateBps: Math.round((Number((line.taxRatePercent || organization.defaultTaxRatePercent.toString()).replace(',', '.')) || 0) * 100),
          isCustom: line.isCustom,
        })),
      discountBps: Math.round((Number(discountPercent.replace(',', '.')) || 0) * 100),
      discountCents: Math.round((Number(discountAmount.replace(',', '.')) || 0) * 100),
      travelFeeType: travelType,
      travelFlatFeeCents: Math.round((Number(travelFlatFee.replace(',', '.')) || 0) * 100),
      travelPerKmCents: Math.round((Number(travelPerKm.replace(',', '.')) || 0) * 100),
      travelDistanceKm: travelDistanceKm ? Number(travelDistanceKm.replace(',', '.')) : null,
      isUrgent,
    }),
    [
      customerId,
      addressId,
      lines,
      discountPercent,
      discountAmount,
      travelType,
      travelFlatFee,
      travelPerKm,
      travelDistanceKm,
      isUrgent,
      organization.defaultTaxRatePercent,
    ],
  );

  // Podgląd liczony po stronie serwera tym samym silnikiem cenowym, który zapisuje dokument.
  const refreshPreview = useCallback(async () => {
    if (draftPayload.lines.length === 0) {
      setPreview(null);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/wycena/podglad', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draftPayload),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setPreviewError(data.error ?? 'Nie udało się policzyć wyceny.');
        setPreview(null);
      } else {
        setPreview((await response.json()) as Preview);
        setPreviewError(null);
      }
    } catch {
      setPreviewError('Brak połączenia z serwerem.');
    } finally {
      setLoading(false);
    }
  }, [draftPayload]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void refreshPreview();
    }, 350);
    return () => clearTimeout(timeout);
  }, [refreshPreview]);

  const updateLine = (key: string, patch: Partial<CreatorLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const addLine = (service?: CreatorService) => setLines((current) => [...current, newLine(service)]);
  const removeLine = (key: string) => setLines((current) => (current.length === 1 ? current : current.filter((line) => line.key !== key)));

  const currency = organization.currency;

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-3">
      {estimateId ? <input type="hidden" name="estimateId" value={estimateId} /> : null}
      <input type="hidden" name="draft" value={JSON.stringify({ ...draftPayload, notes, terms, validUntil: validUntil || null })} />

      <div className="space-y-6 lg:col-span-2">
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}

        <Card>
          <CardHeader title="Klient i adres" />
          <CardBody className="grid gap-4 md:grid-cols-2">
            <Field label="Klient" required>
              <Select
                name="customerId"
                value={customerId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  setAddressId('');
                }}
                required
              >
                <option value="">Wybierz klienta</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName}
                  </option>
                ))}
              </Select>
              {customers.length === 0 ? (
                <p className="hint">
                  Nie masz jeszcze klientów.{' '}
                  <Link href="/klienci/nowy" className="text-brand-700 hover:underline">
                    Dodaj klienta
                  </Link>
                  .
                </p>
              ) : null}
            </Field>
            <Field label="Adres realizacji">
              <Select value={addressId} onChange={(event) => setAddressId(event.target.value)}>
                <option value="">Adres główny klienta</option>
                {selectedCustomer?.addresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.label}
                    {address.city ? ` — ${address.city}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Pozycje wyceny"
            description="Ceny liczy silnik cenowy — zgodnie z konfiguracją usługi (cena stała, za jednostkę, godzinowa lub progowa)."
            actions={
              <div className="flex gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => addLine()}>
                  <Plus className="h-3.5 w-3.5" /> Własna pozycja
                </button>
              </div>
            }
          />
          <CardBody className="space-y-4">
            {lines.map((line, index) => (
              <div key={line.key} className="rounded-lg border border-ink-200 p-3">
                <div className="grid gap-3 md:grid-cols-12">
                  <div className="md:col-span-4">
                    <Field label="Usługa">
                      <Select
                        value={line.serviceId ?? ''}
                        onChange={(event) => {
                          const service = services.find((item) => item.id === event.target.value);
                          if (!service) {
                            updateLine(line.key, { serviceId: null, isCustom: true });
                            return;
                          }
                          updateLine(line.key, {
                            serviceId: service.id,
                            name: service.name,
                            unit: service.unit,
                            unitPrice: (service.basePriceCents / 100).toFixed(2),
                            taxRatePercent:
                              service.taxRateBps != null
                                ? (service.taxRateBps / 100).toFixed(2)
                                : organization.defaultTaxRatePercent.toFixed(2),
                            isCustom: false,
                          });
                        }}
                      >
                        <option value="">Pozycja własna</option>
                        {services.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="md:col-span-4">
                    <Field label="Nazwa pozycji" required>
                      <Input
                        value={line.name}
                        onChange={(event) => updateLine(line.key, { name: event.target.value })}
                        placeholder="Np. mycie podjazdu"
                        required
                      />
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label="Ilość">
                      <Input
                        value={line.quantity}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                        inputMode="decimal"
                      />
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label="Jednostka">
                      <Select value={line.unit} onChange={(event) => updateLine(line.key, { unit: event.target.value })}>
                        <option value="HOUR">godz.</option>
                        <option value="SQM">m²</option>
                        <option value="PIECE">szt.</option>
                        <option value="ROOM">pom.</option>
                        <option value="VEHICLE">auto</option>
                        <option value="VISIT">wizyta</option>
                        <option value="FIXED">usł.</option>
                        <option value="CUSTOM">własna</option>
                      </Select>
                    </Field>
                  </div>
                  <div className="md:col-span-3">
                    <Field label="Cena jedn. (zł)">
                      <Input
                        value={line.unitPrice}
                        onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                        inputMode="decimal"
                      />
                    </Field>
                  </div>
                  <div className="md:col-span-3">
                    <Field label="VAT (%)">
                      <Input
                        value={line.taxRatePercent}
                        placeholder={organization.defaultTaxRatePercent.toFixed(2)}
                        onChange={(event) => updateLine(line.key, { taxRatePercent: event.target.value })}
                        inputMode="decimal"
                      />
                    </Field>
                  </div>
                  <div className="md:col-span-5">
                    <Field label="Opis (opcjonalnie)">
                      <Input
                        value={line.description}
                        onChange={(event) => updateLine(line.key, { description: event.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="md:col-span-1 flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      className="rounded-lg p-2 text-ink-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Usuń pozycję"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {preview?.lines[index] ? (
                  <p className="mt-2 text-xs text-ink-500">
                    Netto {formatMoney(preview.lines[index].netCents, currency)} · VAT{' '}
                    {formatMoney(preview.lines[index].taxCents, currency)} · Brutto{' '}
                    {formatMoney(preview.lines[index].grossCents, currency)}
                    {preview.lines[index].discountCents > 0
                      ? ` · rabat ${formatMoney(preview.lines[index].discountCents, currency)}`
                      : ''}
                  </p>
                ) : null}
                {line.serviceId ? (
                  <p className="mt-1 text-xs text-ink-400">
                    Jednostka rozliczeniowa usługi: {unitLabel(line.unit)}
                    {services.find((service) => service.id === line.serviceId)?.pricingMode === 'TIERED'
                      ? ' · ceny progowe'
                      : ''}
                  </p>
                ) : null}
              </div>
            ))}
            <button type="button" className="btn-ghost btn-sm" onClick={() => addLine()}>
              <Plus className="h-3.5 w-3.5" /> Dodaj pozycję
            </button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Rabat, dojazd i uwagi" />
          <CardBody className="grid gap-4 md:grid-cols-3">
            <Field label="Rabat (%)">
              <Input value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Rabat kwotowy (zł)">
              <Input value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Termin ważności">
              <Input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
            </Field>
            <Field label="Dojazd">
              <Select value={travelType} onChange={(event) => setTravelType(event.target.value)}>
                <option value="NONE">Bez opłaty</option>
                <option value="FLAT">Stała opłata</option>
                <option value="PER_KM">Za kilometr</option>
              </Select>
            </Field>
            {travelType === 'FLAT' ? (
              <Field label="Opłata za dojazd (zł)">
                <Input value={travelFlatFee} onChange={(event) => setTravelFlatFee(event.target.value)} inputMode="decimal" />
              </Field>
            ) : null}
            {travelType === 'PER_KM' ? (
              <>
                <Field label="Stawka za km (zł)">
                  <Input value={travelPerKm} onChange={(event) => setTravelPerKm(event.target.value)} inputMode="decimal" />
                </Field>
                <Field label="Dystans (km)">
                  <Input value={travelDistanceKm} onChange={(event) => setTravelDistanceKm(event.target.value)} inputMode="decimal" />
                </Field>
              </>
            ) : null}
            <div className="md:col-span-3">
              <label className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={isUrgent}
                  onChange={(event) => setIsUrgent(event.target.checked)}
                  className="h-4 w-4 rounded border-ink-300"
                />
                Zlecenie pilne
                {organization.urgencySurchargePercent > 0
                  ? ` (+${organization.urgencySurchargePercent}% od wartości netto)`
                  : ' (brak dopłaty skonfigurowanej w ustawieniach)'}
              </label>
            </div>
            <div className="md:col-span-3">
              <Field label="Uwagi na dokumencie">
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
            </div>
            <div className="md:col-span-3">
              <Field label="Warunki">
                <Textarea value={terms} onChange={(event) => setTerms(event.target.value)} />
              </Field>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="lg:sticky lg:top-20 lg:h-fit">
        <Card>
          <CardHeader title="Podsumowanie" description={loading ? 'Przeliczanie…' : 'Wyliczone silnikiem cenowym'} />
          <CardBody>
            {previewError ? <Alert tone="danger">{previewError}</Alert> : null}
            {preview ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-600">Suma netto</dt>
                  <dd className="tabular font-medium">{formatMoney(preview.subtotalCents, currency)}</dd>
                </div>
                {preview.discountCents > 0 ? (
                  <div className="flex justify-between text-emerald-700">
                    <dt>Rabat</dt>
                    <dd className="tabular">-{formatMoney(preview.discountCents, currency)}</dd>
                  </div>
                ) : null}
                {preview.travelCents > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Dojazd</dt>
                    <dd className="tabular">{formatMoney(preview.travelCents, currency)}</dd>
                  </div>
                ) : null}
                {preview.urgencyFeeCents > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-ink-600">Dopłata za pilność</dt>
                    <dd className="tabular">{formatMoney(preview.urgencyFeeCents, currency)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="text-ink-600">VAT</dt>
                  <dd className="tabular">{formatMoney(preview.taxCents, currency)}</dd>
                </div>
                <div className="flex justify-between border-t border-ink-200 pt-2 text-base font-semibold">
                  <dt>Razem brutto</dt>
                  <dd className="tabular text-brand-700">{formatMoney(preview.totalCents, currency)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-500">Dodaj pozycje, aby zobaczyć wyliczenie.</p>
            )}

            {preview?.warnings.length ? (
              <div className="mt-3 space-y-1">
                {preview.warnings.map((warning) => (
                  <p key={warning} className="text-xs text-amber-700">
                    {warning}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="mt-5">
              <SubmitButton className="w-full" size="lg" pendingLabel="Zapisywanie…">
                {estimateId ? 'Zapisz wycenę' : 'Zapisz wycenę'}
              </SubmitButton>
              <p className="mt-2 text-xs text-ink-500">
                Po zapisaniu wyceny utworzysz z niej ofertę z linkiem dla klienta.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </form>
  );
}
