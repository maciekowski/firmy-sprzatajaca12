import Link from 'next/link';
import { requireOrgContext } from '@/lib/auth/guards';
import { listNotifications } from '@/lib/queries/notifications';
import { EmptyState, PageHeader, Card } from '@/components/ui';
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/app/(app)/actions';
import { formatDateTime } from '@/lib/constants';

export const metadata = { title: 'Powiadomienia' };

export default async function NotificationsPage() {
  const context = await requireOrgContext();
  const items = await listNotifications(context.organization.id, context.user.id);

  return (
    <>
      <PageHeader
        title="Powiadomienia"
        description="Zdarzenia z automatyzacji i systemu."
        actions={
          items.some((item) => !item.readAt) ? (
            <form action={markAllNotificationsReadAction}>
              <button type="submit" className="btn-secondary btn-sm">
                Oznacz wszystkie jako przeczytane
              </button>
            </form>
          ) : null
        }
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState title="Brak powiadomień" description="Pojawią się tutaj m.in. informacje o nowych zapytaniach i automatyzacjach." />
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Card key={item.id} className={item.readAt ? 'opacity-70' : undefined}>
              <div className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{item.title}</p>
                  {item.body ? <p className="mt-1 text-sm text-ink-600">{item.body}</p> : null}
                  <p className="mt-2 text-xs text-ink-400">{formatDateTime(item.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.link ? (
                    <Link href={item.link} className="btn-secondary btn-sm">
                      Otwórz
                    </Link>
                  ) : null}
                  {!item.readAt ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className="btn-ghost btn-sm">
                        Oznacz
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
