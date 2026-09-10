import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { notifications, type Notification } from '@/lib/db/schema';

/** Liczba nieprzeczytanych powiadomień (dla użytkownika + ogólne organizacji). */
export async function getUnreadNotifications(organizationId: string, userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        isNull(notifications.readAt),
        or(eq(notifications.userId, userId), isNull(notifications.userId)),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

export async function listNotifications(organizationId: string, userId: string, limit = 30): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        or(eq(notifications.userId, userId), isNull(notifications.userId)),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}
