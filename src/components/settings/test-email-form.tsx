'use client';

import { useActionState } from 'react';
import { Alert, Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { sendTestEmailAction, type TestEmailState } from '@/app/(app)/ustawienia/integracje/actions';

const initialState: TestEmailState = { ok: false };

export function TestEmailForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, formAction] = useActionState(sendTestEmailAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Adres odbiorcy">
          <Input name="to" type="email" required defaultValue={defaultEmail} />
        </Field>
        <SubmitButton variant="secondary" pendingLabel="Wysyłanie…">
          Wyślij testową wiadomość
        </SubmitButton>
      </div>
    </form>
  );
}
