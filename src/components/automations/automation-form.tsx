'use client';

import { useActionState, useState } from 'react';
import { Alert, Field, Input, Select, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { saveAutomationAction, type AutomationFormState } from '@/app/(app)/automatyzacje/actions';

const initialState: AutomationFormState = { ok: false };

const TRIGGERS: { value: string; label: string }[] = [
  { value: 'QUOTE_SENT', label: 'Oferta wysłana' },
  { value: 'QUOTE_VIEWED', label: 'Oferta wyświetlona' },
  { value: 'QUOTE_ACCEPTED', label: 'Oferta zaakceptowana' },
  { value: 'JOB_CREATED', label: 'Utworzono zlecenie' },
  { value: 'JOB_SCHEDULED', label: 'Zlecenie zaplanowane' },
  { value: 'JOB_COMPLETED', label: 'Zlecenie zakończone' },
  { value: 'JOB_NO_SHOW', label: 'Nieobecność klienta' },
  { value: 'INVOICE_SENT', label: 'Faktura wysłana' },
  { value: 'INVOICE_OVERDUE', label: 'Faktura przeterminowana' },
  { value: 'PAYMENT_RECEIVED', label: 'Otrzymano płatność' },
  { value: 'LEAD_CREATED', label: 'Utworzono leada' },
  { value: 'REQUEST_CREATED', label: 'Nowe zapytanie' },
  { value: 'CUSTOMER_INACTIVE', label: 'Klient nieaktywny' },
];

const ACTIONS: { value: string; label: string }[] = [
  { value: 'SEND_EMAIL', label: 'Wyślij e-mail' },
  { value: 'SEND_SMS', label: 'Wyślij SMS' },
  { value: 'CREATE_NOTIFICATION', label: 'Utwórz powiadomienie w systemie' },
  { value: 'CREATE_FOLLOW_UP_TASK', label: 'Utwórz zadanie follow-up' },
  { value: 'SEND_REVIEW_REQUEST', label: 'Wyślij prośbę o opinię' },
  { value: 'UPDATE_JOB_STATUS', label: 'Zmień status zlecenia' },
];

export type AutomationValues = {
  id: string;
  name: string;
  trigger: string;
  action: string;
  delayMinutes: number;
  conditions: { onlyIfUnaccepted?: boolean | null; minValueCents?: number | null } | null;
  actionConfig: { subject?: string | null; body?: string | null; message?: string | null; status?: string | null; channel?: string | null } | null;
  isActive: boolean;
};

export function AutomationForm({ automation }: { automation?: AutomationValues }) {
  const [state, formAction] = useActionState(saveAutomationAction, initialState);
  const [action, setAction] = useState(automation?.action ?? 'SEND_EMAIL');

  const delayMinutes = automation?.delayMinutes ?? 0;

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      {automation ? <input type="hidden" name="automationId" value={automation.id} /> : null}

      <Field label="Nazwa automatyzacji" required>
        <Input name="name" required defaultValue={automation?.name ?? ''} placeholder="Przypomnienie o niezaakceptowanej ofercie" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Wyzwalacz" required hint="Zdarzenie, które uruchamia automatyzację.">
          <Select name="trigger" defaultValue={automation?.trigger ?? 'QUOTE_SENT'}>
            {TRIGGERS.map((trigger) => (
              <option key={trigger.value} value={trigger.value}>
                {trigger.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Akcja" required>
          <Select name="action" value={action} onChange={(event) => setAction(event.target.value)}>
            {ACTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Opóźnienie — dni">
          <Input name="delayDays" type="number" min={0} defaultValue={Math.floor(delayMinutes / (24 * 60))} />
        </Field>
        <Field label="Opóźnienie — godziny">
          <Input name="delayHours" type="number" min={0} defaultValue={Math.floor((delayMinutes % (24 * 60)) / 60)} />
        </Field>
      </div>

      <div className="space-y-2 rounded-lg border border-ink-200 p-3">
        <p className="stat-label">Warunki</p>
        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input
            type="checkbox"
            name="onlyIfUnaccepted"
            defaultChecked={Boolean(automation?.conditions?.onlyIfUnaccepted)}
            className="h-4 w-4 rounded border-ink-300"
          />
          Tylko jeśli oferta nadal nie jest zaakceptowana (dotyczy ofert)
        </label>
        <Field label="Minimalna wartość dokumentu (zł)">
          <Input
            name="minValue"
            defaultValue={automation?.conditions?.minValueCents ? (automation.conditions.minValueCents / 100).toFixed(2) : ''}
            placeholder="bez limitu"
          />
        </Field>
      </div>

      {action === 'SEND_EMAIL' || action === 'SEND_SMS' ? (
        <div className="space-y-3 rounded-lg border border-ink-200 p-3">
          <p className="stat-label">Treść</p>
          {action === 'SEND_EMAIL' ? (
            <Field label="Temat">
              <Input name="subject" defaultValue={automation?.actionConfig?.subject ?? ''} placeholder="Przypomnienie o ofercie {{quoteNumber}}" />
            </Field>
          ) : null}
          <Field label="Treść" hint="Dostępne zmienne: {{customerName}}, {{companyName}}, {{quoteNumber}}, {{quoteLink}}, {{invoiceNumber}}, {{invoiceAmount}}, {{jobDate}}">
            <Textarea name="body" rows={4} defaultValue={automation?.actionConfig?.body ?? ''} />
          </Field>
        </div>
      ) : null}

      {action === 'CREATE_NOTIFICATION' || action === 'CREATE_FOLLOW_UP_TASK' ? (
        <div className="space-y-3 rounded-lg border border-ink-200 p-3">
          <p className="stat-label">Treść powiadomienia / zadania</p>
          <Field label="Wiadomość">
            <Textarea name="message" rows={3} defaultValue={automation?.actionConfig?.message ?? ''} />
          </Field>
        </div>
      ) : null}

      {action === 'SEND_REVIEW_REQUEST' ? (
        <div className="space-y-3 rounded-lg border border-ink-200 p-3">
          <p className="stat-label">Prośba o opinię</p>
          <Field label="Kanał">
            <Select name="channel" defaultValue={automation?.actionConfig?.channel ?? 'EMAIL'}>
              <option value="EMAIL">E-mail</option>
              <option value="SMS">SMS</option>
            </Select>
          </Field>
          <Field label="Wiadomość">
            <Textarea name="message" rows={3} defaultValue={automation?.actionConfig?.message ?? ''} />
          </Field>
        </div>
      ) : null}

      {action === 'UPDATE_JOB_STATUS' ? (
        <Field label="Nowy status zlecenia">
          <Select name="status" defaultValue={automation?.actionConfig?.status ?? 'CANCELLED'}>
            <option value="CANCELLED">Anulowane</option>
            <option value="NO_SHOW">Nieobecność klienta</option>
          </Select>
        </Field>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-ink-800">
        <input type="checkbox" name="isActive" defaultChecked={automation?.isActive ?? true} className="h-4 w-4 rounded border-ink-300" />
        Automatyzacja aktywna
      </label>

      <SubmitButton>{automation ? 'Zapisz zmiany' : 'Utwórz automatyzację'}</SubmitButton>
    </form>
  );
}
