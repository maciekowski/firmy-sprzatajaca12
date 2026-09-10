import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { addons, servicePrices, services } from '@/lib/db/schema';

export async function listServicesWithTiers(organizationId: string, onlyActive = false) {
  const rows = await db
    .select()
    .from(services)
    .where(onlyActive ? and(eq(services.organizationId, organizationId), eq(services.isActive, true)) : eq(services.organizationId, organizationId))
    .orderBy(asc(services.sortOrder), asc(services.name));

  const tiers = await db
    .select({ tier: servicePrices, serviceId: servicePrices.serviceId })
    .from(servicePrices)
    .innerJoin(services, eq(services.id, servicePrices.serviceId))
    .where(eq(services.organizationId, organizationId))
    .orderBy(asc(servicePrices.sortOrder));

  return rows.map((service) => ({
    ...service,
    tiers: tiers.filter((tier) => tier.serviceId === service.id).map((tier) => tier.tier),
  }));
}

export async function getService(organizationId: string, serviceId: string) {
  const rows = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listAddons(organizationId: string) {
  return db.select().from(addons).where(eq(addons.organizationId, organizationId)).orderBy(asc(addons.name));
}

export async function listCustomersForSelect(organizationId: string) {
  const { customers, customerAddresses } = await import('@/lib/db/schema');
  const rows = await db
    .select()
    .from(customers)
    .where(eq(customers.organizationId, organizationId))
    .orderBy(asc(customers.displayName));

  const addresses = await db
    .select({ address: customerAddresses, customerId: customerAddresses.customerId })
    .from(customerAddresses)
    .innerJoin(customers, eq(customers.id, customerAddresses.customerId))
    .where(eq(customers.organizationId, organizationId));

  return rows.map((customer) => ({
    id: customer.id,
    displayName: customer.displayName,
    addresses: addresses
      .filter((row) => row.customerId === customer.id)
      .map((row) => ({
        id: row.address.id,
        label: row.address.label,
        street: row.address.street,
        city: row.address.city,
      })),
  }));
}
