import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { getLeadSummary, listLeads } from '@/lib/services/leads';
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { formatDate, LEAD_STATUSES, LEAD_STATUS_TONES } from '@/lib/constants';

export const metadata = { title: 'Leady' };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const context = await requirePermission('lead:read');
  const { status, q } = await searchParams;

  const [leads, summary] = await Promise.all([
    listLeads(context.organization.id, { status, search: q }),
    getLeadSummary(context.organization.id),
  ]);

  const currency = context.organization.currency;
  const openLeads = summary.filter((row) => !['WON', 'LOST'].includes(row.status));
  const won = summary.find((row) => row.status === 'WON');
  const lost = summary.find((row) => row.status === 'LOST');
  const pipelineValue = openLeads.reduce((sum, row) => sum + row.valueCents, 0);
  const total = (won?.count ?? 0) + (lost?.count ?? 0);

  return (
    <>
      <PageHeader
        title="Leady"
        description="Od pierwszego kontaktu do wygranej — każdy krok zapisuje się w historii."
        actions={
          context.can('lead:write') ? (
            <ButtonLink href="/leady/nowy" variant="primary">
              <Plus className="h-4 w-4" /> Nowy lead
            </ButtonLink>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Otwarte leady" value={String(openLeads.reduce((sum, row) => sum + row.count, 0))} />
        <Stat label="Wartość lejka" value={formatMoney(pipelineValue, currency)} />
        <Stat label="Wygrane" value={String(won?.count ?? 0)} tone="success" />
        <Stat
          label="Skuteczność"
          value={total > 0 ? `${Math.round(((won?.count ?? 0) / total) * 100)}%` : '—'}
          hint={total > 0 ? `z ${total} zamkniętych leadów` : 'brak zamkniętych leadów'}
        />
      </div>

      <Card className="mt-6">
        <form action="/leady" method="get" className="flex flex-wrap items-end gap-3 border-b border-ink-100 px-5 py-4">
          <div className="w-56">
            <label className="label" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={status ?? 'ALL'} className="input">
              <option value="ALL">Wszystkie</option>
              {LEAD_STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-64">
            <label className="label" htmlFor="q">
              Szukaj
            </label>
            <input id="q" name="q" defaultValue={q ?? ''} className="input" placeholder="Nazwa, e-mail, telefon" />
          </div>
          <button type="submit" className="btn-primary">
            Filtruj
          </button>
        </form>

        {leads.length === 0 ? (
          <EmptyState
            title="Brak leadów"
            description="Dodaj pierwszego leada — potem przekonwertujesz go do klienta jednym kliknięciem."
            action={
              context.can('lead:write') ? (
                <ButtonLink href="/leady/nowy" variant="primary" size="sm">
                  Nowy lead
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Kontakt</th>
                  <th>Źródło</th>
                  <th>Wartość</th>
                  <th>Status</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(({ lead, assignedName }) => (
                  <tr key={lead.id}>
                    <td>
                      <Link href={`/leady/${lead.id}`} className="font-medium text-ink-900 hover:underline">
                        {lead.title}
                      </Link>
                      {assignedName ? <p className="text-xs text-ink-500">Opiekun: {assignedName}</p> : null}
                      {lead.followUpAt ? (
                        <p className="text-xs text-amber-700">Follow-up: {formatDate(lead.followUpAt)}</p>
                      ) : null}
                    </td>
                    <td>
                      <p className="text-ink-800">{lead.contactName ?? '—'}</p>
                      <p className="text-xs text-ink-500">{[lead.contactPhone, lead.contactEmail].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="text-ink-600">{lead.source}</td>
                    <td className="tabular">{lead.estimatedValueCents !== null ? formatMoney(lead.estimatedValueCents, currency) : '—'}</td>
                    <td>
                      <Badge tone={LEAD_STATUS_TONES[lead.status] ?? 'neutral'}>
                        {LEAD_STATUSES.find((item) => item.value === lead.status)?.label ?? lead.status}
                      </Badge>
                    </td>
                    <td className="tabular">{formatDate(lead.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
