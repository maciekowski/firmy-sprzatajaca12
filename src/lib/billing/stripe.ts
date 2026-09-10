import Stripe from 'stripe';
import { PLANS, type Plan } from './plans';
import { isSupportedCurrency, SUPPORTED_CURRENCIES } from '@/lib/money';

/**
 * Integracja płatności Stripe.
 *
 * Zasady (zgodnie z wymaganiami produktu):
 *  - bez kluczy API NIE symulujemy płatności — zwracamy jawny status
 *    „Integracja nie jest jeszcze skonfigurowana”,
 *  - pieniądze księgujemy wyłącznie na podstawie podpisanego webhooka Stripe
 *    (potwierdzenie z serwera Stripe), nigdy na podstawie powrotu z przeglądarki,
 *  - fakt, że API przyjęło żądanie (2xx) oznacza jedynie „zainicjowano płatność”,
 *    a nie „zapłacono”.
 */

export type StripeIntegrationStatus = {
  configured: boolean;
  label: string;
  detail: string;
  publishableKey: string | null;
  secretConfigured: boolean;
  webhookConfigured: boolean;
};

export const NOT_CONFIGURED_LABEL = 'Integracja nie jest jeszcze skonfigurowana';

export function stripeStatus(): StripeIntegrationStatus {
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? '';
  const webhook = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || null;

  if (!secret) {
    return {
      configured: false,
      label: NOT_CONFIGURED_LABEL,
      detail: 'Brak klucza STRIPE_SECRET_KEY. Płatności kartą są nieaktywne — system ich nie symuluje.',
      publishableKey,
      secretConfigured: false,
      webhookConfigured: Boolean(webhook),
    };
  }

  if (!webhook) {
    return {
      configured: false,
      label: NOT_CONFIGURED_LABEL,
      detail:
        'Brak klucza STRIPE_WEBHOOK_SECRET. Bez weryfikacji podpisu nie można bezpiecznie księgować płatności, dlatego płatności online pozostają nieaktywne.',
      publishableKey,
      secretConfigured: true,
      webhookConfigured: false,
    };
  }

  return {
    configured: true,
    label: 'Połączono — klucze API i webhook skonfigurowane',
    detail: 'Płatności kartą działają: sesja płatności w Stripe, zaksięgowanie po podpisanym webhooku.',
    publishableKey,
    secretConfigured: true,
    webhookConfigured: true,
  };
}

export function getStripe(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return null;
  return new Stripe(secret, { typescript: true });
}

export type CheckoutSessionInput = {
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSessionResult =
  | { ok: true; url: string; sessionId: string; paymentIntentId: string | null }
  | { ok: false; error: string; notConfigured: boolean };

/**
 * Tworzy PRAWDZIWĄ sesję płatności w Stripe (hostowana strona checkout).
 * Bez kluczy API zwraca błąd — nic nie jest symulowane.
 */
export async function createInvoiceCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
  const status = stripeStatus();
  if (!status.configured) return { ok: false, error: status.detail, notConfigured: true };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: 'Kwota do zapłaty musi być większa od zera.', notConfigured: false };
  }
  if (!isSupportedCurrency(input.currency)) {
    return {
      ok: false,
      error: `Płatność kartą nie jest dostępna dla waluty ${input.currency}. Obsługiwane: ${SUPPORTED_CURRENCIES.join(', ')} — tę fakturę można opłacić przelewem.`,
      notConfigured: false,
    };
  }

  const stripe = getStripe();
  if (!stripe) return { ok: false, error: status.detail, notConfigured: true };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountCents,
            product_data: { name: `Faktura ${input.invoiceNumber}` },
          },
        },
      ],
      metadata: { organizationId: input.organizationId, invoiceId: input.invoiceId },
      payment_intent_data: {
        metadata: { organizationId: input.organizationId, invoiceId: input.invoiceId },
      },
      customer_email: input.customerEmail ?? undefined,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    });

    if (!session.url) {
      return { ok: false, error: 'Stripe nie zwrócił adresu sesji płatności.', notConfigured: false };
    }

    return {
      ok: true,
      url: session.url,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
    };
  } catch (error) {
    return { ok: false, error: `Stripe odrzucił żądanie: ${(error as Error).message}`, notConfigured: false };
  }
}

/**
 * Weryfikuje podpis webhooka. Zwraca null, gdy podpis jest błędny
 * (wynik jest jawnie zgłaszany — nie ufamy treści bez poprawnego podpisu).
 */
export function constructStripeEvent(rawBody: string, signatureHeader: string | null): Stripe.Event | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !signatureHeader) return null;
  const stripe = getStripe();
  if (!stripe) return null;
  try {
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch {
    return null;
  }
}

export type SubscriptionCheckoutInput = {
  organizationId: string;
  organizationName: string;
  planId: 'START' | 'PRO' | 'BUSINESS';
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
};

/**
 * PRAWDZIWA subskrypcja w Stripe (tryb `subscription`).
 * Wymaga identyfikatora ceny (STRIPE_PRICE_PRO / STRIPE_PRICE_BUSINESS) —
 * bez niego zwracamy jawny błąd konfiguracji (żadnej „udawanej” subskrypcji).
 */
export async function createSubscriptionCheckoutSession(
  input: SubscriptionCheckoutInput,
): Promise<CheckoutSessionResult> {
  const status = stripeStatus();
  if (!status.configured) return { ok: false, error: status.detail, notConfigured: true };

  const plan: Plan | undefined = PLANS.find((item) => item.id === input.planId);
  if (!plan) return { ok: false, error: 'Nieznany plan subskrypcji.', notConfigured: false };
  if (plan.priceCents === 0) {
    return { ok: false, error: 'Plan START jest darmowy — nie wymaga płatności.', notConfigured: false };
  }
  if (!plan.stripePriceId) {
    return {
      ok: false,
      error: `Brak identyfikatora ceny w Stripe dla planu ${plan.name} (STRIPE_PRICE_${plan.id}). Subskrypcja nie jest skonfigurowana.`,
      notConfigured: true,
    };
  }

  const stripe = getStripe();
  if (!stripe) return { ok: false, error: status.detail, notConfigured: true };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ quantity: 1, price: plan.stripePriceId }],
      metadata: { organizationId: input.organizationId, planId: plan.id, kind: 'subscription' },
      subscription_data: { metadata: { organizationId: input.organizationId, planId: plan.id } },
      client_reference_id: input.organizationId,
      customer_email: input.customerEmail ?? undefined,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });

    if (!session.url) return { ok: false, error: 'Stripe nie zwrócił adresu sesji subskrypcji.', notConfigured: false };

    return { ok: true, url: session.url, sessionId: session.id, paymentIntentId: null };
  } catch (error) {
    return { ok: false, error: `Stripe odrzucił żądanie: ${(error as Error).message}`, notConfigured: false };
  }
}

/** Mapuje status subskrypcji Stripe na status w systemie. */
export function mapStripeSubscriptionStatus(status: string): 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'UNPAID' | 'PAUSED' {
  switch (status) {
    case 'trialing':
      return 'TRIALING';
    case 'active':
      return 'ACTIVE';
    case 'past_due':
      return 'PAST_DUE';
    case 'unpaid':
      return 'UNPAID';
    case 'paused':
      return 'PAUSED';
    default:
      return 'CANCELED';
  }
}
