import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getInvitationByToken } from '@/lib/services/invitations';
import { ROLE_LABELS } from '@/lib/authz/permissions';
import { AcceptInvitationForm } from './accept-form';

export const metadata = { title: 'Zaproszenie do zespołu', robots: { index: false, follow: false } };

/**
 * Strona przyjęcia zaproszenia.
 * Token jest jednorazowy, wygasa po 14 dniach i może zostać odwołany.
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getInvitationByToken(token);
  if (!found) notFound();

  const user = await getSessionUser();
  const invitation = found.invitation;
  const now = Date.now();

  const state = invitation.revokedAt
    ? { tone: 'border-red-200 bg-red-50 text-red-900', text: 'To zaproszenie zostało odwołane.' }
    : invitation.acceptedAt
      ? { tone: 'border-ink-200 bg-ink-50 text-ink-800', text: 'To zaproszenie zostało już wykorzystane.' }
      : invitation.expiresAt.getTime() < now
        ? { tone: 'border-red-200 bg-red-50 text-red-900', text: 'To zaproszenie wygasło. Poproś administratora o nowe.' }
        : null;

  const emailMatches = user ? user.email.toLowerCase() === invitation.email.toLowerCase() : false;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-12">
      <div className="rounded-xl border border-ink-100 bg-white p-6 shadow-sm">
        <p className="text-sm text-ink-500">Zaproszenie do zespołu</p>
        <h1 className="mt-1 text-xl font-semibold text-ink-900">{found.organizationName}</h1>
        <p className="mt-2 text-sm text-ink-600">
          Rola: <strong>{ROLE_LABELS[invitation.role] ?? invitation.role}</strong>
          <br />
          Adres zaproszenia: <strong>{invitation.email}</strong>
        </p>

        {state ? <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${state.tone}`}>{state.text}</div> : null}

        {!state ? (
          !user ? (
            <div className="mt-5 space-y-2">
              <p className="text-sm text-ink-600">Aby dołączyć, zaloguj się kontem o adresie {invitation.email}.</p>
              <Link href={`/logowanie?next=${encodeURIComponent(`/zaproszenie/${token}`)}`} className="btn-primary w-full">
                Zaloguj się
              </Link>
              <Link href="/rejestracja" className="btn-secondary w-full">
                Załóż konto
              </Link>
            </div>
          ) : !emailMatches ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Jesteś zalogowany jako <strong>{user.email}</strong>. To zaproszenie jest przypisane do innego adresu — zaloguj się
              na właściwe konto.
            </div>
          ) : (
            <AcceptInvitationForm token={token} />
          )
        ) : null}

        <p className="mt-6 text-xs text-ink-400">
          Link działa jednorazowo i wygasa {invitation.expiresAt.toLocaleDateString('pl-PL')}.
        </p>
      </div>
    </main>
  );
}
