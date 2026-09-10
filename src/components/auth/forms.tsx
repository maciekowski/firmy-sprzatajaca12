'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, Field, Input } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import {
  forgotPasswordAction,
  loginAction,
  registerAction,
  resetPasswordAction,
} from '@/app/(auth)/actions';
import type { FormState } from '@/lib/validation';

const initialState: FormState = { ok: false };

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Zaloguj się</h1>
      <p className="mt-1 text-sm text-ink-600">Wejdź do swojego ServiceFlow.</p>

      {state.error ? (
        <Alert tone="danger" className="mt-4">
          {state.error}
        </Alert>
      ) : null}

      <div className="mt-5">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Field label="E-mail" error={state.fieldErrors?.email} required>
          <Input type="email" name="email" autoComplete="email" required placeholder="jan@firma.pl" />
        </Field>
        <Field label="Hasło" error={state.fieldErrors?.password} required>
          <Input type="password" name="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Logowanie…">
          Zaloguj się
        </SubmitButton>
      </div>

      <div className="mt-5 flex items-center justify-between text-sm">
        <Link href="/rejestracja" className="text-brand-700 hover:underline">
          Załóż konto
        </Link>
        <Link href="/reset-hasla" className="text-ink-600 hover:underline">
          Nie pamiętam hasła
        </Link>
      </div>
    </form>
  );
}

export function RegisterForm() {
  const [state, formAction] = useActionState(registerAction, initialState);

  return (
    <form action={formAction} className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Zacznij za darmo</h1>
      <p className="mt-1 text-sm text-ink-600">Załóż konto i skonfiguruj swoją firmę w kilka minut.</p>

      {state.error ? (
        <Alert tone="danger" className="mt-4">
          {state.error}
        </Alert>
      ) : null}

      <div className="mt-5">
        <Field label="Twoje imię i nazwisko" error={state.fieldErrors?.name} required>
          <Input name="name" autoComplete="name" required placeholder="Jan Kowalski" />
        </Field>
        <Field label="Nazwa firmy" error={state.fieldErrors?.companyName} required>
          <Input name="companyName" required placeholder="Kowalski Usługi" />
        </Field>
        <Field label="E-mail" error={state.fieldErrors?.email} required>
          <Input type="email" name="email" autoComplete="email" required placeholder="jan@firma.pl" />
        </Field>
        <Field
          label="Hasło"
          error={state.fieldErrors?.password}
          hint="Minimum 10 znaków, litery i cyfry."
          required
        >
          <Input type="password" name="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Field label="Powtórz hasło" error={state.fieldErrors?.confirmPassword} required>
          <Input type="password" name="confirmPassword" autoComplete="new-password" required minLength={10} />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Tworzenie konta…">
          Utwórz konto
        </SubmitButton>
      </div>

      <p className="mt-5 text-center text-sm text-ink-600">
        Masz już konto?{' '}
        <Link href="/logowanie" className="font-medium text-brand-700 hover:underline">
          Zaloguj się
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, initialState);

  return (
    <form action={formAction} className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Reset hasła</h1>
      <p className="mt-1 text-sm text-ink-600">Podaj e-mail, na który wyślemy link do zmiany hasła.</p>

      {state.error ? (
        <Alert tone="danger" className="mt-4">
          {state.error}
          {state.message ? <div className="mt-2 break-all text-xs">{state.message}</div> : null}
        </Alert>
      ) : null}
      {state.ok && state.message ? (
        <Alert tone="success" className="mt-4">
          {state.message}
        </Alert>
      ) : null}

      <div className="mt-5">
        <Field label="E-mail" error={state.fieldErrors?.email} required>
          <Input type="email" name="email" autoComplete="email" required />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Wysyłanie…">
          Wyślij link
        </SubmitButton>
      </div>

      <p className="mt-5 text-center text-sm text-ink-600">
        <Link href="/logowanie" className="font-medium text-brand-700 hover:underline">
          Wróć do logowania
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(resetPasswordAction, initialState);

  if (state.ok) {
    return (
      <div className="card p-6">
        <Alert tone="success">{state.message ?? 'Hasło zostało zmienione.'}</Alert>
        <Link
          href="/logowanie"
          className="btn-secondary mt-4 w-full"
        >
          Przejdź do logowania
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="card p-6">
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Nowe hasło</h1>
      <p className="mt-1 text-sm text-ink-600">Ustaw nowe hasło do swojego konta.</p>

      {state.error ? (
        <Alert tone="danger" className="mt-4">
          {state.error}
        </Alert>
      ) : null}

      <input type="hidden" name="token" value={token} />
      <div className="mt-5">
        <Field label="Nowe hasło" error={state.fieldErrors?.password} hint="Minimum 10 znaków, litery i cyfry." required>
          <Input type="password" name="password" autoComplete="new-password" required minLength={10} />
        </Field>
        <Field label="Powtórz hasło" error={state.fieldErrors?.confirmPassword} required>
          <Input type="password" name="confirmPassword" autoComplete="new-password" required minLength={10} />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Zapisywanie…">
          Zmień hasło
        </SubmitButton>
      </div>
    </form>
  );
}
