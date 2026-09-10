'use client';

import { useActionState } from 'react';
import { Alert, Field, Textarea } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { askAssistantAction, type AssistantState } from '@/app/(app)/asystent/actions';

const initialState: AssistantState = { ok: false };

export function AssistantForm() {
  const [state, formAction] = useActionState(askAssistantAction, initialState);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        <Field label="Pytanie o firmę">
          <Textarea name="question" rows={3} required placeholder="Co powinienem poprawić w tym miesiącu?" />
        </Field>
        <SubmitButton pendingLabel="Analizuję…">Zapytaj</SubmitButton>
      </form>

      {state.error ? <Alert tone="warning">{state.error}</Alert> : null}

      {state.answer ? (
        <div className="rounded-lg border border-ink-200 bg-white p-4">
          <p className="whitespace-pre-wrap text-sm text-ink-800">{state.answer}</p>
          <p className="mt-2 text-xs text-ink-500">Źródło: {state.source}</p>
        </div>
      ) : null}

      {state.facts && state.facts.length > 0 ? (
        <div className="rounded-lg border border-ink-200 bg-ink-50 p-4">
          <p className="stat-label">Dane, na których oparto odpowiedź</p>
          <ul className="mt-2 space-y-1 text-sm text-ink-700">
            {state.facts.map((fact) => (
              <li key={fact}>· {fact}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
