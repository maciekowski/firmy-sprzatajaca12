/**
 * Usługi domenowe: wyceny i oferty.
 *
 * To jedyne miejsce, w którym zapisywane są wyliczone kwoty.
 * Wszystkie obliczenia delegujemy do silnika cenowego (@/lib/pricing/engine).
 */
import { and, asc, eq, sql} from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  activities,
  customers,
  customerAddresses,
  estimates,
  estimateItems,
  organizations,
  quotes,
  quoteItems,
  quoteEvents,
  services,
  servicePrices,
  type Estimate,
  type EstimateItem,
  type Quote,
} from '@/lib/db/schema';
import { computeDocumentPricing, type PricingLineInput } from '@/lib/pricing/engine';
import { nextDocumentNumber } from '@/lib/numbering';
import { newId } from '@/lib/db/schema';

export type ServiceContext = {
  organizationId: string;
  userId: string;
  userName: string;
};

export type LineDraft = {
  serviceId?: string | null;
  addonId?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  unitPriceCents: number;
  unit: string;
  customUnitLabel?: string | null;
  taxRateBps: number;
  discountBps?: number;
  isCustom?: boolean;
};

export type DocumentDraft = {
  customerId: string;
  addressId?: string | null;
  lines: LineDraft[];
  discountBps?: number;
  discountCents?: number;
  travelFeeType?: 'NONE' | 'FLAT' | 'PER_KM';
  travelFlatFeeCents?: number;
  travelPerKmCents?: number;
  travelDistanceKm?: number | null;
  isUrgent?: boolean;
  notes?: string | null;
  terms?: string | null;
  internalNotes?: string | null;
  validUntil?: Date | null;
  leadId?: string | null;
};

/** Pobiera progi cenowe dla usług użytych w dokumencie. */
async function loadTiers(organizationId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return new Map<string, { minQuantity: string; maxQuantity: string | null; unitPriceCents: number; flatFeeCents: number }[]>();
  const rows = await db
    .select()
    .from(servicePrices)
    .innerJoin(services, eq(services.id, servicePrices.serviceId))
    .where(eq(services.organizationId, organizationId));

  const map = new Map<string, { minQuantity: string; maxQuantity: string | null; unitPriceCents: number; flatFeeCents: number }[]>();
  for (const row of rows) {
    if (!serviceIds.includes(row.service_prices.serviceId)) continue;
    const list = map.get(row.service_prices.serviceId) ?? [];
    list.push({
      minQuantity: row.service_prices.minQuantity,
      maxQuantity: row.service_prices.maxQuantity,
      unitPriceCents: row.service_prices.unitPriceCents,
      flatFeeCents: row.service_prices.flatFeeCents,
    });
    map.set(row.service_prices.serviceId, list);
  }
  return map;
}

/** Buduje dane wejściowe silnika cenowego na podstawie konfiguracji usług i organizacji. */
export async function buildPricingInput(
  organizationId: string,
  draft: DocumentDraft,
): Promise<{ input: Parameters<typeof computeDocumentPricing>[0]; currency: string }> {
  const orgRows = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const organization = orgRows[0];
  const defaultTaxRateBps = organization?.taxRateBps ?? 2300;

  const serviceIds = draft.lines.map((line) => line.serviceId).filter((id): id is string => Boolean(id));
  const serviceRows = serviceIds.length
    ? await db.select().from(services).where(and(eq(services.organizationId, organizationId)))
    : [];
  const serviceById = new Map(serviceRows.map((service) => [service.id, service]));
  const tiers = await loadTiers(organizationId, serviceIds);

  const lines: PricingLineInput[] = draft.lines.map((line) => {
    const service = line.serviceId ? serviceById.get(line.serviceId) : undefined;
    return {
      serviceId: line.serviceId ?? null,
      addonId: line.addonId ?? null,
      name: line.name,
      description: line.description ?? null,
      unit: line.unit,
      customUnitLabel: line.customUnitLabel ?? null,
      quantity: line.quantity,
      pricingMode: (service?.pricingMode as PricingLineInput['pricingMode']) ?? (line.serviceId ? 'PER_UNIT' : 'PER_UNIT'),
      basePriceCents: service?.basePriceCents ?? line.unitPriceCents,
      hourlyRateCents: service?.hourlyRateCents ?? null,
      minPriceCents: service?.minPriceCents ?? 0,
      taxRateBps: line.taxRateBps ?? service?.taxRateBps ?? defaultTaxRateBps,
      unitPriceCents: line.unitPriceCents,
      discountBps: line.discountBps ?? 0,
      tiers: line.serviceId ? tiers.get(line.serviceId) ?? [] : [],
      isCustom: line.isCustom ?? !line.serviceId,
    };
  });

  return {
    input: {
      lines,
      discountBps: draft.discountBps ?? 0,
      discountCents: draft.discountCents ?? 0,
      travelFeeType: draft.travelFeeType ?? ((organization?.travelFeeType as 'NONE' | 'FLAT' | 'PER_KM') ?? 'NONE'),
      travelFlatFeeCents: draft.travelFlatFeeCents ?? organization?.travelFlatFeeCents ?? 0,
      travelPerKmCents: draft.travelPerKmCents ?? organization?.travelPerKmCents ?? 0,
      travelDistanceKm: draft.travelDistanceKm ?? null,
      urgencySurchargeBps: organization?.urgencySurchargeBps ?? 0,
      isUrgent: draft.isUrgent ?? false,
      minJobValueCents: organization?.minJobValueCents ?? 0,
      defaultTaxRateBps,
    } as Parameters<typeof computeDocumentPricing>[0],
    currency: organization?.currency ?? 'PLN',
  };
}

/** Podgląd wyliczenia bez zapisu (używany w kreatorze wycen). */
export async function previewPricing(organizationId: string, draft: DocumentDraft) {
  const { input } = await buildPricingInput(organizationId, draft);
  return computeDocumentPricing(input);
}

export async function listEstimates(organizationId: string, limit = 100, offset = 0) {
  return db
    .select({ estimate: estimates, customerName: customers.displayName })
    .from(estimates)
    .innerJoin(customers, eq(customers.id, estimates.customerId))
    .where(eq(estimates.organizationId, organizationId))
    .orderBy(asc(estimates.createdAt))
    .limit(limit)
    .offset(offset)
    .then((rows) => rows.map((row) => ({ ...row.estimate, customerName: row.customerName })));
}

/** Liczba wycen organizacji — potrzebna do paginacji. */
export async function countEstimates(organizationId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(estimates)
    .where(eq(estimates.organizationId, organizationId));
  return Number(value ?? 0);
}

export async function getEstimate(organizationId: string, estimateId: string) {
  const rows = await db
    .select()
    .from(estimates)
    .where(and(eq(estimates.id, estimateId), eq(estimates.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getEstimateItems(estimateId: string): Promise<EstimateItem[]> {
  return db.select().from(estimateItems).where(eq(estimateItems.estimateId, estimateId)).orderBy(asc(estimateItems.sortOrder));
}

export async function createEstimate(ctx: ServiceContext, draft: DocumentDraft): Promise<Estimate> {
  const orgRows = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const organization = orgRows[0];
  const organizationCurrency = organization?.currency ?? 'PLN';
  const { input } = await buildPricingInput(ctx.organizationId, draft);
  const result = computeDocumentPricing(input);

  const number = await nextDocumentNumber(ctx.organizationId, organization?.estimatePrefix ?? 'WY');
  const address = draft.addressId
    ? await db.select().from(customerAddresses).where(eq(customerAddresses.id, draft.addressId)).limit(1)
    : [];

  const [estimate] = await db
    .insert(estimates)
    .values({
      organizationId: ctx.organizationId,
      number,
      customerId: draft.customerId,
      addressId: draft.addressId ?? null,
      leadId: draft.leadId ?? null,
      status: 'DRAFT',
      currency: organizationCurrency,
      addressLabel: address[0]?.label ?? null,
      addressStreet: address[0]?.street ?? null,
      addressCity: address[0]?.city ?? null,
      addressPostalCode: address[0]?.postalCode ?? null,
      subtotalCents: result.subtotalCents,
      discountCents: result.discountCents,
      discountBps: draft.discountBps ?? 0,
      travelCents: result.travelCents,
      travelDistanceKm: draft.travelDistanceKm != null ? String(draft.travelDistanceKm) : null,
      urgencyFeeCents: result.urgencyFeeCents,
      taxCents: result.taxCents,
      totalCents: result.totalCents,
      validUntil: draft.validUntil ?? null,
      notes: draft.notes ?? null,
      terms: draft.terms ?? null,
      internalNotes: draft.internalNotes ?? null,
      createdById: ctx.userId,
    })
    .returning();

  await db.insert(estimateItems).values(
    result.lines.map((line, index) => ({
      estimateId: estimate.id,
      serviceId: line.serviceId,
      addonId: line.addonId,
      name: line.name,
      description: line.description,
      unit: line.unit as never,
      customUnitLabel: line.customUnitLabel,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      taxRateBps: line.taxRateBps,
      discountCents: line.discountCents,
      discountBps: line.discountBps,
      netCents: line.netCents,
      taxCents: line.taxCents,
      grossCents: line.grossCents,
      isCustom: line.isCustom,
      sortOrder: index,
    })),
  );

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'estimate',
    entityId: estimate.id,
    type: 'created',
    message: `Utworzono wycenę ${number}`,
    userId: ctx.userId,
    userName: ctx.userName,
  });

  return estimate;
}

export async function updateEstimate(ctx: ServiceContext, estimateId: string, draft: DocumentDraft): Promise<Estimate | null> {
  const existing = await getEstimate(ctx.organizationId, estimateId);
  if (!existing) return null;

  const { input } = await buildPricingInput(ctx.organizationId, draft);
  const result = computeDocumentPricing(input);

  const address = draft.addressId
    ? await db.select().from(customerAddresses).where(eq(customerAddresses.id, draft.addressId)).limit(1)
    : [];

  const [updated] = await db
    .update(estimates)
    .set({
      customerId: draft.customerId,
      addressId: draft.addressId ?? null,
      addressLabel: address[0]?.label ?? null,
      addressStreet: address[0]?.street ?? null,
      addressCity: address[0]?.city ?? null,
      addressPostalCode: address[0]?.postalCode ?? null,
      subtotalCents: result.subtotalCents,
      discountCents: result.discountCents,
      discountBps: draft.discountBps ?? 0,
      travelCents: result.travelCents,
      travelDistanceKm: draft.travelDistanceKm != null ? String(draft.travelDistanceKm) : null,
      urgencyFeeCents: result.urgencyFeeCents,
      taxCents: result.taxCents,
      totalCents: result.totalCents,
      validUntil: draft.validUntil ?? null,
      notes: draft.notes ?? null,
      terms: draft.terms ?? null,
      internalNotes: draft.internalNotes ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(estimates.id, estimateId), eq(estimates.organizationId, ctx.organizationId)))
    .returning();

  await db.delete(estimateItems).where(eq(estimateItems.estimateId, estimateId));
  await db.insert(estimateItems).values(
    result.lines.map((line, index) => ({
      estimateId,
      serviceId: line.serviceId,
      addonId: line.addonId,
      name: line.name,
      description: line.description,
      unit: line.unit as never,
      customUnitLabel: line.customUnitLabel,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      taxRateBps: line.taxRateBps,
      discountCents: line.discountCents,
      discountBps: line.discountBps,
      netCents: line.netCents,
      taxCents: line.taxCents,
      grossCents: line.grossCents,
      isCustom: line.isCustom,
      sortOrder: index,
    })),
  );

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'estimate',
    entityId: estimateId,
    type: 'updated',
    message: `Zaktualizowano wycenę ${updated?.number ?? ''}`,
    userId: ctx.userId,
    userName: ctx.userName,
  });

  return updated ?? null;
}

export async function deleteEstimate(ctx: ServiceContext, estimateId: string): Promise<boolean> {
  const existing = await getEstimate(ctx.organizationId, estimateId);
  if (!existing) return false;
  await db.delete(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.organizationId, ctx.organizationId)));
  return true;
}

/**
 * Tworzy ofertę na podstawie wyceny.
 * Ofertę można przygotować ponownie (kolejna wersja) — historia zostaje zachowana.
 */
export async function createQuoteFromEstimate(
  ctx: ServiceContext,
  estimateId: string,
  options: { validDays?: number; notes?: string | null; terms?: string | null } = {},
): Promise<Quote | null> {
  const estimate = await getEstimate(ctx.organizationId, estimateId);
  if (!estimate) return null;
  const items = await getEstimateItems(estimateId);

  const orgRows = await db.select().from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
  const organization = orgRows[0];

  const existingVersions = await db
    .select({ version: quotes.version })
    .from(quotes)
    .where(eq(quotes.estimateId, estimateId))
    .orderBy(asc(quotes.version));
  const nextVersion = (existingVersions.at(-1)?.version ?? 0) + 1;

  const number = await nextDocumentNumber(ctx.organizationId, organization?.quotePrefix ?? 'OF');
  const validUntil = new Date(Date.now() + (options.validDays ?? 14) * 24 * 60 * 60 * 1000);

  const [quote] = await db
    .insert(quotes)
    .values({
      organizationId: ctx.organizationId,
      number,
      version: nextVersion,
      estimateId,
      currency: estimate.currency,
      customerId: estimate.customerId,
      addressId: estimate.addressId,
      status: 'DRAFT',
      publicToken: newId('tok'),
      addressLabel: estimate.addressLabel,
      addressStreet: estimate.addressStreet,
      addressCity: estimate.addressCity,
      addressPostalCode: estimate.addressPostalCode,
      subtotalCents: estimate.subtotalCents,
      discountCents: estimate.discountCents,
      discountBps: estimate.discountBps,
      travelCents: estimate.travelCents,
      urgencyFeeCents: estimate.urgencyFeeCents,
      taxCents: estimate.taxCents,
      totalCents: estimate.totalCents,
      validUntil,
      notes: options.notes ?? estimate.notes,
      terms: options.terms ?? estimate.terms ?? organization?.quoteTerms ?? null,
      title: `Oferta ${number}`,
      createdById: ctx.userId,
    })
    .returning();

  await db.insert(quoteItems).values(
    items.map((item) => ({
      quoteId: quote.id,
      serviceId: item.serviceId,
      addonId: item.addonId,
      name: item.name,
      description: item.description,
      unit: item.unit,
      customUnitLabel: item.customUnitLabel,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      taxRateBps: item.taxRateBps,
      discountCents: item.discountCents,
      discountBps: item.discountBps,
      netCents: item.netCents,
      taxCents: item.taxCents,
      grossCents: item.grossCents,
      isCustom: item.isCustom,
      sortOrder: item.sortOrder,
    })),
  );

  await db.insert(quoteEvents).values({
    quoteId: quote.id,
    type: 'CREATED',
    message: `Utworzono ofertę (wersja ${nextVersion})`,
    actorName: ctx.userName,
  });

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'quote',
    entityId: quote.id,
    type: 'created',
    message: `Utworzono ofertę ${number}`,
    userId: ctx.userId,
    userName: ctx.userName,
  });

  return quote;
}

export async function getQuote(organizationId: string, quoteId: string) {
  const rows = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getQuoteByToken(token: string) {
  const rows = await db.select().from(quotes).where(eq(quotes.publicToken, token)).limit(1);
  return rows[0] ?? null;
}

export async function getQuoteItems(quoteId: string) {
  return db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId)).orderBy(asc(quoteItems.sortOrder));
}

export async function getQuoteEvents(quoteId: string) {
  return db.select().from(quoteEvents).where(eq(quoteEvents.quoteId, quoteId)).orderBy(asc(quoteEvents.createdAt));
}

function buildQuoteFilters(organizationId: string, options: { status?: string } = {}) {
  const filters = [eq(quotes.organizationId, organizationId)];
  if (options.status && options.status !== 'ALL') {
    filters.push(eq(quotes.status, options.status as never));
  }
  return filters;
}

export async function listQuotes(
  organizationId: string,
  options: { status?: string; limit?: number; offset?: number } = {},
) {
  const filters = buildQuoteFilters(organizationId, options);
  return db
    .select({ quote: quotes, customerName: customers.displayName })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(and(...filters))
    .orderBy(asc(quotes.createdAt))
    .limit(options.limit ?? 200)
    .offset(options.offset ?? 0)
    .then((rows) => rows.map((row) => ({ ...row.quote, customerName: row.customerName })));
}

/** Liczba ofert dla zadanych filtrów — potrzebna do paginacji. */
export async function countQuotes(organizationId: string, options: { status?: string } = {}): Promise<number> {
  const filters = buildQuoteFilters(organizationId, options);
  const [{ value }] = await db.select({ value: sql<number>`count(*)::int` }).from(quotes).where(and(...filters));
  return Number(value ?? 0);
}

/** Oznacza ofertę jako wyświetloną (portal klienta). */
export async function markQuoteViewed(quoteId: string): Promise<void> {
  const rows = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  const quote = rows[0];
  if (!quote || quote.viewedAt) return;

  await db
    .update(quotes)
    .set({ viewedAt: new Date(), status: quote.status === 'SENT' ? 'VIEWED' : quote.status, updatedAt: new Date() })
    .where(eq(quotes.id, quoteId));

  await db.insert(quoteEvents).values({
    quoteId,
    type: 'VIEWED',
    message: 'Klient otworzył ofertę',
    actorName: 'Klient',
  });
}
