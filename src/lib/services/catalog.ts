import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { servicePrices, services } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';

export type ServiceContext = { organizationId: string; userId: string; userName: string };

export const PRICING_MODES = ['FIXED', 'PER_UNIT', 'HOURLY', 'TIERED'] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export type ServiceInput = {
  name: string;
  description?: string | null;
  unit: string;
  customUnitLabel?: string | null;
  pricingMode: PricingMode;
  basePriceCents: number;
  hourlyRateCents?: number | null;
  minPriceCents?: number;
  taxRateBps?: number | null;
  durationMinutes?: number;
  isActive?: boolean;
  sortOrder?: number;
  tiers?: { minQuantity: number; maxQuantity?: number | null; unitPriceCents: number; flatFeeCents: number }[];
};

function validate(input: ServiceInput): string | null {
  if (!input.name.trim()) return 'Podaj nazwę usługi.';
  if (!PRICING_MODES.includes(input.pricingMode)) return 'Nieznany sposób wyceny.';
  if (input.basePriceCents < 0) return 'Cena nie może być ujemna.';
  if (input.minPriceCents !== undefined && input.minPriceCents < 0) return 'Minimum nie może być ujemne.';
  if (input.taxRateBps !== undefined && input.taxRateBps !== null && (input.taxRateBps < 0 || input.taxRateBps > 10000)) {
    return 'Stawka VAT musi być między 0 a 100%.';
  }
  return null;
}

export async function createService(ctx: ServiceContext, input: ServiceInput) {
  const problem = validate(input);
  if (problem) return { ok: false as const, error: problem };

  const [created] = await db
    .insert(services)
    .values({
      organizationId: ctx.organizationId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      unit: input.unit as never,
      customUnitLabel: input.customUnitLabel?.trim() || null,
      pricingMode: input.pricingMode,
      basePriceCents: input.basePriceCents,
      hourlyRateCents: input.hourlyRateCents ?? null,
      minPriceCents: input.minPriceCents ?? 0,
      taxRateBps: input.taxRateBps ?? null,
      durationMinutes: input.durationMinutes ?? 60,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();

  if (input.pricingMode === 'TIERED' && input.tiers?.length) {
    await db.insert(servicePrices).values(
      input.tiers.map((tier, index) => ({
        serviceId: created.id,
        minQuantity: String(tier.minQuantity),
        maxQuantity: tier.maxQuantity === undefined || tier.maxQuantity === null ? null : String(tier.maxQuantity),
        unitPriceCents: tier.unitPriceCents,
        flatFeeCents: tier.flatFeeCents,
        sortOrder: index,
      })),
    );
  }

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'service.created',
    entityType: 'service',
    entityId: created.id,
    meta: { name: created.name },
  });

  return { ok: true as const, service: created };
}

export async function updateService(ctx: ServiceContext, serviceId: string, input: ServiceInput) {
  const rows = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.organizationId, ctx.organizationId)))
    .limit(1);
  if (rows.length === 0) return { ok: false as const, error: 'Nie znaleziono usługi.' };

  const problem = validate(input);
  if (problem) return { ok: false as const, error: problem };

  const [updated] = await db
    .update(services)
    .set({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      unit: input.unit as never,
      customUnitLabel: input.customUnitLabel?.trim() || null,
      pricingMode: input.pricingMode,
      basePriceCents: input.basePriceCents,
      hourlyRateCents: input.hourlyRateCents ?? null,
      minPriceCents: input.minPriceCents ?? 0,
      taxRateBps: input.taxRateBps ?? null,
      durationMinutes: input.durationMinutes ?? 60,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(services.id, serviceId))
    .returning();

  // progi cenowe są wymieniane w całości — proste i przewidywalne
  await db.delete(servicePrices).where(eq(servicePrices.serviceId, serviceId));
  if (input.pricingMode === 'TIERED' && input.tiers?.length) {
    await db.insert(servicePrices).values(
      input.tiers.map((tier, index) => ({
        serviceId,
        minQuantity: String(tier.minQuantity),
        maxQuantity: tier.maxQuantity === undefined || tier.maxQuantity === null ? null : String(tier.maxQuantity),
        unitPriceCents: tier.unitPriceCents,
        flatFeeCents: tier.flatFeeCents,
        sortOrder: index,
      })),
    );
  }

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'service.updated',
    entityType: 'service',
    entityId: serviceId,
    meta: { name: updated.name },
  });

  return { ok: true as const, service: updated };
}

/** Usługę deaktywujemy, a nie kasujemy — dokumenty historyczne muszą zostać spójne. */
export async function deactivateService(ctx: ServiceContext, serviceId: string) {
  const rows = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.organizationId, ctx.organizationId)))
    .limit(1);
  if (rows.length === 0) return { ok: false as const, error: 'Nie znaleziono usługi.' };

  await db.update(services).set({ isActive: false, updatedAt: new Date() }).where(eq(services.id, serviceId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'service.deactivated',
    entityType: 'service',
    entityId: serviceId,
    meta: { name: rows[0].name },
  });

  return { ok: true as const };
}

export async function listServicesAdmin(organizationId: string) {
  return db.select().from(services).where(eq(services.organizationId, organizationId)).orderBy(asc(services.sortOrder), asc(services.name));
}
