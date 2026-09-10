import Link from 'next/link';
import { LogIn } from 'lucide-react';

/**
 * Strona 401 — wymagane zalogowanie.
 * Wyświetlana, gdy żądanie dotyczy chronionego zasobu, a sesja jest
 * nieobecna lub nieważna.
 */
export const metadata = { title: 'Wymagane logowanie', robots: { index: false, follow: false } };

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-5">
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-sm">
        <LogIn className="mx-auto h-10 w-10 text-brand-600" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink-900">Sesja wygasła</h1>
        <p className="mt-2 text-sm text-ink-600">Zaloguj się ponownie, aby kontynuować pracę w ServiceFlow.</p>
        <div className="mt-6 flex justify-center">
          <Link href="/logowanie" className="btn-primary">
            Przejdź do logowania
          </Link>
        </div>
      </div>
    </div>
  );
}
