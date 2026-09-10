import { requirePermission } from '@/lib/auth/guards';
import { PageHeader } from '@/components/ui';
import { EstimateCreator } from '@/components/estimates/creator';
import { listCustomersForSelect, listServicesWithTiers } from '@/lib/data/services';

export const metadata = { title: 'Nowa wycena' };

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ klient?: string }> }) {
  const context = await requirePermission('estimate:write');
  const { klient } = await searchParams;

  const [customers, services] = await Promise.all([
    listCustomersForSelect(context.organization.id),
    listServicesWithTiers(context.organization.id, true),
  ]);

  return (
    <>
      <PageHeader
        title="Nowa wycena"
        description="Dodaj usługi i ilości — system policzy wartość według Twojego cennika."
      />
      <EstimateCreator
        customers={customers}
        services={services.map((service) => ({
          id: service.id,
          name: service.name,
          unit: service.unit,
          customUnitLabel: service.customUnitLabel,
          pricingMode: service.pricingMode,
          basePriceCents: service.basePriceCents,
          hourlyRateCents: service.hourlyRateCents,
          minPriceCents: service.minPriceCents,
          taxRateBps: service.taxRateBps,
          durationMinutes: service.durationMinutes,
          tiers: service.tiers.map((tier) => ({
            minQuantity: tier.minQuantity,
            maxQuantity: tier.maxQuantity,
            unitPriceCents: tier.unitPriceCents,
            flatFeeCents: tier.flatFeeCents,
          })),
        }))}
        organization={{
          currency: context.organization.currency,
          defaultTaxRatePercent: context.organization.taxRateBps / 100,
          travelFeeType: context.organization.travelFeeType,
          travelFlatFeeCents: context.organization.travelFlatFeeCents,
          travelPerKmCents: context.organization.travelPerKmCents,
          urgencySurchargePercent: context.organization.urgencySurchargeBps / 100,
          minJobValueCents: context.organization.minJobValueCents,
        }}
        initial={klient ? { customerId: klient } : undefined}
      />
    </>
  );
}
