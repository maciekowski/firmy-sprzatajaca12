import { requirePermission } from '@/lib/auth/guards';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { RequestForm } from '@/components/requests/request-form';
import { listServicesWithTiers } from '@/lib/data/services';
import { listCustomersForSelect } from '@/lib/data/services';

export const metadata = { title: 'Nowe zapytanie' };

export default async function NewRequestPage() {
  const context = await requirePermission('request:write');
  const [services, customers] = await Promise.all([
    listServicesWithTiers(context.organization.id, true),
    listCustomersForSelect(context.organization.id),
  ]);

  return (
    <>
      <PageHeader title="Nowe zapytanie" description="Treść od klienta — opcjonalnie przeanalizowana przez AI." />
      <Card>
        <CardHeader title="Treść zgłoszenia" />
        <CardBody>
          <RequestForm
            services={services.map((service) => ({ id: service.id, name: service.name }))}
            customers={customers.map((customer) => ({ id: customer.id, displayName: customer.displayName }))}
          />
        </CardBody>
      </Card>
    </>
  );
}
