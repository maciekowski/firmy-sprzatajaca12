import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { memberships, organizations, users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/auth/password';

let counter = 0;

/** Tworzy odizolowaną organizację testową (prawdziwa baza PostgreSQL). */
export async function createTestOrganization(
  name = 'Test',
  overrides: Partial<typeof organizations.$inferInsert> = {},
) {
  counter += 1;
  const suffix = `${Date.now().toString(36)}${counter}${randomBytes(3).toString('hex')}`;

  const [user] = await db
    .insert(users)
    .values({
      email: `test-${suffix}@example.com`,
      name: `Test User ${suffix}`,
      passwordHash: await hashPassword('TestHaslo12345'),
    })
    .returning();

  const [organization] = await db
    .insert(organizations)
    .values({
      name: `${name} ${suffix}`,
      slug: `test-${suffix}`,
      ...overrides,
    })
    .returning();

  await db.insert(memberships).values({ organizationId: organization.id, userId: user.id, role: 'OWNER' });

  return {
    organization,
    user,
    organizationId: organization.id,
    userId: user.id,
    ctx: { organizationId: organization.id, userId: user.id, userName: user.name },
  };
}

export async function deleteTestOrganization(organizationId: string): Promise<void> {
  await db.delete(organizations).where(eq(organizations.id, organizationId));
}

export async function deleteTestUser(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

/** Tworzy klienta testowego w organizacji. */
export async function createTestCustomer(
  organizationId: string,
  overrides: Partial<{
    displayName: string;
    email: string;
    phone: string;
    city: string;
    street: string;
    emailOptIn: boolean;
    smsOptIn: boolean;
  }> = {},
) {
  const { customers } = await import('@/lib/db/schema');
  const [customer] = await db
    .insert(customers)
    .values({
      organizationId,
      type: 'INDIVIDUAL',
      firstName: 'Jan',
      lastName: 'Testowy',
      displayName: overrides.displayName ?? 'Jan Testowy',
      email: overrides.email ?? null,
      phone: overrides.phone ?? null,
      city: overrides.city ?? null,
      street: overrides.street ?? null,
      emailOptIn: overrides.emailOptIn ?? true,
      smsOptIn: overrides.smsOptIn ?? false,
    })
    .returning();
  return customer;
}

/** Tworzy usługę testową (z opcjonalnymi progami). */
export async function createTestService(
  organizationId: string,
  overrides: Partial<{
    name: string;
    pricingMode: string;
    unit: string;
    basePriceCents: number;
    minPriceCents: number;
    taxRateBps: number;
    durationMinutes: number;
    hourlyRateCents: number | null;
  }> = {},
  tiers: { minQuantity: string; maxQuantity?: string | null; unitPriceCents: number; flatFeeCents?: number }[] = [],
) {
  const { services, servicePrices } = await import('@/lib/db/schema');
  const [service] = await db
    .insert(services)
    .values({
      organizationId,
      name: overrides.name ?? 'Usługa testowa',
      pricingMode: (overrides.pricingMode ?? 'PER_UNIT') as never,
      unit: (overrides.unit ?? 'SQM') as never,
      basePriceCents: overrides.basePriceCents ?? 400,
      minPriceCents: overrides.minPriceCents ?? 0,
      taxRateBps: overrides.taxRateBps ?? 2300,
      durationMinutes: overrides.durationMinutes ?? 60,
      hourlyRateCents: overrides.hourlyRateCents ?? null,
    })
    .returning();

  if (tiers.length > 0) {
    await db.insert(servicePrices).values(
      tiers.map((tier) => ({
        serviceId: service.id,
        minQuantity: tier.minQuantity,
        maxQuantity: tier.maxQuantity ?? null,
        unitPriceCents: tier.unitPriceCents,
        flatFeeCents: tier.flatFeeCents ?? 0,
      })),
    );
  }

  return service;
}
