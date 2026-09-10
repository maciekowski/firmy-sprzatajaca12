/**
 * Subskrypcja i okres próbny — decyzja zapada WYŁĄCZNIE po stronie serwera.
 *
 * Zasady:
 *  - okres próbny trwa 10 dni i jest ustawiany przy utworzeniu firmy,
 *  - frontend nigdy nie ustala statusu (może go tylko wyświetlić),
 *  - po zakończeniu okresu próbnego bez aktywnej subskrypcji konto przechodzi
 *    w tryb „tylko do odczytu”: zapisy są blokowane jawnie, a nie po cichu.
 */

import { TRIAL_DAYS } from '@/lib/constants';

export type SubscriptionSnapshot = {
  plan: string;
  status: string;
  trialEndsAt: Date | null;
  subscriptionEndsAt: Date | null;
};

export type SubscriptionState = {
  plan: string;
  status: string;
  /** czy subskrypcja jest opłacona i aktywna */
  active: boolean;
  /** czy trwa okres próbny */
  trialing: boolean;
  /** liczba dni do końca okresu próbnego (0 = dziś ostatni dzień) */
  trialDaysLeft: number | null;
  /** czy zapisy są zablokowane (koniec próby bez opłacenia) */
  readOnly: boolean;
  /** komunikat do wyświetlenia użytkownikowi */
  message: string | null;
  trialEndsAt: Date | null;
};

export function trialEndsAtFrom(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

function daysBetween(now: Date, future: Date): number {
  const diff = future.getTime() - now.getTime();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

/**
 * Ocena stanu subskrypcji organizacji. Funkcja jest czysta (łatwa do przetestowania)
 * i używana zarówno w interfejsie, jak i w kontroli dostępu do zapisu.
 */
export function evaluateSubscription(org: SubscriptionSnapshot, now: Date = new Date()): SubscriptionState {
  const plan = org.plan ?? 'START';
  const status = org.status ?? 'NONE';

  const trialEnd = org.trialEndsAt ? new Date(org.trialEndsAt) : null;
  const daysLeft = trialEnd ? daysBetween(now, trialEnd) : null;
  const trialRunning = Boolean(trialEnd && daysLeft !== null && daysLeft > 0);

  // Opłacona subskrypcja — najwyższy priorytet.
  if (status === 'ACTIVE') {
    const expired = Boolean(org.subscriptionEndsAt && new Date(org.subscriptionEndsAt) < now);
    if (expired) {
      return {
        plan,
        status: 'CANCELED',
        active: false,
        trialing: false,
        trialDaysLeft: daysLeft,
        readOnly: true,
        message: 'Subskrypcja wygasła. Zapisy są zablokowane — dane pozostają dostępne do odczytu.',
        trialEndsAt: trialEnd,
      };
    }
    return {
      plan,
      status,
      active: true,
      trialing: trialRunning,
      trialDaysLeft: daysLeft,
      readOnly: false,
      message: null,
      trialEndsAt: trialEnd,
    };
  }

  /**
   * Statusy „problemowe” (PAST_DUE, UNPAID, PAUSED, CANCELED, INCOMPLETE_EXPIRED)
   * blokują zapis niezależnie od trwającego okresu próbnego — to decyzja
   * dostawcy płatności (Stripe), którą serwer respektuje.
   */
  const blockedStatuses = new Set(['PAST_DUE', 'UNPAID', 'PAUSED', 'CANCELED', 'INCOMPLETE_EXPIRED']);
  if (blockedStatuses.has(status)) {
    return {
      plan,
      status,
      active: false,
      trialing: false,
      trialDaysLeft: daysLeft,
      readOnly: true,
      message: `Subskrypcja ma status ${status}. Zapisy są zablokowane do czasu uregulowania płatności.`,
      trialEndsAt: trialEnd,
    };
  }

  // Trwający okres próbny.
  if (trialRunning) {
    return {
      plan,
      status: status === 'NONE' ? 'TRIALING' : status,
      active: false,
      trialing: true,
      trialDaysLeft: daysLeft,
      readOnly: false,
      message:
        daysLeft !== null && daysLeft <= 3
          ? `Okres próbny kończy się za ${daysLeft} ${daysLeft === 1 ? 'dzień' : 'dni'}.`
          : null,
      trialEndsAt: trialEnd,
    };
  }

  // Próba zakończona i brak opłaconej subskrypcji → tylko do odczytu.
  if (trialEnd && daysLeft !== null && daysLeft <= 0 && status !== 'ACTIVE') {
    return {
      plan,
      status: status === 'NONE' ? 'TRIALING' : status,
      active: false,
      trialing: false,
      trialDaysLeft: 0,
      readOnly: true,
      message: 'Okres próbny zakończył się. Aby dalej zapisywać dane, aktywuj subskrypcję (płatność obsługuje Stripe).',
      trialEndsAt: trialEnd,
    };
  }

  // Brak trialu (np. konto utworzone wcześniej) i status NONE → plan darmowy START.
  if (status === 'NONE' || status === 'TRIALING') {
    return {
      plan,
      status,
      active: false,
      trialing: false,
      trialDaysLeft: null,
      readOnly: false,
      message: null,
      trialEndsAt: trialEnd,
    };
  }

  // Pozostałe statusy (PAST_DUE, UNPAID, CANCELED, …) — blokada zapisu.
  return {
    plan,
    status,
    active: false,
    trialing: false,
    trialDaysLeft: daysLeft,
    readOnly: true,
    message: `Subskrypcja ma status ${status}. Zapisy są zablokowane do czasu uregulowania płatności.`,
    trialEndsAt: trialEnd,
  };
}

/** Komunikat blokady dla akcji zapisu (używany przez kontrolę dostępu). */
export function readOnlyMessage(state: SubscriptionState): string {
  return (
    state.message ??
    'Konto jest w trybie tylko do odczytu — zapisy są zablokowane do czasu aktywowania subskrypcji.'
  );
}
