import { requirePermission } from '@/lib/auth/guards';
import { PageHeader } from '@/components/ui';
import { CustomerForm } from '@/components/customers/forms';

export const metadata = { title: 'Nowy klient' };

export default async function NewCustomerPage() {
  await requirePermission('customer:write');

  return (
    <>
      <PageHeader title="Nowy klient" description="Dodaj klienta indywidualnego lub firmę." />
      <CustomerForm />
    </>
  );
}
