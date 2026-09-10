'use server';

import { revalidatePath } from 'next/cache';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { createCrew, deleteCrew, setCrewMembers } from '@/lib/services/crews';

export async function createCrewAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:assign');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const result = await createCrew(ctx, {
    name: String(formData.get('name') ?? ''),
    color: String(formData.get('color') ?? '#337dff'),
    description: String(formData.get('description') ?? ''),
  });

  if (!result.ok) {
    revalidatePath('/ekipy');
    return;
  }
  revalidatePath('/ekipy');
}

export async function setCrewMembersAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:assign');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const crewId = String(formData.get('crewId') ?? '');
  await setCrewMembers(
    ctx,
    crewId,
    formData.getAll('memberIds').map(String).filter(Boolean),
  );
  revalidatePath('/ekipy');
}

export async function deleteCrewAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('job:assign');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  await deleteCrew(ctx, String(formData.get('crewId') ?? ''));
  revalidatePath('/ekipy');
}
