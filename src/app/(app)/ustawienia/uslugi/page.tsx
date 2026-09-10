import Link from 'next/link';
import { requirePermission } from '@/lib/auth/guards';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { ServiceListManager, type ServiceRow } from '@/components/settings/service-editor';
import { listServicesWithTiers } from '@/lib/data/services';
import { formatMoney } from '@/lib/money';

export const metadata = { title: 'Cennik usług' };

export default async function ServicesSettingsPage() {
  const context = await requirePermission('service:manage');
  const services = await listServicesWithTiers(context.organization.id);
  const currency = context.organization.currency;

  const rows: ServiceRow[] = services.map((service) => ({
    id: service.id,
    name: service.name,
    description: service.description,
    unit: service.unit,
    customUnitLabel: service.customUnitLabel,
    pricingMode: service.pricingMode,
    basePriceCents: service.basePriceCents,
    hourlyRateCents: service.hourlyRateCents,
    minPriceCents: service.minPriceCents,
    taxRateBps: service.taxRateBps,
    durationMinutes: service.durationMinutes,
    isActive: service.isActive,
    sortOrder: service.sortOrder,
    tiers: service.tiers.map((tier) => ({
      minQuantity: tier.minQuantity,
      maxQuantity: tier.maxQuantity,
      unitPriceCents: tier.unitPriceCents,
      flatFeeCents: tier.flatFeeCents,
    })),
  }));

  return (
    <>
      <PageHeader
        title="Cennik usług"
        description="Usługi, jednostki i sposoby wyceny. Silnik cenowy liczy kwoty wyłącznie na podstawie tych danych."
        breadcrumbs={
          <Link href="/ustawienia" className="hover:underline">
            Ustawienia
          </Link>
        }
      />

      <Card>
        <CardHeader title="Usługi" description={`Liczba usług: ${rows.length} · waluta: ${currency}`} />
        <CardBody>
          <ServiceListManager services={rows} />
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Przykład wyceny" description="Jak działa silnik dla aktywnej usługi." />
        <CardBody>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-500">Dodaj usługę, żeby zobaczyć przykład.</p>
          ) : (
            <ul className="space-y-1 text-sm text-ink-700">
              {rows.slice(0, 5).map((service) => (
                <li key={service.id}>
                  <strong>{service.name}</strong>: {service.pricingMode === 'HOURLY' ? 'stawka godzinowa' : 'cena'}{' '}
                  {formatMoney(service.pricingMode === 'HOURLY' ? (service.hourlyRateCents ?? 0) : service.basePriceCents, currency)}
                  {service.minPriceCents > 0 ? ` · minimum ${formatMoney(service.minPriceCents, currency)}` : ''}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
