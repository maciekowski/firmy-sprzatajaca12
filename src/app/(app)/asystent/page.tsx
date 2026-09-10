import { Sparkles } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { aiProviderStatus } from '@/lib/ai';
import { getAnalytics } from '@/lib/queries/analytics';
import { Badge, Card, CardBody, CardHeader, PageHeader, Stat } from '@/components/ui';
import { AssistantForm } from '@/components/assistant/assistant-form';
import { formatMoney } from '@/lib/money';

export const metadata = { title: 'Asystent AI' };

export default async function AssistantPage() {
  const context = await requirePermission('analytics:read');
  const [analytics, status] = await Promise.all([getAnalytics(context.organization.id), Promise.resolve(aiProviderStatus())]);

  const currency = context.organization.currency;

  return (
    <>
      <PageHeader
        title="Asystent AI"
        description="Odpowiada wyłącznie na podstawie danych z Twojej bazy. Nie liczy pieniędzy — wszystkie kwoty są policzone wcześniej w kodzie."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Opłacone" value={formatMoney(analytics.revenuePaidCents, currency)} tone="success" />
        <Stat label="Do zapłaty" value={formatMoney(analytics.outstandingCents, currency)} />
        <Stat label="Zakończone zlecenia" value={String(analytics.jobsCompleted)} />
        <Stat
          label="Konwersja ofert"
          value={analytics.conversionRate === null ? '—' : `${Math.round(analytics.conversionRate * 100)}%`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Zadaj pytanie"
              description={
                status.configured
                  ? `Dostawca: ${status.label}.`
                  : 'AI nie jest skonfigurowane — odpowiedzi opierają się na silniku regułowym i prawdziwych danych.'
              }
              actions={
                <Badge tone={status.configured ? 'success' : 'neutral'}>
                  <Sparkles className="mr-1 h-3 w-3" />
                  {status.configured ? 'AI aktywne' : 'Silnik regułowy'}
                </Badge>
              }
            />
            <CardBody>
              <AssistantForm />
            </CardBody>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader title="Jak to działa" />
            <CardBody className="space-y-2 text-sm text-ink-700">
              <p>1. System pobiera policzone wskaźniki z bazy (SQL).</p>
              <p>2. Przekazuje je do warstwy AI jako jedyne źródło prawdy.</p>
              <p>3. AI nie ma dostępu do wyliczeń finansowych — nie może ich zmienić ani wymyślić.</p>
              <p>4. Bez klucza API działa silnik regułowy, który pokazuje fakty i wskazuje, co sprawdzić.</p>
            </CardBody>
          </Card>

          <Card className="mt-6">
            <CardHeader title="Przykładowe pytania" />
            <CardBody className="space-y-1 text-sm text-ink-700">
              <p>· Które usługi zarabiają najwięcej?</p>
              <p>· Ile mam zablokowane w nieopłaconych fakturach?</p>
              <p>· Co poprawić, żeby więcej ofert było akceptowanych?</p>
              <p>· Który miesiąc był najsłabszy?</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
