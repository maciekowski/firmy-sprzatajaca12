import { Star } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { getReviewSummary, listReviewRequests } from '@/lib/services/reviews';
import { listCustomersForSelect } from '@/lib/data/services';
import { db } from '@/lib/db/client';
import { jobs } from '@/lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Select, Field, Input, Stat } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { createReviewRequestAction } from '@/app/(app)/opinie/actions';
import { formatDate, formatDateTime } from '@/lib/constants';

export const metadata = { title: 'Opinie' };

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Oczekuje',
  SENT: 'Wysłana',
  COMPLETED: 'Wystawiona',
  FAILED: 'Błąd',
  SKIPPED: 'Pominięta',
};

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ blad?: string }> }) {
  const context = await requirePermission('review:manage');
  const { blad } = await searchParams;

  const [requests, customers, summary, completedJobs] = await Promise.all([
    listReviewRequests(context.organization.id),
    listCustomersForSelect(context.organization.id),
    getReviewSummary(context.organization.id),
    db
      .select({ id: jobs.id, number: jobs.number, title: jobs.title })
      .from(jobs)
      .where(eq(jobs.organizationId, context.organization.id))
      .orderBy(desc(jobs.completedAt))
      .limit(50),
  ]);

  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');

  return (
    <>
      <PageHeader title="Opinie" description="Prośby o opinię po zakończonej pracy — z realnym zapisem oceny klienta." />

      {blad ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Wystawione opinie" value={String(summary.count)} />
        <Stat
          label="Średnia ocena"
          value={summary.average === null ? '—' : `${summary.average} / 5`}
          tone={summary.average !== null && summary.average >= 4 ? 'success' : 'neutral'}
        />
        <Stat label="Oczekujące prośby" value={String(summary.pending)} tone="info" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Prośby o opinię" />
            <CardBody>
              {requests.length === 0 ? (
                <EmptyState title="Brak próśb" description="Utwórz prośbę po zakończonym zleceniu — klient dostanie link." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Klient</th>
                        <th>Zlecenie</th>
                        <th>Ocena</th>
                        <th>Wysłana</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map(({ request, customerName, jobNumber }) => (
                        <tr key={request.id}>
                          <td className="font-medium text-ink-900">{customerName ?? '—'}</td>
                          <td className="text-ink-600">{jobNumber ?? '—'}</td>
                          <td>
                            {request.rating ? (
                              <span className="inline-flex items-center gap-1">
                                <Star className="h-3.5 w-3.5 text-amber-500" /> {request.rating}/5
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="tabular">{request.sentAt ? formatDate(request.sentAt) : '—'}</td>
                          <td>
                            <Badge
                              tone={
                                request.status === 'COMPLETED'
                                  ? 'success'
                                  : request.status === 'FAILED'
                                    ? 'danger'
                                    : request.status === 'PENDING'
                                      ? 'info'
                                      : 'neutral'
                              }
                            >
                              {STATUS_LABELS[request.status] ?? request.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {requests.filter((row) => row.request.comment).length > 0 ? (
                <div className="mt-4 space-y-2 border-t border-ink-100 pt-4">
                  <p className="stat-label">Komentarze klientów</p>
                  {requests
                    .filter((row) => row.request.comment)
                    .map(({ request, customerName }) => (
                      <blockquote key={request.id} className="rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-800">
                        „{request.comment}”
                        <footer className="mt-1 text-xs text-ink-500">
                          {customerName} · {request.respondedAt ? formatDateTime(request.respondedAt) : ''} · {request.rating}/5
                        </footer>
                      </blockquote>
                    ))}
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader title="Nowa prośba o opinię" />
            <CardBody>
              <form action={createReviewRequestAction} className="space-y-3">
                <Field label="Klient" required>
                  <Select name="customerId" required defaultValue="">
                    <option value="" disabled>
                      Wybierz klienta
                    </option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.displayName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Zlecenie">
                  <Select name="jobId" defaultValue="">
                    <option value="">Bez powiązania</option>
                    {completedJobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.number} · {job.title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Kanał">
                  <Select name="channel" defaultValue="OWN_FORM">
                    <option value="OWN_FORM">Formularz ServiceFlow</option>
                    <option value="GOOGLE">Google (własny link)</option>
                    <option value="OTHER">Inne</option>
                  </Select>
                </Field>
                <Field label="Link zewnętrzny (opcjonalnie)" hint="Wymagany, gdy kanał to Google.">
                  <Input name="externalUrl" placeholder="https://g.page/r/..." />
                </Field>
                <SubmitButton className="w-full">Utwórz prośbę</SubmitButton>
              </form>
            </CardBody>
          </Card>

          <Card className="mt-6">
            <CardHeader title="Linki do opinii" description="Skopiuj link i wyślij go klientowi (np. w wiadomości)." />
            <CardBody className="space-y-2">
              {requests.length === 0 ? (
                <p className="text-sm text-ink-500">Brak linków.</p>
              ) : (
                requests.slice(0, 10).map(({ request, customerName }) => (
                  <div key={request.id} className="rounded-lg border border-ink-200 p-2">
                    <p className="text-xs text-ink-500">{customerName}</p>
                    <p className="break-all text-xs text-ink-700">{appUrl}/o/{request.token}</p>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
