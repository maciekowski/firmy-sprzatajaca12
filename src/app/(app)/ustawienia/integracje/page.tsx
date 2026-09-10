import Link from 'next/link';
import { CheckCircle2, MinusCircle } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { activeEmailProvider } from '@/lib/comms/email';
import { isKsefConfigured, KSEF_STATUS_LABELS } from '@/lib/ksef/config';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { TestEmailForm } from '@/components/settings/test-email-form';

export const metadata = { title: 'Integracje' };

type IntegrationRow = {
  name: string;
  purpose: string;
  configured: boolean;
  state: 'CONNECTED' | 'NOT_CONFIGURED' | 'PARTIAL';
  detail: string;
  env: string[];
};

function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

export default async function IntegrationsPage() {
  const context = await requirePermission('org:manage');

  const emailProvider = activeEmailProvider();
  const resend = Boolean(envValue('RESEND_API_KEY'));
  const smtp = Boolean(envValue('SMTP_HOST'));
  const stripe = Boolean(envValue('STRIPE_SECRET_KEY'));
  const stripeWebhook = Boolean(envValue('STRIPE_WEBHOOK_SECRET'));
  const ksef = isKsefConfigured();
  const ksefMode = envValue('KSEF_MODE') ?? null;
  const aiProvider = envValue('AI_PROVIDER');
  const aiKey = Boolean(envValue('OPENAI_API_KEY') || envValue('ANTHROPIC_API_KEY'));
  const smsProvider = Boolean(envValue('SMS_PROVIDER') && envValue('SMS_API_KEY'));

  const integrations: IntegrationRow[] = [
    {
      name: 'E-mail (Resend)',
      purpose: 'Wysyłka ofert, potwierdzeń, faktur i przypomnień do klientów.',
      configured: resend || smtp,
      state: resend || smtp ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail: resend
        ? `Aktywny provider: Resend. Nadawca: ${envValue('MAIL_FROM') ?? 'brak ustawionego nadawcy'}.`
        : smtp
          ? `Aktywny provider: SMTP (${envValue('SMTP_HOST')}).`
          : 'Brak konfiguracji — wiadomości zapisują się ze statusem SKIPPED_NO_PROVIDER i NIE są wysyłane.',
      env: ['RESEND_API_KEY', 'MAIL_FROM', 'RESEND_WEBHOOK_SECRET'],
    },
    {
      name: 'Webhook e-mail (Resend)',
      purpose: 'Potwierdzenia dostarczenia, odbicia i blokady adresów.',
      configured: Boolean(envValue('RESEND_WEBHOOK_SECRET')),
      state: envValue('RESEND_WEBHOOK_SECRET') ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail: envValue('RESEND_WEBHOOK_SECRET')
        ? `Endpoint: /api/webhooks/resend (podpis weryfikowany standardem Svix).`
        : 'Brak sekretu — zdarzenia z Resend są odrzucane (401), status wiadomości pozostaje SENT.',
      env: ['RESEND_WEBHOOK_SECRET'],
    },
    {
      name: 'Płatności (Stripe)',
      purpose: 'Płatności online i subskrypcja ServiceFlow.',
      configured: stripe,
      state: stripe ? (stripeWebhook ? 'CONNECTED' : 'PARTIAL') : 'NOT_CONFIGURED',
      detail: stripe
        ? `Klucz API skonfigurowany${stripeWebhook ? ', webhook zweryfikowany' : ', ale BRAK sekretu webhooka — potwierdzenia płatności nie są przyjmowane'}.`
        : 'Brak kluczy — płatności online NIEAKTYWNE. System nie symuluje płatności.',
      env: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_BUSINESS'],
    },
    {
      name: 'KSeF',
      purpose: 'Wysyłka faktur do Krajowego Systemu e-Faktur i podgląd statusu.',
      configured: ksef,
      state: ksef ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail: ksef
        ? `Tryb: ${ksefMode}. NIP: ${envValue('KSEF_NIP')?.slice(0, 3)}… (numer KSeF nadaje wyłącznie KSeF).`
        : 'Brak konfiguracji — faktury mają status „Nie skonfigurowano” i nie są nigdzie wysyłane.',
      env: ['KSEF_MODE', 'KSEF_NIP', 'KSEF_TOKEN'],
    },
    {
      name: 'SMS',
      purpose: 'Powiadomienia SMS do klientów i pracowników.',
      configured: smsProvider,
      state: smsProvider ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail: smsProvider
        ? `Provider: ${envValue('SMS_PROVIDER')}.`
        : 'Brak providera — wiadomości SMS nie są wysyłane (zapis ze statusem SKIPPED_NO_PROVIDER).',
      env: ['SMS_PROVIDER', 'SMS_API_KEY', 'SMS_FROM'],
    },
    {
      name: 'Asystent AI',
      purpose: 'Parsowanie zapytań i podpowiedzi tekstowe. Nigdy nie liczy pieniędzy.',
      configured: aiKey && Boolean(aiProvider) && aiProvider !== 'none',
      state: aiKey && Boolean(aiProvider) && aiProvider !== 'none' ? 'CONNECTED' : 'NOT_CONFIGURED',
      detail:
        aiProvider && aiProvider !== 'none' && aiKey
          ? `Provider: ${aiProvider}${envValue('AI_MODEL') ? ` (model ${envValue('AI_MODEL')})` : ''}.`
          : 'Brak klucza — działa deterministyczny silnik regułowy (bez AI). Wyceny i tak są liczone w kodzie.',
      env: ['AI_PROVIDER', 'AI_MODEL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    },
  ];

  return (
    <>
      <PageHeader
        title="Integracje"
        description="Stan połączeń jest sprawdzany po stronie serwera. Brak konfiguracji oznacza, że funkcja jest naprawdę nieaktywna."
        breadcrumbs={
          <Link href="/ustawienia" className="hover:underline">
            Ustawienia
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {integrations.map((integration) => (
          <Card key={integration.name}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {integration.state === 'CONNECTED' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <MinusCircle className="h-4 w-4 text-ink-400" />
                  )}
                  {integration.name}
                </span>
              }
            />
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge tone={integration.state === 'CONNECTED' ? 'success' : integration.state === 'PARTIAL' ? 'warning' : 'neutral'}>
                  {integration.state === 'CONNECTED' ? 'Połączono' : integration.state === 'PARTIAL' ? 'Częściowo' : 'Nie skonfigurowano'}
                </Badge>
                <span className="text-xs text-ink-500">{integration.purpose}</span>
              </div>
              <p className="text-sm text-ink-700">{integration.detail}</p>
              <p className="text-xs text-ink-500">Zmienne środowiskowe: {integration.env.join(', ')}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader title="Test wysyłki e-mail" description="Wykonuje prawdziwe wywołanie aktywnego providera." />
        <CardBody>
          <p className="mb-3 text-sm text-ink-600">
            Aktywny provider: <strong>{emailProvider.isConfigured() ? emailProvider.name : 'brak'}</strong>
            {emailProvider.isConfigured() ? null : ' — test nie wyśle wiadomości, dopóki konfiguracja nie zostanie uzupełniona.'}
          </p>
          {context.can('communication:send') ? <TestEmailForm defaultEmail={context.user.email} /> : null}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Statusy KSeF używane w systemie" />
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {Object.entries(KSEF_STATUS_LABELS).map(([key, label]) => (
              <Badge key={key} tone={key === 'ACCEPTED' ? 'success' : key === 'NOT_CONFIGURED' ? 'neutral' : 'info'}>
                {key} — {label}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-500">
            „Wysłana” nie oznacza „przyjęta”. Status ACCEPTED pojawia się wyłącznie po potwierdzeniu z KSeF, a numer
            KSeF tylko wtedy, gdy KSeF go przydzieli.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
