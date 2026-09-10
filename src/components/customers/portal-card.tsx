'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Copy, Link2, ShieldOff } from 'lucide-react';
import { createPortalLinkAction, revokePortalLinkAction, type PortalLinkState } from '@/app/(app)/klienci/actions';

const initialState: PortalLinkState = { ok: false };

function ActionButton({ variant = 'primary', children }: { variant?: 'primary' | 'secondary'; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={variant === 'primary' ? 'btn-primary' : 'btn-secondary'} disabled={pending}>
      {pending ? 'Pracuję…' : children}
    </button>
  );
}

/**
 * Konto klienta — prywatny link, pod którym klient widzi swoje oferty,
 * zlecenia i faktury (bez logowania). Link można w każdej chwili odwołać.
 */
export function CustomerPortalCard({
  customerId,
  portalToken,
  appUrl,
}: {
  customerId: string;
  portalToken: string | null;
  appUrl: string;
}) {
  const [createState, createAction] = useActionState(createPortalLinkAction, initialState);
  const [revokeState, revokeAction] = useActionState(revokePortalLinkAction, initialState);
  const [copied, setCopied] = useState(false);

  const token = createState.token ?? portalToken;
  const link = token ? `${appUrl.replace(/\/$/, '')}/moje/${token}` : null;
  const message = createState.message ?? revokeState.message;
  const error = createState.error ?? revokeState.error;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3">
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {link ? (
        <div className="rounded-lg border border-ink-100 bg-ink-50 p-3">
          <p className="mb-1 text-xs text-ink-500">Prywatny link klienta</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate text-xs text-ink-800">{link}</code>
            <button type="button" onClick={copy} className="btn-secondary px-2 py-1 text-xs">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} Kopiuj
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-600">
          Klient nie ma jeszcze linku. Po jego wygenerowaniu zobaczy swoje oferty, zlecenia i faktury bez logowania.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <form action={createAction}>
          <input type="hidden" name="customerId" value={customerId} />
          <ActionButton variant="primary">
            <Link2 className="mr-1 h-4 w-4" />
            {portalToken ? 'Pokaż aktualny link' : 'Wygeneruj link'}
          </ActionButton>
        </form>

        {portalToken ? (
          <form action={revokeAction}>
            <input type="hidden" name="customerId" value={customerId} />
            <ActionButton variant="secondary">
              <ShieldOff className="mr-1 h-4 w-4" /> Odwołaj dostęp
            </ActionButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}
