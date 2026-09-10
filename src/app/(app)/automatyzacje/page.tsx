import { Zap } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { listAutomationRuns, listAutomations } from '@/lib/services/automations';
import { ACTION_LABELS, getAutomationStats, TRIGGER_LABELS } from '@/lib/automation/engine';
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { deleteAutomationAction, runDueAutomationsAction, toggleAutomationAction } from '@/app/(app)/automatyzacje/actions';
import { AutomationForm } from '@/components/automations/automation-form';
import { formatDateTime } from '@/lib/constants';

export const metadata = { title: 'Automatyzacje' };

const RUN_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'info',
  RUNNING: 'warning',
  SUCCESS: 'success',
  FAILED: 'danger',
  SKIPPED: 'neutral',
  CANCELLED: 'neutral',
};

const RUN_LABELS: Record<string, string> = {
  PENDING: 'Zaplanowane',
  RUNNING: 'W trakcie',
  SUCCESS: 'Wykonane',
  FAILED: 'Błąd',
  SKIPPED: 'Pominięte',
  CANCELLED: 'Anulowane',
};

export default async function AutomationsPage() {
  const context = await requirePermission('automation:manage');
  const [automations, runs, stats] = await Promise.all([
    listAutomations(context.organization.id),
    listAutomationRuns(context.organization.id),
    getAutomationStats(context.organization.id),
  ]);

  const activeCount = automations.filter((automation) => automation.isActive).length;

  return (
    <>
      <PageHeader
        title="Automatyzacje"
        description="Wyzwalacz + warunek + opóźnienie + akcja. Każde wykonanie jest zapisywane w historii."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Automatyzacje" value={String(automations.length)} hint={`aktywne: ${activeCount}`} />
        <Stat label="Wykonane" value={String(stats.SUCCESS ?? 0)} tone="success" />
        <Stat label="Błędy" value={String(stats.FAILED ?? 0)} tone={(stats.FAILED ?? 0) > 0 ? 'danger' : 'neutral'} />
        <Stat label="Zaplanowane" value={String(stats.PENDING ?? 0)} tone="info" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Reguły"
              description="Automatyzacje są wykonywane przez workera (kolejka w bazie z blokadą rekordu — bez podwójnych wykonań)."
            />
            <CardBody className="space-y-4">
              {automations.length === 0 ? (
                <EmptyState title="Brak automatyzacji" description="Utwórz pierwszą regułę, np. przypomnienie o ofercie po 2 dniach." />
              ) : (
                automations.map((automation) => (
                  <div key={automation.id} className="rounded-lg border border-ink-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-ink-900">{automation.name}</p>
                      <Badge tone={automation.isActive ? 'success' : 'neutral'}>{automation.isActive ? 'Aktywna' : 'Nieaktywna'}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-600">
                      Kiedy: <strong>{TRIGGER_LABELS[automation.trigger] ?? automation.trigger}</strong>
                      {automation.delayMinutes > 0
                        ? ` → po ${Math.floor(automation.delayMinutes / 1440)} d ${Math.floor((automation.delayMinutes % 1440) / 60)} h`
                        : ' → od razu'}
                      {' → '}
                      <strong>{ACTION_LABELS[automation.action] ?? automation.action}</strong>
                    </p>
                    <p className="text-xs text-ink-500">
                      {automation.lastRunAt ? `Ostatnie uruchomienie: ${formatDateTime(automation.lastRunAt)}` : 'Nie uruchamiana'}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <form action={toggleAutomationAction}>
                        <input type="hidden" name="automationId" value={automation.id} />
                        <input type="hidden" name="isActive" value={automation.isActive ? 'false' : 'true'} />
                        <SubmitButton variant="secondary" size="sm">
                          {automation.isActive ? 'Wyłącz' : 'Włącz'}
                        </SubmitButton>
                      </form>
                      <form action={deleteAutomationAction}>
                        <input type="hidden" name="automationId" value={automation.id} />
                        <SubmitButton variant="danger" size="sm" confirm={`Usunąć automatyzację ${automation.name}?`}>
                          Usuń
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Historia wykonań"
              description="Każde uruchomienie: status, czas, wynik i błąd (jeśli wystąpił)."
              actions={
                <form action={runDueAutomationsAction}>
                  <SubmitButton variant="secondary" size="sm">
                    <Zap className="h-4 w-4" /> Uruchom kolejkę teraz
                  </SubmitButton>
                </form>
              }
            />
            <CardBody>
              {runs.length === 0 ? (
                <p className="text-sm text-ink-500">Brak uruchomień.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Automatyzacja</th>
                        <th>Zaplanowano</th>
                        <th>Wykonano</th>
                        <th>Status</th>
                        <th>Wynik</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map(({ run, automationName }) => (
                        <tr key={run.id}>
                          <td className="font-medium text-ink-900">{automationName}</td>
                          <td className="tabular">{formatDateTime(run.scheduledAt)}</td>
                          <td className="tabular">{run.finishedAt ? formatDateTime(run.finishedAt) : '—'}</td>
                          <td>
                            <Badge tone={RUN_TONES[run.status] ?? 'neutral'}>{RUN_LABELS[run.status] ?? run.status}</Badge>
                          </td>
                          <td className="text-xs text-ink-600">
                            {run.error ?? run.result ?? '—'}
                            {run.attempts > 1 ? ` (próba ${run.attempts})` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader title="Nowa automatyzacja" />
            <CardBody>
              <AutomationForm />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
