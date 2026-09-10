import Link from 'next/link';
import { desc, eq, and } from 'drizzle-orm';
import { requirePermission } from '@/lib/auth/guards';
import { db } from '@/lib/db/client';
import { communications, customers } from '@/lib/db/schema';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from '@/components/ui';
import { formatDateTime } from '@/lib/constants';

export const metadata = { title: 'Komunikacja' };

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Oczekuje',
  QUEUED: 'W kolejce',
  SENT: 'Wysłana (przyjęta przez providera)',
  DELIVERED: 'Dostarczona',
  FAILED: 'Błąd',
  BOUNCED: 'Odrzucona (bounce)',
  SUPPRESSED: 'Zablokowana adresowo',
  SKIPPED_NO_PROVIDER: 'Brak providera — NIE wysłano',
  SKIPPED_NO_CONSENT: 'Brak zgody klienta',
};

const STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'neutral',
  QUEUED: 'info',
  SENT: 'info',
  DELIVERED: 'success',
  FAILED: 'danger',
  BOUNCED: 'danger',
  SUPPRESSED: 'warning',
  SKIPPED_NO_PROVIDER: 'warning',
  SKIPPED_NO_CONSENT: 'neutral',
};

export default async function CommunicationPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await requirePermission('communication:send');
  const { status } = await searchParams;

  const filters = [eq(communications.organizationId, context.organization.id)];
  if (status && status !== 'ALL') filters.push(eq(communications.status, status as never));

  const [messages, counters] = await Promise.all([
    db
      .select({ message: communications, customerName: customers.displayName })
      .from(communications)
      .leftJoin(customers, eq(customers.id, communications.customerId))
      .where(and(...filters))
      .orderBy(desc(communications.createdAt))
      .limit(200),
    db
      .select({ status: communications.status, count: communications.id })
      .from(communications)
      .where(eq(communications.organizationId, context.organization.id)),
  ]);

  const counts = counters.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Komunikacja"
        description="Historia wiadomości z prawdziwymi statusami. „Wysłana” nie oznacza „dostarczona” — dostarczenie potwierdza webhook."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Wysłane" value={String((counts.SENT ?? 0) + (counts.DELIVERED ?? 0))} tone="info" />
        <Stat label="Dostarczone" value={String(counts.DELIVERED ?? 0)} tone="success" />
        <Stat label="Błędy / odrzucone" value={String((counts.FAILED ?? 0) + (counts.BOUNCED ?? 0) + (counts.SUPPRESSED ?? 0))} tone={(counts.FAILED ?? 0) > 0 ? 'danger' : 'neutral'} />
        <Stat label="Brak providera" value={String(counts.SKIPPED_NO_PROVIDER ?? 0)} tone={(counts.SKIPPED_NO_PROVIDER ?? 0) > 0 ? 'warning' : 'neutral'} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Wiadomości" />
        <form action="/komunikacja" method="get" className="flex flex-wrap items-end gap-3 border-b border-ink-100 px-5 py-4">
          <div className="w-64">
            <label className="label" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status ?? 'ALL'} className="input">
              <option value="ALL">Wszystkie</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary">
            Filtruj
          </button>
        </form>

        {messages.length === 0 ? (
          <EmptyState title="Brak wiadomości" description="Wiadomości pojawią się po wysłaniu oferty, faktury lub automatyzacji." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Odbiorca</th>
                  <th>Temat</th>
                  <th>Kanał</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {messages.map(({ message, customerName }) => (
                  <tr key={message.id}>
                    <td className="tabular">{formatDateTime(message.sentAt ?? message.createdAt)}</td>
                    <td>
                      <p className="text-ink-900">{message.toAddress ?? '—'}</p>
                      {customerName ? <p className="text-xs text-ink-500">{customerName}</p> : null}
                    </td>
                    <td className="max-w-xs">
                      <p className="truncate text-ink-800">{message.subject ?? message.body.slice(0, 60)}</p>
                      {message.error ? <p className="truncate text-xs text-red-700">{message.error}</p> : null}
                    </td>
                    <td className="text-ink-600">{message.channel}</td>
                    <td>
                      <Badge tone={STATUS_TONES[message.status] ?? 'neutral'}>{STATUS_LABELS[message.status] ?? message.status}</Badge>
                      {message.provider ? <p className="text-xs text-ink-500">{message.provider}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-6">
        <CardBody className="text-sm text-ink-600">
          Statusy aktualizują się na podstawie zdarzeń z providera (webhook Resend). Brak skonfigurowanego webhooka
          oznacza, że aplikacja zna tylko status „wysłana”, a nie „dostarczona” — celowo tego nie ukrywamy.
          {' '}
          <Link href="/ustawienia/integracje" className="text-brand-700 hover:underline">
            Sprawdź konfigurację integracji
          </Link>
          .
        </CardBody>
      </Card>
    </>
  );
}
