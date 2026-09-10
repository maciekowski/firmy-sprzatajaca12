import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrgContext } from '@/lib/auth/guards';
import { previewPricing } from '@/lib/services/estimates';
import { services, servicePrices } from '@/lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';

/**
 * Podgląd wyliczenia — używany przez kreator wycen do podglądu na żywo.
 * Liczone TYM SAMYM silnikiem cenowym, który zapisuje dokument (brak osobnych reguł w UI).
 */

const lineSchema = z.object({
  serviceId: z.string().nullish(),
  addonId: z.string().nullish(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  quantity: z.coerce.number().min(0).max(1_000_000),
  unit: z.string().min(1).max(20),
  unitPriceCents: z.coerce.number().min(0).max(10_000_000),
  taxRateBps: z.coerce.number().min(0).max(10_000),
  discountBps: z.coerce.number().min(0).max(10_000).optional(),
  isCustom: z.boolean().optional(),
});

const bodySchema = z.object({
  customerId: z.string().optional(),
  lines: z.array(lineSchema).max(100),
  discountBps: z.coerce.number().min(0).max(10_000).optional(),
  discountCents: z.coerce.number().min(0).max(100_000_000).optional(),
  travelFeeType: z.enum(['NONE', 'FLAT', 'PER_KM']).optional(),
  travelFlatFeeCents: z.coerce.number().min(0).max(10_000_000).optional(),
  travelPerKmCents: z.coerce.number().min(0).max(10_000_000).optional(),
  travelDistanceKm: z.coerce.number().min(0).max(10_000).nullish(),
  isUrgent: z.boolean().optional(),
});

export async function POST(request: Request) {
  const context = await getOrgContext();
  if (!context) return NextResponse.json({ error: 'Wymagane zalogowanie.' }, { status: 401 });
  if (!context.can('estimate:read')) return NextResponse.json({ error: 'Brak uprawnień.' }, { status: 403 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane wyceny.', issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }

  // usługi weryfikujemy po organizacji — nie ufamy identyfikatorom z przeglądarki
  const orgServices = await db
    .select()
    .from(services)
    .where(and(eq(services.organizationId, context.organization.id), eq(services.isActive, true)))
    .orderBy(asc(services.sortOrder), asc(services.name));

  const allowedServiceIds = new Set(orgServices.map((service) => service.id));
  const lines = parsed.data.lines
    .filter((line) => !line.serviceId || allowedServiceIds.has(line.serviceId))
    .map((line) => ({
      serviceId: line.serviceId ?? null,
      addonId: line.addonId ?? null,
      name: line.name,
      description: line.description ?? null,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      taxRateBps: line.taxRateBps,
      discountBps: line.discountBps ?? 0,
      isCustom: line.isCustom ?? !line.serviceId,
    }));

  if (lines.length === 0) {
    return NextResponse.json({
      subtotalCents: 0,
      discountCents: 0,
      travelCents: 0,
      urgencyFeeCents: 0,
      taxCents: 0,
      totalCents: 0,
      lines: [],
      warnings: ['Brak pozycji.'],
    });
  }

  const result = await previewPricing(context.organization.id, {
    customerId: parsed.data.customerId ?? '',
    lines,
    discountBps: parsed.data.discountBps ?? 0,
    discountCents: parsed.data.discountCents ?? 0,
    travelFeeType: parsed.data.travelFeeType,
    travelFlatFeeCents: parsed.data.travelFlatFeeCents,
    travelPerKmCents: parsed.data.travelPerKmCents,
    travelDistanceKm: parsed.data.travelDistanceKm ?? null,
    isUrgent: parsed.data.isUrgent ?? false,
  });

  return NextResponse.json({
    subtotalCents: result.subtotalCents,
    discountCents: result.discountCents,
    travelCents: result.travelCents,
    urgencyFeeCents: result.urgencyFeeCents,
    minimumAdjustmentCents: result.minimumAdjustmentCents,
    extrasNetCents: result.extrasNetCents,
    taxCents: result.taxCents,
    totalCents: result.totalCents,
    warnings: result.warnings,
    lines: result.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      netCents: line.netCents,
      discountCents: line.discountCents,
      taxRateBps: line.taxRateBps,
      taxCents: line.taxCents,
      grossCents: line.grossCents,
      pricingSource: line.pricingSource,
      minPriceApplied: line.minPriceApplied,
    })),
  });
}
