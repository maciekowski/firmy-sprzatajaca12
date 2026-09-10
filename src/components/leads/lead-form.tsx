'use client';

import { useActionState } from 'react';
import { Alert, Field, Input, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { createLeadAction, updateLeadAction, type LeadFormState } from '@/app/(app)/leady/actions';
import { LEAD_SOURCES } from '@/lib/constants';

const initialState: LeadFormState = { ok: false };

export type LeadFormValues = {
  id: string;
  title: string;
  description: string | null;
  source: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  serviceId: string | null;
  assignedToId: string | null;
  estimatedValueCents: number | null;
  followUpAt: Date | null;
};

function toDateInput(value: Date | null): string {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function LeadForm({
  lead,
  services,
  members,
}: {
  lead?: LeadFormValues;
  services: { id: string; name: string }[];
  members: { userId: string; name: string }[];
}) {
  const [state, formAction] = useActionState(lead ? updateLeadAction : createLeadAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      {lead ? <input type="hidden" name="leadId" value={lead.id} /> : null}

      <Field label="Tytuł leada" required>
        <Input name="title" required defaultValue={lead?.title ?? ''} placeholder="Sprzątanie biura, Kraków" />
      </Field>

      <Field label="Opis">
        <Textarea name="description" rows={3} defaultValue={lead?.description ?? ''} placeholder="Czego oczekuje klient, skąd się zgłosił" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Osoba kontaktowa">
          <Input name="contactName" defaultValue={lead?.contactName ?? ''} />
        </Field>
        <Field label="Telefon">
          <Input name="contactPhone" defaultValue={lead?.contactPhone ?? ''} />
        </Field>
        <Field label="E-mail">
          <Input name="contactEmail" type="email" defaultValue={lead?.contactEmail ?? ''} />
        </Field>
        <Field label="Źródło">
          <Select name="source" defaultValue={lead?.source ?? 'MANUAL'}>
            {LEAD_SOURCES.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ulica">
          <Input name="street" defaultValue={lead?.street ?? ''} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kod pocztowy">
            <Input name="postalCode" defaultValue={lead?.postalCode ?? ''} />
          </Field>
          <Field label="Miasto">
            <Input name="city" defaultValue={lead?.city ?? ''} />
          </Field>
        </div>
        <Field label="Usługa">
          <Select name="serviceId" defaultValue={lead?.serviceId ?? ''}>
            <option value="">Nieokreślona</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Opiekun">
          <Select name="assignedToId" defaultValue={lead?.assignedToId ?? ''}>
            <option value="">Bez opiekuna</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Szacowana wartość (zł)">
          <Input name="estimatedValue" defaultValue={lead?.estimatedValueCents ? (lead.estimatedValueCents / 100).toFixed(2) : ''} />
        </Field>
        <Field label="Przypomnienie (follow-up)">
          <Input name="followUpAt" type="date" defaultValue={toDateInput(lead?.followUpAt ?? null)} />
        </Field>
      </div>

      <SubmitButton>{lead ? 'Zapisz zmiany' : 'Utwórz leada'}</SubmitButton>
    </form>
  );
}
