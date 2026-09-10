/**
 * Idempotencja webhooków.
 *
 * Provider (Stripe / Resend / KSeF) może wysłać to samo zdarzenie wielokrotnie.
 * Zapisujemy zdarzenie z unikalnym identyfikatorem i wykonujemy operację tylko raz.
 */
import { db } from '@/lib/db/client';
import { webhookEvents } from '@/lib/db/schema';

export type WebhookProvider = 'STRIPE' | 'RESEND' | 'KSEF' | 'OTHER';

export type ClaimResult =
  | { claimed: true; eventId: string }
  | { claimed: false; eventId: string; reason: string };

export async function claimWebhookEvent(input: {
  provider: WebhookProvider;
  externalId: string;
  type: string;
  organizationId?: string | null;
  payload: Record<string, unknown>;
  signatureValid: boolean;
}): Promise<ClaimResult> {
  try {
    const [row] = await db
      .insert(webhookEvents)
      .values({
        provider: input.provider,
        externalId: input.externalId,
        type: input.type,
        organizationId: input.organizationId ?? null,
        payload: input.payload,
        signatureValid: input.signatureValid,
        processedAt: new Date(),
      })
      .returning();

    return { claimed: true, eventId: row.id };
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return { claimed: false, eventId: '', reason: 'Zdarzenie zostało już przetworzone (duplikat).' };
    }
    throw error;
  }
}

export async function markWebhookError(externalId: string, provider: WebhookProvider, error: string): Promise<void> {
  const { eq, and } = await import('drizzle-orm');
  await db
    .update(webhookEvents)
    .set({ error, processedAt: new Date() })
    .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.externalId, externalId)));
}
