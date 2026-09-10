import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { getPending2faUser } from '@/lib/auth/session';
import { TotpForm } from './totp-form';

export const metadata = { title: 'Weryfikacja dwuskładnikowa' };

/**
 * Drugi krok logowania (TOTP). Strona jest dostępna tylko dla sesji,
 * która przeszła hasło, ale nie została jeszcze potwierdzona kodem.
 */
export default async function TotpChallengePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await getPending2faUser();
  if (!user) redirect('/logowanie');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-xl border border-ink-100 bg-white p-6 shadow-sm">
        <ShieldCheck className="h-8 w-8 text-brand-600" />
        <h1 className="mt-2 text-xl font-semibold text-ink-900">Weryfikacja dwuskładnikowa</h1>
        <p className="mt-1 text-sm text-ink-600">
          Podaj 6-cyfrowy kod z aplikacji uwierzytelniającej dla konta <strong>{user.email}</strong>.
          Możesz też użyć jednorazowego kodu zapasowego.
        </p>

        <TotpForm next={next} />

        <p className="mt-4 text-xs text-ink-500">
          Brak dostępu do aplikacji?{' '}
          <Link href="/reset-hasla" className="text-brand-700 hover:underline">
            Zresetuj hasło
          </Link>{' '}
          (2FA pozostanie aktywne — to dodatkowa ochrona).
        </p>
      </div>
    </main>
  );
}
