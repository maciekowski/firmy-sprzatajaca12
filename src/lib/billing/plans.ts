/**
 * Plany subskrypcji — konfiguracja cenowa w jednym miejscu.
 * Ceny można zmienić tutaj (lub przez zmienne środowiskowe), bez ingerencji w kod.
 */

export type PlanFeature = string;

export type Plan = {
  id: 'START' | 'PRO' | 'BUSINESS';
  name: string;
  /** cena w groszach za miesiąc */
  priceCents: number;
  /** identyfikator ceny w Stripe (opcjonalnie — z env) */
  stripePriceId?: string;
  description: string;
  features: PlanFeature[];
  cta: string;
  highlighted?: boolean;
  limits: {
    users: number;
    jobsPerMonth: number | null;
    storageMb: number;
  };
};

export const PLANS: Plan[] = [
  {
    id: 'START',
    name: 'START',
    priceCents: 0,
    description: 'Dla jednoosobowych firm, które porządkują pierwsze zlecenia.',
    cta: 'Zacznij za darmo',
    limits: { users: 1, jobsPerMonth: 20, storageMb: 500 },
    features: [
      '1 użytkownik',
      'Do 20 zleceń miesięcznie',
      'Klienci, leady i zapytania',
      'Wyceny i oferty z linkiem dla klienta',
      'Kalendarz i zlecenia',
      'Faktury i rejestracja płatności',
      'Prawdziwe PDF-y ofert i faktur',
    ],
  },
  {
    id: 'PRO',
    name: 'PRO',
    priceCents: Number(process.env.PLAN_PRO_PRICE_CENTS ?? 9900),
    stripePriceId: process.env.STRIPE_PRICE_PRO || undefined,
    description: 'Dla działającej ekipy, która potrzebuje grafiku i automatyzacji.',
    cta: 'Wybierz PRO',
    highlighted: true,
    limits: { users: 5, jobsPerMonth: null, storageMb: 5000 },
    features: [
      'Do 5 użytkowników',
      'Bez limitu zleceń',
      'Wszystko z planu START',
      'Ekipy i planowanie pracowników',
      'Rejestracja czasu pracy i checklisty',
      'Automatyczne follow-upy ofert',
      'Prośby o opinie po zleceniu',
      'Szablony wiadomości i automatyzacje',
    ],
  },
  {
    id: 'BUSINESS',
    name: 'BUSINESS',
    priceCents: Number(process.env.PLAN_BUSINESS_PRICE_CENTS ?? 19900),
    stripePriceId: process.env.STRIPE_PRICE_BUSINESS || undefined,
    description: 'Dla firm z kilkoma ekipami i rozliczeniami, które muszą się zgadzać.',
    cta: 'Wybierz BUSINESS',
    limits: { users: 20, jobsPerMonth: null, storageMb: 25000 },
    features: [
      'Do 20 użytkowników',
      'Wszystko z planu PRO',
      'Rozbudowane raporty i analityka',
      'Automatyzacje płatności i monitów',
      'Własne szablony dokumentów',
      'Asystent AI na bazie danych firmy',
      'Priorytetowe wsparcie',
    ],
  },
];

export function getPlan(id: string): Plan {
  return PLANS.find((plan) => plan.id === id) ?? PLANS[0];
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Sprawdzenie limitu planu — wymuszane po stronie serwera. */
export function checkPlanLimit(
  planId: string,
  metric: 'users' | 'jobsPerMonth',
  current: number,
): { allowed: boolean; limit: number | null; message?: string } {
  const plan = getPlan(planId);
  const limit = plan.limits[metric];
  if (limit === null) return { allowed: true, limit: null };
  if (current >= limit) {
    return {
      allowed: false,
      limit,
      message:
        metric === 'users'
          ? `Plan ${plan.name} pozwala na maksymalnie ${limit} użytkowników. Zmień plan, aby dodać kolejne osoby.`
          : `Plan ${plan.name} obejmuje ${limit} zleceń miesięcznie. Zmień plan, aby przyjmować więcej zleceń.`,
    };
  }
  return { allowed: true, limit };
}
