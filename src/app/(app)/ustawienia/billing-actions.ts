'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { createSubscriptionCheckoutSession, getStripe, stripeStatus } from '@/lib/billing/stripe';
import { writeAuditLog } from '@/lib/audit';

const PLANS = new Set(['PRO', 'BUSINESS']);

/**
 * Rozpoczęcie PRAWDZIWEJ subskrypcji w Stripe.
 * Bez skonfigurowanych kluczy i cen akcja kończy się jawnym błędem —
 * system nie udaje aktywnej subskrypcji.
 */
export async function startSubscriptionAction(formData: FormData): Promise<void> {
  // Akcja płatnicza musi działać także, gdy konto jest w trybie tylko do odczytu.
  const context = await requirePermissionOrThrow('billing:manage', null, { allowWhenReadOnly: true });
  const planIdRaw = String(formData.get('planId') ?? '');

  if (!PLANS.has(planIdRaw)) redirect('/ustawienia?blad=Nieznany%20plan');

  const base = (process.env.APP_URL ?? '').replace(/\/$/, '') || '';
  const result = await createSubscriptionCheckoutSession({
    organizationId: context.organization.id,
    organizationName: context.organization.name,
    planId: planIdRaw as 'PRO' | 'BUSINESS',
    customerEmail: context.user.email,
    successUrl: `${base}/ustawienia?platnosc=oczekuje`,
    cancelUrl: `${base}/ustawienia?platnosc=anulowana`,
  });

  if (!result.ok) {
    redirect(`/ustawienia?blad=${encodeURIComponent(result.error)}`);
  }

  redirect(result.url);
}

/**
 * Wyłączenie odnawiania subskrypcji (na koniec okresu rozliczeniowego).
 * Wymaga prawdziwego wywołania API Stripe — bez kluczy zwracamy błąd.
 */
export async function cancelRenewalAction(): Promise<void> {
  const context = await requirePermissionOrThrow('billing:manage', null, { allowWhenReadOnly: true });

  if (!stripeStatus().configured) {
    redirect('/ustawienia?blad=' + encodeURIComponent('Integracja Stripe nie jest skonfigurowana — nie można zmienić subskrypcji.'));
  }

  const subscriptionId = context.organization.stripeSubscriptionId;
  const stripe = getStripe();

  if (!subscriptionId || !stripe) {
    redirect('/ustawienia?blad=' + encodeURIComponent('Brak aktywnej subskrypcji w Stripe.'));
  }

  try {
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    await writeAuditLog({
      organizationId: context.organization.id,
      userId: context.user.id,
      action: 'subscription.cancel_renewal',
      entityType: 'organization',
      entityId: context.organization.id,
      meta: { subscriptionId },
    });
  } catch (error) {
    redirect(`/ustawienia?blad=${encodeURIComponent(`Stripe odrzucił żądanie: ${(error as Error).message}`)}`);
  }

  revalidatePath('/ustawienia');
  redirect('/ustawienia?wynik=odnowienie-wylaczone');
}
