import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import { requireUser, getUserOrganizations } from '@/lib/auth/guards';
import { FirstServiceForm, FirstWorkerForm, OrganizationSetupForm } from '@/components/onboarding/forms';

export const metadata = { title: 'Konfiguracja firmy' };

const STEPS = [
  { id: 1, label: 'Firma' },
  { id: 2, label: 'Usługi' },
  { id: 3, label: 'Ekipa' },
];

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const user = await requireUser('/onboarding');
  const orgs = await getUserOrganizations(user.id);
  if (orgs.length === 0) redirect('/rejestracja');

  const organization = orgs[0].organization;
  const { step } = await searchParams;
  const currentStep = Math.min(3, Math.max(1, Number(step ?? '1') || 1));

  const rows = await db.select().from(organizations).where(eq(organizations.id, organization.id)).limit(1);
  const org = rows[0];

  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Skonfiguruj swoją firmę</h1>
        <p className="mt-2 text-sm text-ink-600">
          To zajmie około dwóch minut. Każdy krok możesz pominąć i wrócić do niego w ustawieniach.
        </p>
      </div>

      <ol className="mb-8 flex items-center justify-center gap-3">
        {STEPS.map((item) => {
          const state = item.id < currentStep ? 'done' : item.id === currentStep ? 'active' : 'todo';
          return (
            <li key={item.id} className="flex items-center gap-2">
              <span
                className={
                  state === 'active'
                    ? 'grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white'
                    : state === 'done'
                      ? 'grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700'
                      : 'grid h-8 w-8 place-items-center rounded-full bg-ink-100 text-sm font-semibold text-ink-500'
                }
              >
                {item.id}
              </span>
              <span className={state === 'active' ? 'text-sm font-medium text-ink-900' : 'text-sm text-ink-500'}>
                {item.label}
              </span>
              {item.id < STEPS.length ? <span className="mx-1 h-px w-8 bg-ink-200" /> : null}
            </li>
          );
        })}
      </ol>

      {currentStep === 1 ? (
        <OrganizationSetupForm
          defaults={{
            name: org?.name ?? '',
            businessType: org?.businessType ?? 'OTHER',
            city: org?.city ?? '',
            serviceArea: org?.serviceArea ?? '',
            currency: org?.currency ?? 'PLN',
            taxRatePercent: (org?.taxRateBps ?? 2300) / 100,
            taxId: org?.taxId ?? '',
            email: org?.email ?? '',
            phone: org?.phone ?? '',
            street: org?.street ?? '',
            postalCode: org?.postalCode ?? '',
            workingHours: (org?.workingHours as Record<string, { from: string; to: string } | null> | null) ?? null,
          }}
        />
      ) : null}

      {currentStep === 2 ? <FirstServiceForm /> : null}
      {currentStep === 3 ? <FirstWorkerForm /> : null}
    </div>
  );
}
