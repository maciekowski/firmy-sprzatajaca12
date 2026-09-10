import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { serviceRequests, type ServiceRequest } from '@/lib/db/schema';
import { getAIProvider } from '@/lib/ai';
import type { ParsedRequest } from '@/lib/ai/types';
import { writeAuditLog } from '@/lib/audit';

export type ServiceContext = { organizationId: string; userId: string; userName: string };

export type RequestDraft = {
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  customerId?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  description: string;
  serviceId?: string | null;
  preferredDate?: string | null;
  preferredTimeFrom?: string | null;
  preferredTimeTo?: string | null;
  urgency?: 'LOW' | 'NORMAL' | 'HIGH';
  notes?: string | null;
  channel?: string;
};

function buildRequestFilters(organizationId: string, options: { status?: string; search?: string } = {}) {
  const filters: SQL[] = [eq(serviceRequests.organizationId, organizationId)];
  if (options.status && options.status !== 'ALL') filters.push(eq(serviceRequests.status, options.status as never));
  if (options.search) {
    const term = `%${options.search}%`;
    filters.push(
      sql`(${serviceRequests.description} ilike ${term} or coalesce(${serviceRequests.contactName}, '') ilike ${term} or coalesce(${serviceRequests.contactEmail}, '') ilike ${term})`,
    );
  }
  return filters;
}

export async function listRequests(
  organizationId: string,
  options: { status?: string; search?: string; limit?: number; offset?: number } = {},
) {
  const filters = buildRequestFilters(organizationId, options);
  return db
    .select()
    .from(serviceRequests)
    .where(and(...filters))
    .orderBy(desc(serviceRequests.createdAt))
    .limit(options.limit ?? 100)
    .offset(options.offset ?? 0);
}

/** Liczba zapytań dla zadanych filtrów — potrzebna do paginacji. */
export async function countRequests(
  organizationId: string,
  options: { status?: string; search?: string } = {},
): Promise<number> {
  const filters = buildRequestFilters(organizationId, options);
  const [{ value }] = await db.select({ value: sql<number>`count(*)::int` }).from(serviceRequests).where(and(...filters));
  return Number(value ?? 0);
}

export async function getRequest(organizationId: string, requestId: string) {
  const rows = await db
    .select()
    .from(serviceRequests)
    .where(and(eq(serviceRequests.id, requestId), eq(serviceRequests.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createRequest(
  ctx: ServiceContext,
  draft: RequestDraft,
): Promise<{ ok: true; request: ServiceRequest } | { ok: false; error: string }> {
  const description = draft.description.trim();
  if (!description) return { ok: false, error: 'Opis zapytania jest wymagany.' };

  const [request] = await db
    .insert(serviceRequests)
    .values({
      organizationId: ctx.organizationId,
      contactName: draft.contactName?.trim() || null,
      contactPhone: draft.contactPhone?.trim() || null,
      contactEmail: draft.contactEmail?.trim() || null,
      customerId: draft.customerId ?? null,
      street: draft.street?.trim() || null,
      city: draft.city?.trim() || null,
      postalCode: draft.postalCode?.trim() || null,
      description,
      serviceId: draft.serviceId ?? null,
      preferredDate: draft.preferredDate ?? null,
      preferredTimeFrom: draft.preferredTimeFrom ?? null,
      preferredTimeTo: draft.preferredTimeTo ?? null,
      urgency: (draft.urgency ?? 'NORMAL') as never,
      notes: draft.notes?.trim() || null,
      channel: (draft.channel ?? 'MANUAL') as never,
    })
    .returning();

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'request.created',
    entityType: 'request',
    entityId: request.id,
  });

  return { ok: true, request };
}

/**
 * Analiza zapytania przez dostawcę AI (opcjonalnie).
 *
 * Wynik jest ZAPISANY w rekordzie (aiParsed) — nie jest generowany na nowo przy
 * każdym odświeżeniu strony. AI nie liczy pieniędzy: wskazujemy tylko usługę
 * i ilość, a cenę policzy silnik cenowy na podstawie cennika.
 */
export async function analyzeRequest(
  ctx: ServiceContext,
  requestId: string,
  serviceNames: string[],
): Promise<{ ok: true; parsed: ParsedRequest } | { ok: false; error: string }> {
  const request = await getRequest(ctx.organizationId, requestId);
  if (!request) return { ok: false, error: 'Nie znaleziono zapytania.' };

  const provider = getAIProvider();
  const parsed = await provider.parseCustomerRequest({
    text: request.description,
    serviceNames,
    today: new Date(),
  });

  await db
    .update(serviceRequests)
    .set({
      aiParsed: parsed as unknown as Record<string, unknown>,
      aiStatus: parsed.status,
      aiProvider: provider.name,
      aiAnalyzedAt: new Date(),
      updatedAt: new Date(),
      // wynik analizy nie zmienia statusu zapytania — decyzję podejmuje człowiek
    })
    .where(eq(serviceRequests.id, requestId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'request.analyzed',
    entityType: 'request',
    entityId: requestId,
    meta: { provider: provider.name, status: parsed.status, items: parsed.items.length },
  });

  return { ok: true, parsed };
}

export async function updateRequestStatus(
  ctx: ServiceContext,
  requestId: string,
  status: ServiceRequest['status'],
): Promise<{ ok: boolean; error?: string }> {
  const request = await getRequest(ctx.organizationId, requestId);
  if (!request) return { ok: false, error: 'Nie znaleziono zapytania.' };

  await db.update(serviceRequests).set({ status, updatedAt: new Date() }).where(eq(serviceRequests.id, requestId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'request.status_changed',
    entityType: 'request',
    entityId: requestId,
    meta: { from: request.status, to: status },
  });

  return { ok: true };
}

export function parsedFromRequest(request: ServiceRequest): ParsedRequest | null {
  if (!request.aiParsed) return null;
  return request.aiParsed as unknown as ParsedRequest;
}
