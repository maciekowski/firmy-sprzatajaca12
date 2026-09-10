'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import QRCode from 'qrcode';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import {
  confirmTotpSetupAction,
  disableTotpAction,
  regenerateRecoveryCodesAction,
  startTotpSetupAction,
  type TotpSetupState,
} from '@/app/(app)/ustawienia/konto/actions';

const initialState: TotpSetupState = { ok: false };

function Button({ children, variant = 'primary' }: { children: React.ReactNode; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={variant === 'primary' ? 'btn-primary' : 'btn-secondary'} disabled={pending}>
      {pending ? 'Pracuję…' : children}
    </button>
  );
}

/**
 * Dwuskładnikowe logowanie (TOTP).
 *
 * Kod QR jest generowany z URI `otpauth://` lokalnie w przeglądarce — sekret nie jest
 * nigdzie wysyłany. Kody zapasowe pokazujemy wyłącznie raz (w bazie są ich skróty).
 */
export function TwoFactorCard({ enabled, enabledAt }: { enabled: boolean; enabledAt: string | null }) {
  const [setup, setupAction] = useActionState(startTotpSetupAction, initialState);
  const [confirm, confirmAction] = useActionState(confirmTotpSetupAction, initialState);
  const [disableState, disableFormAction] = useActionState(disableTotpAction, { ok: false });
  const [regenState, regenFormAction] = useActionState(regenerateRecoveryCodesAction, { ok: false });
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string>('');

  useEffect(() => {
    if (!setup.otpauthUri) return;
    setSecret(setup.secret ?? '');
    QRCode.toDataURL(setup.otpauthUri, { width: 220, margin: 1 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [setup.otpauthUri]);

  const recoveryCodes = confirm.recoveryCodes;
  const error = setup.error ?? confirm.error ?? disableState.error ?? regenState.error;
  const message = confirm.message ?? disableState.message ?? regenState.message;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {enabled ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" /> Włączone
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-900">
            <ShieldOff className="h-3.5 w-3.5" /> Wyłączone
          </span>
        )}
        {enabledAt ? <span className="text-xs text-ink-500">od {enabledAt}</span> : null}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      {!enabled && !setup.otpauthUri ? (
        <form action={setupAction}>
          <Button variant="primary">
            <ShieldCheck className="mr-1 h-4 w-4" /> Włącz dwuskładnikowe logowanie
          </Button>
        </form>
      ) : null}

      {!enabled && setup.otpauthUri ? (
        <div className="space-y-3">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Kod QR aplikacji uwierzytelniającej" className="h-56 w-56 rounded-lg border border-ink-100" />
          ) : (
            <p className="text-sm text-ink-500">Nie udało się wygenerować kodu QR — wpisz sekret ręcznie.</p>
          )}

          <div className="rounded-lg border border-ink-100 bg-ink-50 p-3">
            <p className="mb-1 text-xs text-ink-500">Sekret (jeśli nie możesz zeskanować kodu)</p>
            <code className="break-all text-xs text-ink-800">{secret}</code>
          </div>

          <form action={confirmAction} className="space-y-2">
            <input type="hidden" name="secret" value={secret} />
            <input
              name="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="Kod z aplikacji (6 cyfr)"
              className="input w-full text-center tracking-widest"
              required
            />
            <Button variant="primary">Potwierdź i włącz</Button>
          </form>
        </div>
      ) : null}

      {recoveryCodes ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-medium text-amber-900">
            Kody zapasowe — zapisz je teraz, pokazujemy je tylko raz:
          </p>
          <ul className="grid grid-cols-2 gap-1 text-xs text-amber-900">
            {recoveryCodes.map((code) => (
              <li key={code} className="font-mono">
                {code}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {enabled ? (
        <div className="space-y-4 border-t border-ink-100 pt-4">
          <form action={regenFormAction} className="space-y-2">
            <label className="block text-xs text-ink-600" htmlFor="regen-code">
              Nowe kody zapasowe (wymaga aktualnego kodu)
            </label>
            <input id="regen-code" name="code" inputMode="numeric" maxLength={6} placeholder="123456" className="input w-40 text-center tracking-widest" required />
            <Button variant="secondary">Wygeneruj nowe kody zapasowe</Button>
          </form>

          <form action={disableFormAction} className="space-y-2">
            <label className="block text-xs text-ink-600" htmlFor="disable-password">
              Wyłączenie 2FA (wymaga hasła i kodu)
            </label>
            <input id="disable-password" name="password" type="password" placeholder="Hasło" className="input w-full" required />
            <input name="code" inputMode="numeric" maxLength={32} placeholder="Kod 2FA lub zapasowy" className="input w-full" required />
            <Button variant="secondary">Wyłącz 2FA</Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
