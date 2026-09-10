'use client';

import { useActionState } from 'react';
import { Alert, Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { changePasswordAction, updateProfileAction, type AccountState } from '@/app/(app)/ustawienia/konto/actions';

const initialState: AccountState = { ok: false };

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  const [state, formAction] = useActionState(updateProfileAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Imię i nazwisko" required>
          <Input name="name" required defaultValue={name} />
        </Field>
        <Field label="Telefon">
          <Input name="phone" defaultValue={phone ?? ''} />
        </Field>
      </div>
      <SubmitButton variant="secondary" size="sm">
        Zapisz dane
      </SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Aktualne hasło" required>
          <Input name="currentPassword" type="password" required autoComplete="current-password" />
        </Field>
        <Field label="Nowe hasło" required>
          <Input name="newPassword" type="password" required autoComplete="new-password" />
        </Field>
        <Field label="Powtórz nowe hasło" required>
          <Input name="repeatPassword" type="password" required autoComplete="new-password" />
        </Field>
      </div>
      <SubmitButton variant="secondary" size="sm">
        Zmień hasło
      </SubmitButton>
    </form>
  );
}
