import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { getRequest, parsedFromRequest } from '@/lib/services/requests';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { analyzeRequestAction, changeRequestStatusAction, convertRequestToLeadAction } from '@/app/(app)/zapytania/actions';
import { aiProviderStatus } from '@/lib/ai';
import { formatDate, formatDateTime } from '@/lib/constants';

export const metadata = { title: 'Zapytanie' };

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Nowe',
  IN_REVIEW: 'W trakcie',
  QUOTED: 'Wycenione',
  CONVERTED: 'Przekonwertowane',
  REJECTED: 'Odrzucone',
  SPAM: 'Spam',
};

const URGENCY_LABELS: Record<string, string> = { LOW: 'Niska', NORMAL: 'Normalna', HIGH: 'Wysoka' };

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ blad?: string }> }) {
  const context = await requirePermission('request:read');
  const { id } = await params;
  const { blad } = await searchParams;

  const request = await getRequest(context.organization.id, id);
  if (!request) notFound();

  const parsed = parsedFromRequest(request);
  const ai = aiProviderStatus();

  return (
    <>
      <PageHeader
        title="Zapytanie"
        description={`Zgłoszenie z ${formatDateTime(request.createdAt)} · ${STATUS_LABELS[request.status] ?? request.status}`}
        breadcrumbs={
          <Link href="/zapytania" className="hover:underline">
            Zapytania
          </Link>
        }
        actions={
          context.can('request:write') ? (
            <>
              <form action={analyzeRequestAction}>
                <input type="hidden" name="requestId" value={request.id} />
                <SubmitButton variant="secondary">
                  <Sparkles className="h-4 w-4" /> {parsed ? 'Analizuj ponownie' : 'Analizuj AI'}
                </SubmitButton>
              </form>
              {!request.convertedLeadId ? (
                <form action={convertRequestToLeadAction}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <SubmitButton>Utwórz leada</SubmitButton>
                </form>
              ) : null}
            </>
          ) : null
        }
      />

      {blad ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Treść zapytania" />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm text-ink-800">{request.description}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Analiza AI"
              description={
                ai.configured
                  ? `Dostawca: ${ai.label}. AI nie liczy ceny — wskazuje zakres, cenę policzy silnik cenowy.`
                  : 'Brak skonfigurowanego dostawcy AI — analiza działa na silniku regułowym (wyraźnie oznaczonym).'
              }
            />
            <CardBody>
              {!parsed ? (
                <p className="text-sm text-ink-500">Analiza nie była uruchamiana. Wynik zostanie zapisany przy zapytaniu.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={parsed.status === 'OK' ? 'success' : parsed.status === 'NEEDS_CONFIRMATION' ? 'warning' : 'neutral'}>
                      {parsed.status === 'OK' ? 'Rozpoznano' : parsed.status === 'NEEDS_CONFIRMATION' ? 'Do potwierdzenia' : parsed.status}
                    </Badge>
                    <span className="text-xs text-ink-500">
                      {parsed.usedModel ? 'model AI' : 'silnik regułowy'} · {request.aiProvider ?? 'brak'}
                      {request.aiAnalyzedAt ? ` · ${formatDateTime(request.aiAnalyzedAt)}` : ''}
                    </span>
                  </div>

                  {parsed.items.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Zakres</th>
                            <th>Ilość</th>
                            <th>Jednostka</th>
                            <th>Pewność</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsed.items.map((item, index) => (
                            <tr key={index}>
                              <td className="font-medium text-ink-900">{item.label}</td>
                              <td className="tabular">
                                {item.quantityFound ? item.quantity : <span className="text-amber-700">Do potwierdzenia</span>}
                              </td>
                              <td className="text-ink-600">{item.unit ?? '—'}</td>
                              <td>
                                <Badge tone={item.confidence === 'HIGH' ? 'success' : item.confidence === 'MEDIUM' ? 'warning' : 'neutral'}>
                                  {item.confidence === 'HIGH' ? 'Wysoka' : item.confidence === 'MEDIUM' ? 'Średnia' : 'Niska'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-ink-500">Nie rozpoznano pozycji.</p>
                  )}

                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="stat-label">Preferowany termin</dt>
                      <dd>
                        {parsed.preferredDateLabel ?? '—'}
                        {parsed.preferredTime ? ` · ${parsed.preferredTime}` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt className="stat-label">Pilność</dt>
                      <dd>{parsed.urgency ? (URGENCY_LABELS[parsed.urgency] ?? parsed.urgency) : '—'}</dd>
                    </div>
                    <div>
                      <dt className="stat-label">Kontakt</dt>
                      <dd>{[parsed.contact?.name, parsed.contact?.phone, parsed.contact?.email].filter(Boolean).join(' · ') || '—'}</dd>
                    </div>
                    <div>
                      <dt className="stat-label">Adres</dt>
                      <dd>{parsed.address ?? '—'}</dd>
                    </div>
                  </dl>

                  {parsed.notes.length > 0 ? (
                    <div>
                      <p className="stat-label">Uwagi analizy</p>
                      <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
                        {parsed.notes.map((note, index) => (
                          <li key={index}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Dane kontaktowe" />
            <CardBody className="space-y-2 text-sm">
              <p className="text-ink-900">{request.contactName ?? 'Brak imienia'}</p>
              <p className="text-ink-600">{[request.contactPhone, request.contactEmail].filter(Boolean).join(' · ') || 'brak kontaktu'}</p>
              <p className="text-ink-600">{[request.street, request.postalCode, request.city].filter(Boolean).join(', ') || 'brak adresu'}</p>
              <p className="text-xs text-ink-500">Preferowany termin: {request.preferredDate ? formatDate(request.preferredDate) : 'nie podano'}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Status zapytania" />
            <CardBody className="space-y-2">
              {context.can('request:write')
                ? (['NEW', 'IN_REVIEW', 'QUOTED', 'CONVERTED', 'REJECTED', 'SPAM'] as const).map((status) => (
                    <form key={status} action={changeRequestStatusAction}>
                      <input type="hidden" name="requestId" value={request.id} />
                      <input type="hidden" name="status" value={status} />
                      <SubmitButton variant={status === request.status ? 'primary' : 'secondary'} size="sm" className="w-full">
                        {STATUS_LABELS[status]}
                      </SubmitButton>
                    </form>
                  ))
                : null}
              {request.convertedLeadId ? (
                <Link href="/leady" className="btn-secondary mt-2 w-full">
                  Przejdź do leadów
                </Link>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
