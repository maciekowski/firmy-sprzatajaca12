import { requirePermission } from '@/lib/auth/guards';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { LeadForm } from '@/components/leads/lead-form';
import { listServicesWithTiers } from '@/lib/data/services';
import { listMembers } from '@/lib/data/jobs';

export const metadata = { title: 'Nowy lead' };

export default async function NewLeadPage() {
  const context = await requirePermission('lead:write');
  const [services, members] = await Promise.all([
    listServicesWithTiers(context.organization.id, true),
    listMembers(context.organization.id),
  ]);

  return (
    <>
      <PageHeader title="Nowy lead" description="Zgłoszenie od potencjalnego klienta." />
      <Card>
        <CardHeader title="Dane leada" />
        <CardBody>
          <LeadForm
            services={services.map((service) => ({ id: service.id, name: service.name }))}
            members={members.map((member) => ({ userId: member.userId, name: member.name }))}
          />
        </CardBody>
      </Card>
    </>
  );
}
