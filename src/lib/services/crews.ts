import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { crewMembers, crews, memberships } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';

export type ServiceContext = { organizationId: string; userId: string; userName: string };

export async function createCrew(
  ctx: ServiceContext,
  input: { name: string; color?: string; description?: string | null },
): Promise<{ ok: true; crewId: string } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Podaj nazwę ekipy.' };

  const [crew] = await db
    .insert(crews)
    .values({
      organizationId: ctx.organizationId,
      name,
      color: input.color || '#337dff',
      description: input.description?.trim() || null,
    })
    .returning();

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'crew.created',
    entityType: 'crew',
    entityId: crew.id,
    meta: { name },
  });

  return { ok: true, crewId: crew.id };
}

export async function setCrewMembers(
  ctx: ServiceContext,
  crewId: string,
  userIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db
    .select()
    .from(crews)
    .where(and(eq(crews.id, crewId), eq(crews.organizationId, ctx.organizationId)))
    .limit(1);
  if (rows.length === 0) return { ok: false, error: 'Nie znaleziono ekipy.' };

  // tylko pracownicy tej firmy — obce identyfikatory są odrzucane
  const members = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.organizationId, ctx.organizationId));
  const allowed = new Set(members.map((member) => member.userId));
  const valid = userIds.filter((userId) => allowed.has(userId));

  await db.delete(crewMembers).where(eq(crewMembers.crewId, crewId));
  if (valid.length > 0) {
    await db.insert(crewMembers).values(
      valid.map((userId, index) => ({ crewId, userId, isLeader: index === 0 })),
    );
  }

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'crew.members_updated',
    entityType: 'crew',
    entityId: crewId,
    meta: { userIds: valid },
  });

  return { ok: true };
}

export async function deleteCrew(ctx: ServiceContext, crewId: string): Promise<{ ok: boolean; error?: string }> {
  const rows = await db
    .select()
    .from(crews)
    .where(and(eq(crews.id, crewId), eq(crews.organizationId, ctx.organizationId)))
    .limit(1);
  if (rows.length === 0) return { ok: false, error: 'Nie znaleziono ekipy.' };

  await db.delete(crewMembers).where(eq(crewMembers.crewId, crewId));
  await db.delete(crews).where(eq(crews.id, crewId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'crew.deleted',
    entityType: 'crew',
    entityId: crewId,
    meta: { name: rows[0].name },
  });

  return { ok: true };
}

export async function listCrewsWithMembers(organizationId: string) {
  const rows = await db.select().from(crews).where(eq(crews.organizationId, organizationId)).orderBy(asc(crews.name));
  const members = await db
    .select({ crewId: crewMembers.crewId, userId: crewMembers.userId, isLeader: crewMembers.isLeader })
    .from(crewMembers)
    .innerJoin(crews, eq(crews.id, crewMembers.crewId))
    .where(eq(crews.organizationId, organizationId));

  return rows.map((crew) => ({
    ...crew,
    memberIds: members.filter((member) => member.crewId === crew.id).map((member) => member.userId),
  }));
}
