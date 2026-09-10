'use server';

import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { getAnalytics } from '@/lib/queries/analytics';
import { getAIProvider, aiProviderStatus } from '@/lib/ai';
import { formatMoney } from '@/lib/money';

export type AssistantState = {
  ok: boolean;
  answer?: string;
  source?: string;
  error?: string;
  facts?: string[];
};

/**
 * Asystent AI — odpowiada WYŁĄCZNIE na podstawie danych przekazanych z bazy.
 * Nie liczy pieniędzy (kwoty są już policzone przez SQL) i nie wymyśla liczb.
 */
export async function askAssistantAction(_prev: AssistantState, formData: FormData): Promise<AssistantState> {
  const context = await requirePermissionOrThrow('analytics:read');
  const question = String(formData.get('question') ?? '').trim();
  if (!question) return { ok: false, error: 'Wpisz pytanie.' };

  const analytics = await getAnalytics(context.organization.id);
  const currency = context.organization.currency;

  const snapshot = {
    firma: context.organization.name,
    waluta: currency,
    przychodOplacony: formatMoney(analytics.revenuePaidCents, currency),
    zafakturowano: formatMoney(analytics.revenueInvoicedCents, currency),
    doZaplaty: formatMoney(analytics.outstandingCents, currency),
    przeterminowane: formatMoney(analytics.overdueCents, currency),
    liczbaPrzeterminowanych: analytics.overdueCount,
    sredniaWartoscZlecenia: formatMoney(analytics.avgJobValueCents, currency),
    zleceniaZakonczone: analytics.jobsCompleted,
    zleceniaWszystkie: analytics.jobsTotal,
    ofertyWyslane: analytics.quotesSent,
    ofertyZaakceptowane: analytics.quotesAccepted,
    konwersjaProcent: analytics.conversionRate === null ? null : Math.round(analytics.conversionRate * 100),
    klienciPowracajacy: analytics.repeatCustomers,
    klienciRazem: analytics.customersTotal,
    przepracowaneGodziny: analytics.workedHours,
    przychodMiesiace: analytics.revenueByMonth.map((row) => `${row.month}: ${formatMoney(row.amountCents, currency)}`),
    najczestrzeUslugi: analytics.topServices.map((service) => `${service.name} ×${service.count}`),
  };

  const facts = [
    `Opłacone: ${snapshot.przychodOplacony}`,
    `Do zapłaty: ${snapshot.doZaplaty} (przeterminowane: ${snapshot.przeterminowane})`,
    `Zakończone zlecenia: ${snapshot.zleceniaZakonczone}, średnia: ${snapshot.sredniaWartoscZlecenia}`,
    `Oferty: ${snapshot.ofertyZaakceptowane}/${snapshot.ofertyWyslane} zaakceptowanych`,
  ];

  const provider = getAIProvider();
  const status = aiProviderStatus();

  const answer = await provider.answerBusinessQuestion({ question, data: snapshot });

  if (!answer) {
    return {
      ok: false,
      error: status.configured
        ? 'Dostawca AI nie zwrócił odpowiedzi. Spróbuj ponownie za chwilę.'
        : 'Asystent AI nie jest skonfigurowany. Poniżej są fakty policzone z bazy.',
      facts,
      source: 'brak odpowiedzi modelu — dane z bazy',
    };
  }

  return {
    ok: true,
    answer,
    facts,
    source: status.configured ? `model AI (${status.label})` : `silnik regułowy (${status.label})`,
  };
}
