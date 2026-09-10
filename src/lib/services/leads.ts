import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { activities, customers, leads, users, type Lead } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';

export type ServiceContext = { organizationId: string; userId: string; userName: string };

export type LeadDraft = {
  title: string;
  description?: string | null;
  source?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  serviceId?: string | null;
  assignedToId?: string | null;
  estimatedValueCents?: number | null;
  followUpAt?: Date | null;
};

export const LEAD_STATUS_ORDER = ['NEW', 'CONTACTED', 'QUALIFIED', 'ESTIMATE', 'QUOTE_SENT', 'FOLLOW_UP', 'WON', 'LOST'] as const;

function buildLeadFilters(organizationId: string, options: { status?: string; search?: string } = {}) {
  const filters: SQL[] = [eq(leads.organizationId, organizationId)];
  if (options.status && options.status !== 'ALL') filters.push(eq(leads.status, options.status as never));
  if (options.search) {
    const term = `%${options.search}%`;
    filters.push(
      sql`(${leads.title} ilike ${term} or coalesce(${leads.contactName}, '') ilike ${term} or coalesce(${leads.contactEmail}, '') ilike ${term} or coalesce(${leads.contactPhone}, '') ilike ${term})`,
    );
  }
  return filters;
}

export async function listLeads(
  organizationId: string,
  options: { status?: string; search?: string; limit?: number; offset?: number } = {},
) {
  const filters = buildLeadFilters(organizationId, options);

  return db
    .select({
      lead: leads,
      assignedName: users.name,
      serviceName: (sql`(select name from services s where s.id = ${leads.serviceId})`).as('service_name'),
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedToId))
    .where(and(...filters))
    .orderBy(desc(leads.createdAt))
    .limit(options.limit ?? 100)
    .offset(options.offset ?? 0);
}

/** Liczba leadów dla zadanych filtrów — potrzebna do paginacji. */
export async function countLeads(organizationId: string, options: { status?: string; search?: string } = {}): Promise<number> {
  const filters = buildLeadFilters(organizationId, options);
  const [{ value }] = await db.select({ value: sql<number>`count(*)::int` }).from(leads).where(and(...filters));
  return Number(value ?? 0);
}

export async function getLead(organizationId: string, leadId: string) {
  const rows = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId))).limit(1);
  return rows[0] ?? null;
}

export async function createLead(ctx: ServiceContext, draft: LeadDraft): Promise<{ ok: true; lead: Lead } | { ok: false; error: string }> {
  const title = draft.title.trim();
  if (!title) return { ok: false, error: 'Podaj tytuł leada.' };

  const [lead] = await db
    .insert(leads)
    .values({
      organizationId: ctx.organizationId,
      title,
      description: draft.description?.trim() || null,
      source: (draft.source ?? 'MANUAL') as never,
      contactName: draft.contactName?.trim() || null,
      contactPhone: draft.contactPhone?.trim() || null,
      contactEmail: draft.contactEmail?.trim() || null,
      street: draft.street?.trim() || null,
      city: draft.city?.trim() || null,
      postalCode: draft.postalCode?.trim() || null,
      serviceId: draft.serviceId ?? null,
      assignedToId: draft.assignedToId ?? null,
      estimatedValueCents: draft.estimatedValueCents ?? null,
      followUpAt: draft.followUpAt ?? null,
    })
    .returning();

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'lead',
    entityId: lead.id,
    type: 'created',
    message: 'Utworzono leada',
    userId: ctx.userId,
    userName: ctx.userName,
  });

  return { ok: true, lead };
}

export async function updateLead(ctx: ServiceContext, leadId: string, draft: LeadDraft): Promise<{ ok: true; lead: Lead } | { ok: false; error: string }> {
  const current = await getLead(ctx.organizationId, leadId);
  if (!current) return { ok: false, error: 'Nie znaleziono leada.' };
  if (!draft.title?.trim()) return { ok: false, error: 'Podaj tytuł leada.' };

  const [lead] = await db
    .update(leads)
    .set({
      title: draft.title.trim(),
      description: draft.description?.trim() || null,
      source: (draft.source ?? current.source) as never,
      contactName: draft.contactName?.trim() || null,
      contactPhone: draft.contactPhone?.trim() || null,
      contactEmail: draft.contactEmail?.trim() || null,
      street: draft.street?.trim() || null,
      city: draft.city?.trim() || null,
      postalCode: draft.postalCode?.trim() || null,
      serviceId: draft.serviceId ?? null,
      assignedToId: draft.assignedToId ?? null,
      estimatedValueCents: draft.estimatedValueCents ?? null,
      followUpAt: draft.followUpAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId))
    .returning();

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'lead',
    entityId: leadId,
    type: 'updated',
    message: 'Zaktualizowano leada',
    userId: ctx.userId,
    userName: ctx.userName,
  });

  return { ok: true, lead };
}

export async function changeLeadStatus(
  ctx: ServiceContext,
  leadId: string,
  status: Lead['status'],
  note?: string | null,
): Promise<{ ok: true; lead: Lead } | { ok: false; error: string }> {
  const current = await getLead(ctx.organizationId, leadId);
  if (!current) return { ok: false, error: 'Nie znaleziono leada.' };

  const patch: Partial<typeof leads.$inferInsert> = { status, updatedAt: new Date() };
  if (status === 'LOST') patch.lostReason = note ?? null;
  if (status === 'WON') patch.convertedAt = new Date();

  const [lead] = await db.update(leads).set(patch).where(eq(leads.id, leadId)).returning();

  await db.insert(activities).values({
    organizationId: ctx.organizationId,
    entityType: 'lead',
    entityId: leadId,
    type: 'status_changed',
    message: `Zmieniono status leada na ${status}`,
    userId: ctx.userId,
    userName: ctx.userName,
    meta: { from: current.status, to: status, note: note ?? null },
  });

  return { ok: true, lead };
}

/**
 * Konwersja leada do klienta. Tworzy PRAWDZIWEGO klienta na podstawie danych leada
 * i wiąże go z leadem (convertedCustomerId). Operacja jest w transakcji.
 */
export async function convertLeadToCustomer(
  ctx: ServiceContext,
  leadId: string,
): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  const lead = await getLead(ctx.organizationId, leadId);
  if (!lead) return { ok: false, error: 'Nie znaleziono leada.' };
  if (lead.convertedCustomerId) {
    return { ok: false, error: 'Lead został już przekonwertowany do klienta.' };
  }
  if (!lead.contactName?.trim()) {
    return { ok: false, error: 'Podaj nazwę kontaktu, żeby utworzyć klienta.' };
  }

  const result = await db.transaction(async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId: ctx.organizationId,
        displayName: lead.contactName!.trim(),
        email: lead.contactEmail ?? null,
        phone: lead.contactPhone ?? null,
        street: lead.street ?? null,
        city: lead.city ?? null,
        postalCode: lead.postalCode ?? null,
        source: lead.source,
        notes: lead.description ?? null,
      })
      .returning();

    await tx
      .update(leads)
      .set({ convertedCustomerId: customer.id, customerId: customer.id, status: 'WON', convertedAt: new Date(), updatedAt: new Date() })
      .where(eq(leads.id, leadId));

    await tx.insert(activities).values({
      organizationId: ctx.organizationId,
      entityType: 'lead',
      entityId: leadId,
      type: 'converted',
      message: `Lead przekonwertowany do klienta: ${customer.displayName}`,
      userId: ctx.userId,
      userName: ctx.userName,
      meta: { customerId: customer.id },
    });

    return customer.id;
  });

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'lead.converted',
    entityType: 'lead',
    entityId: leadId,
    meta: { customerId: result },
  });

  return { ok: true, customerId: result };
}

export async function deleteLead(ctx: ServiceContext, leadId: string): Promise<{ ok: boolean; error?: string }> {
  const current = await getLead(ctx.organizationId, leadId);
  if (!current) return { ok: false, error: 'Nie znaleziono leada.' };
  await db.delete(leads).where(eq(leads.id, leadId));
  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'lead.deleted',
    entityType: 'lead',
    entityId: leadId,
    meta: { title: current.title },
  });
  return { ok: true };
}

export async function listLeadActivities(leadId: string) {
  return db
    .select()
    .from(activities)
    .where(and(eq(activities.entityType, 'lead'), eq(activities.entityId, leadId)))
    .orderBy(asc(activities.createdAt));
}

export async function getLeadSummary(organizationId: string) {
  const rows = await db
    .select({ status: leads.status, count: sql<string>`count(*)::text`, value: sql<string>`coalesce(sum(${leads.estimatedValueCents}), 0)::text` })
    .from(leads)
    .where(eq(leads.organizationId, organizationId))
    .groupBy(leads.status);

  return rows.map((row) => ({ status: row.status, count: Number(row.count), valueCents: Number(row.value) }));
}
