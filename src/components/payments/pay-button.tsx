'use client';

import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';

/**
 * Przycisk płatności online na publicznej stronie faktury.
 *
 * Tworzy PRAWDZIWĄ sesję w Stripe przez /api/platnosc/[token] i przekierowuje
 * na stronę płatności. Jeżeli bramka nie jest skonfigurowana, pokazuje jawną
 * informację (endpoint zwraca wtedy 503) — płatność nie jest symulowana.
 */
export function PayButton({ token, amountLabel }: { token: string; amountLabel: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startPayment() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/platnosc/${token}`, { method: 'POST' });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        setError(data.error ?? 'Nie udało się rozpocząć płatności.');
        setPending(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('Błąd połączenia z serwerem płatności.');
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={startPayment} disabled={pending} className="btn-primary inline-flex items-center gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        {pending ? 'Trwa otwieranie płatności…' : `Zapłać ${amountLabel} kartą`}
      </button>
      {error ? (
        <p className="text-sm text-amber-800" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
