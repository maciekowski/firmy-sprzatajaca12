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

export const metadata = { title: 'Ustawienia' };

export default async function SettingsPage() {
  const context = await requirePermission('org:manage');
  const members = await listOrganizationMembers(context.organization.id);
  const organization = context.organization;

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
