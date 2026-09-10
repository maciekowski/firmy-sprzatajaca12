import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { automationRuns, automations, type Automation } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';

export type ServiceContext = { organizationId: string; userId: string; userName: string };

export type AutomationInput = {
  name: string;
  trigger: string;
  action: string;
  delayMinutes?: number;
  conditions?: { onlyIfUnaccepted?: boolean; minValueCents?: number };
  actionConfig?: {
    subject?: string;
    body?: string;
    status?: string;
    message?: string;
    channel?: string;
    templateKey?: string;
    title?: string;
    followUpDays?: number;
  } | null;
  isActive?: boolean;
};

export async function listAutomations(organizationId: string) {
  return db.select().from(automations).where(eq(automations.organizationId, organizationId)).orderBy(desc(automations.createdAt));
}

export async function listAutomationRuns(organizationId: string, limit = 50) {
  return db
    .select({
      run: automationRuns,
      automationName: automations.name,
      trigger: automations.trigger,
      action: automations.action,
    })
    .from(automationRuns)
    .innerJoin(automations, eq(automations.id, automationRuns.automationId))
    .where(eq(automationRuns.organizationId, organizationId))
    .orderBy(desc(automationRuns.createdAt))
    .limit(limit);
}

export async function getAutomation(organizationId: string, automationId: string) {
  const rows = await db
    .select()
    .from(automations)
    .where(and(eq(automations.id, automationId), eq(automations.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAutomation(
  ctx: ServiceContext,
  input: AutomationInput,
): Promise<{ ok: true; automation: Automation } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Podaj nazwę automatyzacji.' };
  if (input.delayMinutes !== undefined && (input.delayMinutes < 0 || input.delayMinutes > 60 * 24 * 60)) {
    return { ok: false, error: 'Opóźnienie musi być między 0 a 60 dniem.' };
  }

  const [automation] = await db
    .insert(automations)
    .values({
      organizationId: ctx.organizationId,
      name,
      trigger: input.trigger as never,
      action: input.action as never,
      delayMinutes: input.delayMinutes ?? 0,
      conditions: input.conditions ?? {},
      actionConfig: input.actionConfig ?? undefined,
      isActive: input.isActive ?? true,
    })
    .returning();

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'automation.created',
    entityType: 'automation',
    entityId: automation.id,
    meta: { name, trigger: input.trigger, action: input.action, delayMinutes: automation.delayMinutes },
  });

  return { ok: true, automation };
}

export async function updateAutomation(
  ctx: ServiceContext,
  automationId: string,
  input: Partial<AutomationInput> & { name?: string },
): Promise<{ ok: true; automation: Automation } | { ok: false; error: string }> {
  const current = await getAutomation(ctx.organizationId, automationId);
  if (!current) return { ok: false, error: 'Nie znaleziono automatyzacji.' };

  const [automation] = await db
    .update(automations)
    .set({
      name: input.name?.trim() || current.name,
      trigger: (input.trigger ?? current.trigger) as never,
      action: (input.action ?? current.action) as never,
      delayMinutes: input.delayMinutes ?? current.delayMinutes,
      conditions: input.conditions ?? current.conditions,
      actionConfig: input.actionConfig ?? current.actionConfig ?? undefined,
      isActive: input.isActive ?? current.isActive,
      updatedAt: new Date(),
    })
    .where(eq(automations.id, automationId))
    .returning();

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'automation.updated',
    entityType: 'automation',
    entityId: automationId,
    meta: { isActive: automation.isActive },
  });

  return { ok: true, automation };
}

export async function toggleAutomation(ctx: ServiceContext, automationId: string, isActive: boolean) {
  const current = await getAutomation(ctx.organizationId, automationId);
  if (!current) return { ok: false as const, error: 'Nie znaleziono automatyzacji.' };

  await db.update(automations).set({ isActive, updatedAt: new Date() }).where(eq(automations.id, automationId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: isActive ? 'automation.enabled' : 'automation.disabled',
    entityType: 'automation',
    entityId: automationId,
  });

  return { ok: true as const };
}

export async function deleteAutomation(ctx: ServiceContext, automationId: string) {
  const current = await getAutomation(ctx.organizationId, automationId);
  if (!current) return { ok: false as const, error: 'Nie znaleziono automatyzacji.' };

  await db.delete(automations).where(eq(automations.id, automationId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'automation.deleted',
    entityType: 'automation',
    entityId: automationId,
    meta: { name: current.name },
  });

  return { ok: true as const };
}
