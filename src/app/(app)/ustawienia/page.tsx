import Link from 'next/link';
import { Building2, CreditCard, Users } from 'lucide-react';
import { requirePermission } from '@/lib/auth/guards';
import { listOrganizationMembers } from '@/lib/services/organizations';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { changeRoleAction } from '@/app/(app)/ustawienia/actions';
import { SettingsForm, InviteMemberForm } from '@/components/settings/forms';
import { ROLE_LABELS } from '@/lib/authz/permissions';
import { formatDate } from '@/lib/constants';
import { cancelRenewalAction, startSubscriptionAction } from '@/app/(app)/ustawienia/billing-actions';
import { stripeStatus } from '@/lib/billing/stripe';
import { evaluateSubscription } from '@/lib/billing/subscription';

export const metadata = { title: 'Ustawienia' };

export default async function SettingsPage({ searchParams }: { searchParams?: Promise<{ blad?: string; wynik?: string; platnosc?: string }> }) {
  const params = (await searchParams) ?? {};
  const context = await requirePermission('org:manage');
  const members = await listOrganizationMembers(context.organization.id);
  const organization = context.organization;
  const subscription = evaluateSubscription({
    plan: organization.plan,
    status: organization.subscriptionStatus,
    trialEndsAt: organization.trialEndsAt ?? null,
    subscriptionEndsAt: organization.subscriptionEndsAt ?? null,
  });
  const stripe = stripeStatus();

  return (
    <>
      <PageHeader
        title="Ustawienia firmy"
        description="Konfiguracja firmy, zasady wyceny, wymagania realizacji i ludzie."
        actions={
          <Link href="/ustawienia/uslugi" className="btn-secondary">
            Cennik usług
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SettingsForm
            organization={{
              name: organization.name,
              taxId: organization.taxId,
              email: organization.email,
              phone: organization.phone,
              website: organization.website,
              street: organization.street,
              postalCode: organization.postalCode,
              city: organization.city,
              serviceArea: organization.serviceArea,
              currency: organization.currency,
              taxRateBps: organization.taxRateBps,
              paymentTermsDays: organization.paymentTermsDays,
              invoicePrefix: organization.invoicePrefix,
              quotePrefix: organization.quotePrefix,
              jobPrefix: organization.jobPrefix,
              estimatePrefix: organization.estimatePrefix,
              invoiceNotes: organization.invoiceNotes,
              quoteTerms: organization.quoteTerms,
              travelFeeType: organization.travelFeeType,
              travelFlatFeeCents: organization.travelFlatFeeCents,
              travelPerKmCents: organization.travelPerKmCents,
              urgencySurchargeBps: organization.urgencySurchargeBps,
              minJobValueCents: organization.minJobValueCents,
              completionRequirements: organization.completionRequirements
                ? {
                    requireChecklist: Boolean(organization.completionRequirements.requireChecklist),
                    requireAfterPhotos: Boolean(organization.completionRequirements.requireAfterPhotos),
                    requireNote: Boolean(organization.completionRequirements.requireNote),
                    minAfterPhotos: organization.completionRequirements.minAfterPhotos ?? 1,
                  }
                : null,
            }}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" /> Subskrypcja
                </span>
              }
              description="Status subskrypcji ustala serwer (okres próbny 10 dni, płatności przez Stripe)."
            />
            <CardBody className="space-y-3 text-sm">
              {params.blad ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-900">{params.blad}</p>
              ) : null}
              {params.wynik === 'odnowienie-wylaczone' ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
                  Odnawianie subskrypcji zostało wyłączone w Stripe (dostęp do końca opłaconego okresu).
                </p>
              ) : null}
              {params.platnosc === 'oczekuje' ? (
                <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
                  Otwarto płatność w Stripe. Status subskrypcji zmieni się po potwierdzeniu z serwera Stripe (webhook).
                </p>
              ) : null}

              <div className="flex justify-between">
                <span className="text-ink-500">Plan</span>
                <Badge tone={subscription.active ? 'success' : subscription.readOnly ? 'danger' : 'neutral'}>
                  {subscription.plan}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Status</span>
                <span className="text-ink-800">
                  {subscription.active ? 'Aktywna' : subscription.trialing ? 'Okres próbny' : subscription.status}
                </span>
              </div>
              {subscription.trialing && subscription.trialDaysLeft !== null ? (
                <div className="flex justify-between">
                  <span className="text-ink-500">Pozostało dni próby</span>
                  <span className="tabular text-ink-800">{subscription.trialDaysLeft}</span>
                </div>
              ) : null}
              {subscription.message ? (
                <p className={`rounded-lg px-3 py-2 ${subscription.readOnly ? 'border border-red-200 bg-red-50 text-red-900' : 'border border-amber-200 bg-amber-50 text-amber-900'}`}>
                  {subscription.message}
                </p>
              ) : null}

              <p className="text-xs text-ink-500">
                Stripe: {stripe.configured ? 'skonfigurowany' : 'nie jest jeszcze skonfigurowany'} — {stripe.detail}
              </p>

              {context.can('billing:manage') ? (
                <div className="space-y-2 pt-1">
                  <form action={startSubscriptionAction}>
                    <input type="hidden" name="planId" value="PRO" />
                    <SubmitButton variant="success">Aktywuj plan PRO</SubmitButton>
                  </form>
                  <form action={startSubscriptionAction}>
                    <input type="hidden" name="planId" value="BUSINESS" />
                    <SubmitButton>Aktywuj plan BUSINESS</SubmitButton>
                  </form>
                  {context.organization.stripeSubscriptionId ? (
                    <form action={cancelRenewalAction}>
                      <SubmitButton variant="secondary">Wyłącz odnawianie (na koniec okresu)</SubmitButton>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Firma
                </span>
              }
            />
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-500">Plan</span>
                <Badge tone={organization.subscriptionStatus === 'ACTIVE' ? 'success' : 'neutral'}>{organization.plan}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Subskrypcja</span>
                <span className="text-ink-800">{organization.subscriptionStatus}</span>
              </div>
              {organization.trialEndsAt ? (
                <div className="flex justify-between">
                  <span className="text-ink-500">Trial do</span>
                  <span className="text-ink-800">{formatDate(organization.trialEndsAt)}</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-ink-500">Limity miejsc</span>
                <span className="text-ink-800">{organization.seatsLimit}</span>
              </div>
              <Link href="/ustawienia/integracje" className="btn-secondary mt-2 w-full">
                <CreditCard className="h-4 w-4" /> Integracje i płatności
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" /> Zespół ({members.length})
                </span>
              }
            />
            <CardBody className="space-y-4">
              <ul className="space-y-3">
                {members.map((member) => (
                  <li key={member.userId} className="space-y-1 border-b border-ink-100 pb-3 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink-900">{member.name}</span>
                      {member.userId === context.user.id ? <Badge tone="info">Ty</Badge> : null}
                    </div>
                    <p className="text-xs text-ink-500">{member.email}</p>
                    {context.can('members:manage') ? (
                      <form action={changeRoleAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={member.userId} />
                        <select name="role" defaultValue={member.role} className="input h-9 w-44 py-1 text-sm">
                          {(['OWNER', 'ADMIN', 'DISPATCHER', 'WORKER', 'VIEWER'] as const).map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                        <SubmitButton variant="secondary" size="sm">
                          Zapisz
                        </SubmitButton>
                      </form>
                    ) : (
                      <Badge tone="neutral">{ROLE_LABELS[member.role]}</Badge>
                    )}
                  </li>
                ))}
              </ul>

              {context.can('members:manage') ? (
                <div className="border-t border-ink-100 pt-3">
                  <InviteMemberForm />
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
