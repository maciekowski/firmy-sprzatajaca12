/**
 * Audit log i aktywność — zapis zdarzeń istotnych dla bezpieczeństwa i historii.
 *
 * Zasada: do logów NIE trafiają dane wrażliwe (hasła, tokeny, pełne treści
 * wiadomości) — zapisujemy identyfikatory, typy zdarzeń i krótkie opisy.
 */
import { db } from '@/lib/db/client';
import { activities, auditLogs } from '@/lib/db/schema';

type AuditInput = {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
};

export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      organizationId: input.organizationId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      meta: input.meta ?? null,
    });
  } catch (error) {
    // Log audytowy nie może zablokować operacji biznesowej — ale błąd zgłaszamy dalej.
    console.error('[audit] nie udało się zapisać logu:', error instanceof Error ? error.message : error);
  }
}

export async function writeActivity(input: {
  organizationId: string;
  entityType: string;
  entityId: string;
  type: string;
  message: string;
  userId?: string | null;
  userName?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(activities).values({
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      type: input.type,
      message: input.message,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      meta: input.meta ?? null,
    });
  } catch (error) {
    console.error('[activity] nie udało się zapisać aktywności:', error instanceof Error ? error.message : error);
  }
}
