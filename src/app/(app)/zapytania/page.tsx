import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { countRequests, listRequests } from '@/lib/services/requests';
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/constants';
import { Pagination } from '@/components/ui/pagination';
import { parsePage, totalPages } from '@/lib/pagination';

export const metadata = { title: 'Zapytania' };

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Nowe',
  IN_REVIEW: 'W trakcie',
  QUOTED: 'Wycenione',
  CONVERTED: 'Przekonwertowane',
  REJECTED: 'Odrzucone',
  SPAM: 'Spam',
};

const STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple'> = {
  NEW: 'info',
  IN_REVIEW: 'warning',
  QUOTED: 'purple',
  CONVERTED: 'success',
  REJECTED: 'neutral',
  SPAM: 'danger',
};

const CHANNEL_LABELS: Record<string, string> = {
  WEB_FORM: 'Formularz',
  EMAIL: 'E-mail',
  PHONE: 'Telefon',
  API: 'API',
  MESSENGER: 'Komunikator',
  MANUAL: 'Ręcznie',
  OTHER: 'Inne',
};

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; strona?: string }> }) {
  const context = await requirePermission('request:read');
  const { status, q, strona } = await searchParams;
  const page = parsePage(strona);
  const [requests, total] = await Promise.all([
    listRequests(context.organization.id, { status, search: q, limit: page.limit, offset: page.offset }),
    countRequests(context.organization.id, { status, search: q }),
  ]);

  return (
    <>
      <PageHeader
        title="Zapytania"
        description="Zgłoszenia od klientów. Opcjonalna analiza AI pomaga rozbić opis na usługi i zakres."
        actions={
          context.can('request:write') ? (
            <ButtonLink href="/zapytania/nowy" variant="primary">
              <Plus className="h-4 w-4" /> Nowe zapytanie
            </ButtonLink>
          ) : null
        }
      />

      <Card>
        <form action="/zapytania" method="get" className="flex flex-wrap items-end gap-3 border-b border-ink-100 px-5 py-4">
          <div className="w-56">
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
          <div className="w-64">
            <label className="label" htmlFor="q">
              Szukaj
            </label>
            <input id="q" name="q" defaultValue={q ?? ''} className="input" placeholder="Treść, kontakt" />
          </div>
          <button type="submit" className="btn-primary">
            Filtruj
          </button>
        </form>

        {requests.length === 0 ? (
          <EmptyState title="Brak zapytań" description="Dodaj zapytanie ręcznie albo podłącz formularz na stronie." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Zapytanie</th>
                  <th>Kontakt</th>
                  <th>Kanał</th>
                  <th>Termin</th>
                  <th>Analiza</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <Link href={`/zapytania/${request.id}`} className="font-medium text-ink-900 hover:underline">
                        {request.description.slice(0, 80)}
                        {request.description.length > 80 ? '…' : ''}
                      </Link>
                      <p className="text-xs text-ink-500">{formatDateTime(request.createdAt)}</p>
                    </td>
                    <td>
                      <p className="text-ink-800">{request.contactName ?? '—'}</p>
                      <p className="text-xs text-ink-500">{[request.contactPhone, request.contactEmail].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="text-ink-600">{CHANNEL_LABELS[request.channel] ?? request.channel}</td>
                    <td className="tabular">{request.preferredDate ? formatDate(request.preferredDate) : '—'}</td>
                    <td>
                      {request.aiStatus === 'NOT_RUN' ? (
                        <span className="text-xs text-ink-400">nie uruchomiono</span>
                      ) : (
                        <Badge tone={request.aiStatus === 'OK' ? 'success' : request.aiStatus === 'NEEDS_CONFIRMATION' ? 'warning' : 'neutral'}>
                          {request.aiStatus === 'OK' ? 'OK' : request.aiStatus === 'NEEDS_CONFIRMATION' ? 'Do potwierdzenia' : request.aiStatus}
                        </Badge>
                      )}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONES[request.status] ?? 'neutral'}>{STATUS_LABELS[request.status] ?? request.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page.page} pages={totalPages(total, page.limit)} basePath="/zapytania" query={{ status, q }} />
      </Card>
    </>
  );
}
