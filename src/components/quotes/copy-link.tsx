'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // schowek może być zablokowany przez przeglądarkę — pokazujemy link obok
          window.prompt('Skopiuj link do oferty:', url);
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Skopiowano' : 'Kopiuj link'}
    </button>
  );
}
