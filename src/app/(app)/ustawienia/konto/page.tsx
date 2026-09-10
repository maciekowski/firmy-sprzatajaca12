import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db/client';
import { memberships, organizations, sessions } from '@/lib/db/schema';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { revokeAllSessionsAction, revokeSessionAction } from '@/app/(app)/ustawienia/konto/actions';
import { ProfileForm, PasswordForm } from '@/components/settings/account-forms';
import { ROLE_LABELS } from '@/lib/authz/permissions';
import { formatDateTime } from '@/lib/constants';

export const metadata = { title: 'Moje konto' };

export default async function AccountPage() {
  const user = await requireUser('/ustawienia/konto');

  const [mySessions, myOrganizations] = await Promise.all([
    db.select().from(sessions).where(eq(sessions.userId, user.id)).orderBy(desc(sessions.lastUsedAt)),
    db
      .select({ name: organizations.name, role: memberships.role, organizationId: memberships.organizationId })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(eq(memberships.userId, user.id)),
  ]);

  return (
    <>
      <PageHeader
        title="Moje konto"
        description={user.email}
        breadcrumbs={
          <Link href="/ustawienia" className="hover:underline">
            Ustawienia
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Dane profilu" />
            <CardBody>
              <ProfileForm name={user.name} phone={user.phone} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Hasło" />
            <CardBody>
              <PasswordForm />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Firmy" description="Organizacje, do których masz dostęp." />
            <CardBody>
              <ul className="space-y-2">
                {myOrganizations.map((organization) => (
                  <li key={organization.organizationId} className="flex items-center justify-between text-sm">
                    <Link href="/ustawienia" className="text-ink-900 hover:underline">
                      {organization.name}
                    </Link>
                    <Badge tone="neutral">{ROLE_LABELS[organization.role]}</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Aktywne sesje" description={`Liczba sesji: ${mySessions.length}`} />
            <CardBody className="space-y-3">
              <ul className="space-y-2">
                {mySessions.slice(0, 10).map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-2 border-b border-ink-100 pb-2 text-sm last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-ink-800">{session.userAgent ?? 'nieznane urządzenie'}</p>
                      <p className="text-xs text-ink-500">
                        {formatDateTime(session.lastUsedAt)} · {session.ip ?? 'brak IP'}
                      </p>
                    </div>
                    <form action={revokeSessionAction}>
                      <input type="hidden" name="sessionId" value={session.id} />
                      <SubmitButton variant="ghost" size="sm">
                        Zakończ
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>

              {mySessions.length > 0 ? (
                <form action={revokeAllSessionsAction}>
                  <SubmitButton variant="danger" size="sm" confirm="Zakończyć wszystkie sesje? Zostaniesz wylogowany z tego urządzenia.">
                    Wyloguj ze wszystkich urządzeń
                  </SubmitButton>
                </form>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
