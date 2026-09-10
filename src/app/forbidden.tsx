import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

/**
 * Strona 403 — brak uprawnień.
 * Uprawnienia sprawdza SERWER (patrz src/lib/auth/guards.ts); ta strona
 * tylko informuje użytkownika, że nie ma dostępu do danego modułu.
 */
export const metadata = { title: 'Brak uprawnień', robots: { index: false, follow: false } };

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-5">
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-10 w-10 text-amber-600" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">Brak uprawnień</h1>
        <p className="mt-2 text-sm text-ink-600">
          Twoja rola w tej firmie nie pozwala na otwarcie tej strony. Poproś właściciela lub administratora o zmianę
          uprawnień.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/dashboard" className="btn-primary">
            Wróć do pulpitu
          </Link>
          <Link href="/ustawienia/konto" className="btn-secondary">
            Moje konto
          </Link>
        </div>
      </div>
    </div>
  );
}
