'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { acceptInvitationAction, type AcceptState } from './actions';

const initialState: AcceptState = { ok: false };

function Button() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Dołączam…' : 'Dołącz do zespołu'}
    </button>
  );
}

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(acceptInvitationAction, initialState);

  return (
    <form action={formAction} className="mt-5 space-y-2">
      <input type="hidden" name="token" value={token} />
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      <Button />
    </form>
  );
}
