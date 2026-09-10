import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { activities, organizations } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { claimWebhookEvent, markWebhookError } from '@/lib/webhooks';
import { constructStripeEvent, mapStripeSubscriptionStatus, stripeStatus } from '@/lib/billing/stripe';
import { recordStripePayment } from '@/lib/services/invoices';

/**
 * Webhook Stripe — jedyne miejsce, w którym płatność online staje się faktem.
 *
 * Zasady:
 *  - podpis jest weryfikowany; bez poprawnego podpisu dane nie zmieniają bazy,
 *  - to samo zdarzenie jest przetwarzane raz (idempotencja po `event.id`),
 *  - ta sama płatność (payment_intent) nie zostanie zaksięgowana dwa razy,
 *  - brak konfiguracji = status 503 i jawny komunikat (NIE udajemy sukcesu).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Wyszukuje organizację po identyfikatorze subskrypcji w Stripe. */
async function findOrganizationBySubscription(subscriptionId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.stripeSubscriptionId, subscriptionId))
    .limit(1);
  return row?.id ?? null;
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const limit = rateLimit(`webhook:stripe:${ip}`, 120, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Zbyt wiele żądań.' }, { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } });
  }

  const status = stripeStatus();
  if (!status.configured) {
    return NextResponse.json({ error: status.label, detail: status.detail }, { status: 503 });
  }

  const raw = await request.text();
  const event = constructStripeEvent(raw, request.headers.get('stripe-signature'));
  if (!event) {
    return NextResponse.json({ error: 'Podpis webhooka Stripe jest nieprawidłowy — zdarzenie odrzucone.' }, { status: 400 });
  }

  const claim = await claimWebhookEvent({
    provider: 'STRIPE',
    externalId: event.id,
    type: event.type,
    payload: { type: event.type, id: event.id, created: event.created },
    signatureValid: true,
  });

  if (!claim.claimed) {
    return NextResponse.json({ ok: true, duplicate: true, reason: claim.reason });
  }

  const object = event.data.object as unknown as Record<string, unknown>;

  try {
    if (event.type === 'checkout.session.completed') {
      const session = object as unknown as {
        id: string;
        mode?: string;
        payment_status?: string;
        amount_total?: number | null;
        payment_intent?: string | { id: string } | null;
        subscription?: string | { id: string } | null;
        customer?: string | { id: string } | null;
        metadata?: Record<string, unknown> | null;
      };

      // Subskrypcja ServiceFlow — aktywacja planu po opłaceniu w Stripe.
      if (session.mode === 'subscription') {
        const organizationId = asString(session.metadata?.organizationId);
        const planId = asString(session.metadata?.planId);

        if (!organizationId || !planId) {
          await markWebhookError(event.id, 'STRIPE', 'Brak metadanych subskrypcji (organizacja/plan).');
          return NextResponse.json({ error: 'Brak metadanych subskrypcji.' }, { status: 422 });
        }

        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : (session.subscription?.id ?? null);
        const customerId = typeof session.customer === 'string' ? session.customer : (session.customer?.id ?? null);

        let endsAt: Date | null = null;
        let stripeStatusValue = 'ACTIVE';
        if (subscriptionId) {
          try {
            const { getStripe } = await import('@/lib/billing/stripe');
            const stripe = getStripe();
            const subscription = stripe ? await stripe.subscriptions.retrieve(subscriptionId) : null;
            if (subscription) {
              stripeStatusValue = subscription.status;
              const periodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end;
              if (periodEnd) endsAt = new Date(periodEnd * 1000);
            }
          } catch (error) {
            await markWebhookError(event.id, 'STRIPE', `Nie udało się pobrać subskrypcji: ${(error as Error).message}`);
          }
        }

        await db
          .update(organizations)
          .set({
            plan: planId as never,
            subscriptionStatus: mapStripeSubscriptionStatus(stripeStatusValue) as never,
            stripeCustomerId: customerId ?? undefined,
            stripeSubscriptionId: subscriptionId ?? undefined,
            subscriptionEndsAt: endsAt,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, organizationId));

        await writeAuditLog({
          organizationId,
          userId: null,
          action: 'subscription.activated',
          entityType: 'organization',
          entityId: organizationId,
          meta: { planId, subscriptionId, stripeStatus: stripeStatusValue },
        });

        return NextResponse.json({ ok: true, subscription: stripeStatusValue, planId });
      }

      if (session.payment_status !== 'paid') {
        return NextResponse.json({ ok: true, ignored: true, reason: 'Sesja nie została opłacona.' });
      }

      const organizationId = asString(session.metadata?.organizationId);
      const invoiceId = asString(session.metadata?.invoiceId);
      const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null);

      if (!organizationId || !invoiceId) {
        await markWebhookError(event.id, 'STRIPE', 'Brak identyfikatorów organizacji/faktury w metadanych sesji.');
        return NextResponse.json({ error: 'Brak metadanych płatności.' }, { status: 422 });
      }

      const result = await recordStripePayment({
        organizationId,
        invoiceId,
        amountCents: Math.round(session.amount_total ?? 0),
        stripePaymentIntentId: paymentIntentId ?? `sess_${session.id}`,
        sessionId: session.id,
      });

      if (!result.ok) {
        await markWebhookError(event.id, 'STRIPE', result.error);
        return NextResponse.json({ error: result.error }, { status: 422 });
      }

      return NextResponse.json({
        ok: true,
        recorded: !result.duplicate,
        duplicate: result.duplicate,
        invoiceStatus: result.invoice.status,
      });
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = object as unknown as {
        id: string;
        amount?: number;
        metadata?: Record<string, unknown> | null;
      };

      const organizationId = asString(intent.metadata?.organizationId);
      const invoiceId = asString(intent.metadata?.invoiceId);

      if (!organizationId || !invoiceId) {
        return NextResponse.json({ ok: true, ignored: true, reason: 'Zdarzenie nie dotyczy faktury z tego systemu.' });
      }

      const result = await recordStripePayment({
        organizationId,
        invoiceId,
        amountCents: Math.round(intent.amount ?? 0),
        stripePaymentIntentId: intent.id,
      });

      if (!result.ok) {
        await markWebhookError(event.id, 'STRIPE', result.error);
        return NextResponse.json({ error: result.error }, { status: 422 });
      }

      return NextResponse.json({ ok: true, recorded: !result.duplicate, duplicate: result.duplicate });
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const subscription = object as unknown as {
        id: string;
        status?: string;
        current_period_end?: number;
        metadata?: Record<string, unknown> | null;
      };

      const organizationId =
        asString(subscription.metadata?.organizationId) ??
        (await findOrganizationBySubscription(subscription.id));

      if (!organizationId) {
        return NextResponse.json({ ok: true, ignored: true, reason: 'Subskrypcja nie należy do tego systemu.' });
      }

      const nextStatus = mapStripeSubscriptionStatus(subscription.status ?? (event.type.endsWith('.deleted') ? 'canceled' : 'active'));

      await db
        .update(organizations)
        .set({
          subscriptionStatus: nextStatus as never,
          plan: (asString(subscription.metadata?.planId) ?? undefined) as never,
          stripeSubscriptionId: subscription.id,
          subscriptionEndsAt: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, organizationId));

      await writeAuditLog({
        organizationId,
        userId: null,
        action: 'subscription.updated',
        entityType: 'organization',
        entityId: organizationId,
        meta: { stripeStatus: subscription.status ?? null, nextStatus, event: event.type },
      });

      return NextResponse.json({ ok: true, subscriptionStatus: nextStatus });
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = object as unknown as { subscription?: string | { id: string } | null; customer?: string | { id: string } | null };
      const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : (invoice.subscription?.id ?? null);
      const organizationId = subscriptionId ? await findOrganizationBySubscription(subscriptionId) : null;

      if (organizationId) {
        await db
          .update(organizations)
          .set({ subscriptionStatus: 'PAST_DUE', updatedAt: new Date() })
          .where(eq(organizations.id, organizationId));

        await writeAuditLog({
          organizationId,
          userId: null,
          action: 'subscription.payment_failed',
          entityType: 'organization',
          entityId: organizationId,
          meta: { subscriptionId },
        });
      }

      return NextResponse.json({ ok: true, marked: Boolean(organizationId) });
    }

    if (event.type === 'payment_intent.payment_failed' || event.type === 'charge.refunded') {
      const target = object as unknown as { id: string; metadata?: Record<string, unknown> | null };
      const organizationId = asString(target.metadata?.organizationId);
      const invoiceId = asString(target.metadata?.invoiceId);

      if (organizationId && invoiceId) {
        await db.insert(activities).values({
          organizationId,
          entityType: 'invoice',
          entityId: invoiceId,
          type: event.type === 'charge.refunded' ? 'payment_refunded' : 'payment_failed',
          message:
            event.type === 'charge.refunded'
              ? 'Stripe: płatność została zwrócona — sprawdź fakturę ręcznie.'
              : 'Stripe: płatność nie została zrealizowana.',
          userId: null,
          userName: 'Stripe (webhook)',
        });

        await writeAuditLog({
          organizationId,
          userId: null,
          action: event.type === 'charge.refunded' ? 'payment.stripe_refunded' : 'payment.stripe_failed',
          entityType: 'invoice',
          entityId: invoiceId,
          meta: { stripeId: target.id },
        });
      }

      return NextResponse.json({ ok: true, handled: event.type });
    }

    return NextResponse.json({ ok: true, ignored: true, type: event.type });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nieznany błąd.';
    await markWebhookError(event.id, 'STRIPE', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
