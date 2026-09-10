'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { verifyTotpAction, type TotpState } from '@/app/(auth)/actions';

const initialState: TotpState = { ok: false };

function Button() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full py-3" disabled={pending}>
      {pending ? 'Sprawdzam…' : 'Zatwierdź'}
    </button>
  );
}

export function TotpForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(verifyTotpAction, initialState);

  return (
    <form action={formAction} className="mt-5 space-y-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <input
        name="code"
        inputMode="numeric"
        pattern="[0-9A-Fa-f]*"
        autoComplete="one-time-code"
        maxLength={32}
        placeholder="123456"
        className="input w-full py-3 text-center text-lg tracking-widest"
        required
      />
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <Button />
    </form>
  );
}
