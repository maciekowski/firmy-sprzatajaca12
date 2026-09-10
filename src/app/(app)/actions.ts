'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { notifications } from '@/lib/db/schema';
import { requireOrgContext } from '@/lib/auth/guards';

export async function markAllNotificationsReadAction(): Promise<void> {
  const context = await requireOrgContext();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.organizationId, context.organization.id),
        isNull(notifications.readAt),
        or(eq(notifications.userId, context.user.id), isNull(notifications.userId)),
      ),
    );
  revalidatePath('/powiadomienia');
  revalidatePath('/dashboard');
}

export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  // zakres organizacji — zabezpieczenie przed IDOR
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.organizationId, context.organization.id)));
  revalidatePath('/powiadomienia');
}
