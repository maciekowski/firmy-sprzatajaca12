import Link from 'next/link';
import { getSessionUser } from '@/lib/auth/session';
import { ButtonLink } from '@/components/ui';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">SF</span>
            <span className="text-lg font-semibold tracking-tight text-ink-900">ServiceFlow</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-ink-600 md:flex">
            <Link href="/#jak-to-dziala" className="hover:text-ink-900">
              Jak to działa
            </Link>
            <Link href="/#funkcje" className="hover:text-ink-900">
              Funkcje
            </Link>
            <Link href="/cennik" className="hover:text-ink-900">
              Cennik
            </Link>
            <Link href="/faq" className="hover:text-ink-900">
              FAQ
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            {user ? (
              <ButtonLink href="/dashboard" variant="primary" size="sm">
                Przejdź do aplikacji
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/logowanie" variant="ghost" size="sm">
                  Zaloguj się
                </ButtonLink>
                <ButtonLink href="/rejestracja" variant="primary" size="sm">
                  Zacznij za darmo
                </ButtonLink>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-ink-100 bg-ink-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">SF</span>
              <span className="font-semibold text-ink-900">ServiceFlow</span>
            </div>
            <p className="mt-3 text-sm text-ink-600">
              System operacyjny dla ekip i firm usługowych. Od zapytania klienta do opłaconego zlecenia.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Produkt</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-600">
              <li>
                <Link href="/#funkcje" className="hover:text-ink-900">
                  Funkcje
                </Link>
              </li>
              <li>
                <Link href="/cennik" className="hover:text-ink-900">
                  Cennik
                </Link>
              </li>
              <li>
                <Link href="/faq" className="hover:text-ink-900">
                  FAQ
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Konto</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-600">
              <li>
                <Link href="/rejestracja" className="hover:text-ink-900">
                  Załóż konto
                </Link>
              </li>
              <li>
                <Link href="/logowanie" className="hover:text-ink-900">
                  Zaloguj się
                </Link>
              </li>
              <li>
                <Link href="/reset-hasla" className="hover:text-ink-900">
                  Reset hasła
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Kontakt</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-600">
              <li>kontakt@serviceflow.example</li>
              <li className="text-ink-400">Dane kontaktowe konfigurowane przez właściciela wdrożenia.</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-ink-100 px-5 py-6 text-center text-xs text-ink-500">
          © {new Date().getFullYear()} ServiceFlow. Wszystkie prawa zastrzeżone.
        </div>
      </footer>
    </div>
  );
}
