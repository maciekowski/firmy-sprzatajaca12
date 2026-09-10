import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/guards';
import { getLead, listLeadActivities } from '@/lib/services/leads';
import { Badge, Card, CardBody, CardHeader, PageHeader, Stat } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { changeLeadStatusAction, convertLeadAction, deleteLeadAction } from '@/app/(app)/leady/actions';
import { LeadForm } from '@/components/leads/lead-form';
import { listServicesWithTiers } from '@/lib/data/services';
import { listMembers } from '@/lib/data/jobs';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime, LEAD_STATUSES, LEAD_STATUS_TONES } from '@/lib/constants';

export const metadata = { title: 'Lead' };

const NEXT_STATUSES: Record<string, string[]> = {
  NEW: ['CONTACTED', 'QUALIFIED', 'LOST'],
  CONTACTED: ['QUALIFIED', 'ESTIMATE', 'LOST'],
  QUALIFIED: ['ESTIMATE', 'QUOTE_SENT', 'LOST'],
  ESTIMATE: ['QUOTE_SENT', 'FOLLOW_UP', 'LOST'],
  QUOTE_SENT: ['FOLLOW_UP', 'WON', 'LOST'],
  FOLLOW_UP: ['WON', 'LOST', 'QUOTE_SENT'],
  WON: [],
  LOST: [],
};

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ blad?: string }> }) {
  const context = await requirePermission('lead:read');
  const { id } = await params;
  const { blad } = await searchParams;

  const lead = await getLead(context.organization.id, id);
  if (!lead) notFound();

  const [activities, services, members] = await Promise.all([
    listLeadActivities(id),
    listServicesWithTiers(context.organization.id, true),
    listMembers(context.organization.id),
  ]);

  const currency = context.organization.currency;

  return (
    <>
      <PageHeader
        title={lead.title}
        description={`${lead.contactName ?? 'brak osoby kontaktowej'} · utworzono ${formatDate(lead.createdAt)}`}
        breadcrumbs={
          <Link href="/leady" className="hover:underline">
            Leady
          </Link>
        }
        actions={
          context.can('lead:write') && !lead.convertedCustomerId ? (
            <form action={convertLeadAction}>
              <input type="hidden" name="leadId" value={lead.id} />
              <SubmitButton confirm="Przekonwertować leada do klienta?">Konwertuj do klienta</SubmitButton>
            </form>
          ) : null
        }
      />

      {blad ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Status"
          value={LEAD_STATUSES.find((item) => item.value === lead.status)?.label ?? lead.status}
          hint={lead.followUpAt ? `Follow-up: ${formatDate(lead.followUpAt)}` : undefined}
        />
        <Stat label="Szacowana wartość" value={lead.estimatedValueCents !== null ? formatMoney(lead.estimatedValueCents, currency) : '—'} />
        <Stat label="Źródło" value={lead.source} />
        <Stat
          label="Konwersja"
          value={lead.convertedCustomerId ? 'Przekonwertowany' : 'Nie'}
          hint={lead.convertedAt ? formatDateTime(lead.convertedAt) : undefined}
          tone={lead.convertedCustomerId ? 'success' : 'neutral'}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Dane leada" />
            <CardBody>
              {context.can('lead:write') ? (
                <LeadForm
                  lead={{
                    id: lead.id,
                    title: lead.title,
                    description: lead.description,
                    source: lead.source,
                    contactName: lead.contactName,
                    contactPhone: lead.contactPhone,
                    contactEmail: lead.contactEmail,
                    street: lead.street,
                    city: lead.city,
                    postalCode: lead.postalCode,
                    serviceId: lead.serviceId,
                    assignedToId: lead.assignedToId,
                    estimatedValueCents: lead.estimatedValueCents,
                    followUpAt: lead.followUpAt,
                  }}
                  services={services.map((service) => ({ id: service.id, name: service.name }))}
                  members={members.map((member) => ({ userId: member.userId, name: member.name }))}
                />
              ) : (
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="stat-label">Kontakt</dt>
                    <dd>{[lead.contactPhone, lead.contactEmail].filter(Boolean).join(' · ') || '—'}</dd>
                  </div>
                  <div>
                    <dt className="stat-label">Adres</dt>
                    <dd>{[lead.street, lead.postalCode, lead.city].filter(Boolean).join(', ') || '—'}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="stat-label">Opis</dt>
                    <dd className="whitespace-pre-wrap">{lead.description ?? '—'}</dd>
                  </div>
                </dl>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Historia działań" />
            <CardBody>
              {activities.length === 0 ? (
                <p className="text-sm text-ink-500">Brak zapisanych działań.</p>
              ) : (
                <ol className="space-y-3">
                  {[...activities].reverse().map((activity) => (
                    <li key={activity.id} className="border-b border-ink-100 pb-2 last:border-0">
                      <p className="text-sm text-ink-900">{activity.message}</p>
                      <p className="text-xs text-ink-500">
                        {formatDateTime(activity.createdAt)} · {activity.userName ?? 'system'}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Zmiana statusu" />
            <CardBody className="space-y-2">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-ink-500">Aktualny</span>
                <Badge tone={LEAD_STATUS_TONES[lead.status] ?? 'neutral'}>
                  {LEAD_STATUSES.find((item) => item.value === lead.status)?.label ?? lead.status}
                </Badge>
              </div>
              {context.can('lead:write')
                ? (NEXT_STATUSES[lead.status] ?? []).map((status) => (
                    <form key={status} action={changeLeadStatusAction}>
                      <input type="hidden" name="leadId" value={lead.id} />
                      <input type="hidden" name="status" value={status} />
                      <SubmitButton variant="secondary" size="sm" className="w-full">
                        {LEAD_STATUSES.find((item) => item.value === status)?.label ?? status}
                      </SubmitButton>
                    </form>
                  ))
                : null}
              {lead.lostReason ? <p className="text-xs text-ink-600">Powód przegranej: {lead.lostReason}</p> : null}
            </CardBody>
          </Card>

          {context.can('lead:write') ? (
            <Card>
              <CardBody>
                <form action={deleteLeadAction}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <SubmitButton variant="danger" className="w-full" confirm="Usunąć leada?">
                    Usuń leada
                  </SubmitButton>
                </form>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
