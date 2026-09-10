import { describe, expect, it } from 'vitest';
import { evaluateSubscription, readOnlyMessage, trialEndsAtFrom } from '@/lib/billing/subscription';
import { TRIAL_DAYS } from '@/lib/constants';
import { mapStripeSubscriptionStatus, stripeStatus } from '@/lib/billing/stripe';
import { parsePage, totalPages, PAGE_SIZE } from '@/lib/pagination';

/**
 * Testy reguł rozliczeniowych. Decyzja o subskrypcji zapada po stronie serwera,
 * dlatego logika musi być czysta i przetestowana bez dostępu do bazy.
 */
describe('okres próbny i subskrypcja (serwer decyduje)', () => {
  it('okres próbny trwa 10 dni', () => {
    expect(TRIAL_DAYS).toBe(10);
    const start = new Date('2026-01-01T10:00:00.000Z');
    const end = trialEndsAtFrom(start);
    const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(10);
  });

  it('w trakcie próby zapisy są dozwolone, a status to TRIALING', () => {
    const state = evaluateSubscription(
      {
        plan: 'START',
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        subscriptionEndsAt: null,
      },
      new Date(),
    );

    expect(state.trialing).toBe(true);
    expect(state.readOnly).toBe(false);
    expect(state.status).toBe('TRIALING');
    expect(state.trialDaysLeft).toBe(5);
  });

  it('po końcu próby bez opłacenia konto jest tylko do odczytu', () => {
    const state = evaluateSubscription(
      {
        plan: 'START',
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        subscriptionEndsAt: null,
      },
      new Date(),
    );

    expect(state.trialing).toBe(false);
    expect(state.readOnly).toBe(true);
    expect(state.active).toBe(false);
    expect(state.trialDaysLeft).toBe(0);
    expect(readOnlyMessage(state)).toContain('Okres próbny');
  });

  it('opłacona subskrypcja znosi blokadę zapisu', () => {
    const state = evaluateSubscription({
      plan: 'PRO',
      status: 'ACTIVE',
      trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      subscriptionEndsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    });

    expect(state.active).toBe(true);
    expect(state.readOnly).toBe(false);
    expect(state.plan).toBe('PRO');
  });

  it('subskrypcja po terminie (subscriptionEndsAt w przeszłości) blokuje zapis', () => {
    const state = evaluateSubscription({
      plan: 'PRO',
      status: 'ACTIVE',
      trialEndsAt: null,
      subscriptionEndsAt: new Date(Date.now() - 60 * 1000),
    });

    expect(state.readOnly).toBe(true);
    expect(state.status).toBe('CANCELED');
  });

  it('status PAST_DUE blokuje zapis (płatność nieuregulowana)', () => {
    const state = evaluateSubscription({
      plan: 'PRO',
      status: 'PAST_DUE',
      trialEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      subscriptionEndsAt: null,
    });

    expect(state.readOnly).toBe(true);
    expect(state.message).toContain('PAST_DUE');
  });

  it('firma bez trialu i ze statusem NONE korzysta z darmowego planu (brak blokady)', () => {
    const state = evaluateSubscription({
      plan: 'START',
      status: 'NONE',
      trialEndsAt: null,
      subscriptionEndsAt: null,
    });

    expect(state.readOnly).toBe(false);
    expect(state.trialing).toBe(false);
    expect(state.trialDaysLeft).toBeNull();
  });

  it('na 3 dni przed końcem próby pojawia się komunikat ostrzegawczy', () => {
    const state = evaluateSubscription(
      {
        plan: 'START',
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        subscriptionEndsAt: null,
      },
      new Date(),
    );

    expect(state.message).toContain('kończy się');
  });
});

describe('mapowanie statusów Stripe', () => {
  it('odwzorowuje statusy subskrypcji na statusy systemu', () => {
    expect(mapStripeSubscriptionStatus('active')).toBe('ACTIVE');
    expect(mapStripeSubscriptionStatus('trialing')).toBe('TRIALING');
    expect(mapStripeSubscriptionStatus('past_due')).toBe('PAST_DUE');
    expect(mapStripeSubscriptionStatus('unpaid')).toBe('UNPAID');
    expect(mapStripeSubscriptionStatus('paused')).toBe('PAUSED');
    expect(mapStripeSubscriptionStatus('canceled')).toBe('CANCELED');
    expect(mapStripeSubscriptionStatus('incomplete_expired')).toBe('CANCELED');
  });
});

describe('status integracji Stripe (bez udawania)', () => {
  it('bez kluczy API zwraca status „nie skonfigurowano”', () => {
    const previousSecret = process.env.STRIPE_SECRET_KEY;
    const previousWebhook = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const status = stripeStatus();
    expect(status.configured).toBe(false);
    expect(status.label).toBe('Integracja nie jest jeszcze skonfigurowana');

    if (previousSecret !== undefined) process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousWebhook !== undefined) process.env.STRIPE_WEBHOOK_SECRET = previousWebhook;
  });

  it('sama konfiguracja klucza API bez webhooka to nadal brak integracji (nie księgujemy na ślepo)', () => {
    const previousSecret = process.env.STRIPE_SECRET_KEY;
    const previousWebhook = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const status = stripeStatus();
    expect(status.configured).toBe(false);
    expect(status.secretConfigured).toBe(true);
    expect(status.webhookConfigured).toBe(false);
    expect(status.detail).toContain('STRIPE_WEBHOOK_SECRET');

    if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousWebhook !== undefined) process.env.STRIPE_WEBHOOK_SECRET = previousWebhook;
  });
});

describe('paginacja', () => {
  it('domyślnie zwraca pierwszą stronę', () => {
    const page = parsePage(undefined);
    expect(page.page).toBe(1);
    expect(page.limit).toBe(PAGE_SIZE);
    expect(page.offset).toBe(0);
  });

  it('liczy offset dla kolejnych stron', () => {
    expect(parsePage('3').offset).toBe(2 * PAGE_SIZE);
    expect(parsePage('3').page).toBe(3);
  });

  it('odporna na nieprawidłowe wartości (ujemne, tekst, ułamek)', () => {
    expect(parsePage('-5').page).toBe(1);
    expect(parsePage('abc').page).toBe(1);
    expect(parsePage('2.7').page).toBe(2);
    expect(parsePage(['4']).page).toBe(4);
  });

  it('ogranicza maksymalny numer strony', () => {
    expect(parsePage('999999').page).toBe(10_000);
  });

  it('liczba stron nigdy nie jest mniejsza niż 1', () => {
    expect(totalPages(0)).toBe(1);
    expect(totalPages(1)).toBe(1);
    expect(totalPages(PAGE_SIZE + 1)).toBe(2);
  });
});
