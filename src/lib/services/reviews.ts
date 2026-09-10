import { and, desc, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db/client';
import { customers, jobs, reviewRequests, type ReviewRequest } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';

export type ServiceContext = { organizationId: string; userId: string; userName: string };

export async function listReviewRequests(organizationId: string) {
  return db
    .select({
      request: reviewRequests,
      customerName: customers.displayName,
      jobNumber: jobs.number,
    })
    .from(reviewRequests)
    .leftJoin(customers, eq(customers.id, reviewRequests.customerId))
    .leftJoin(jobs, eq(jobs.id, reviewRequests.jobId))
    .where(eq(reviewRequests.organizationId, organizationId))
    .orderBy(desc(reviewRequests.createdAt));
}

export async function getReviewRequestByToken(token: string) {
  const rows = await db.select().from(reviewRequests).where(eq(reviewRequests.token, token)).limit(1);
  return rows[0] ?? null;
}

/**
 * Tworzy prośbę o opinię dla klienta.
 * Zwrotny link zawiera losowy token (bez logowania) — numeracja/ID nie są sekretem.
 */
export async function createReviewRequest(
  ctx: ServiceContext,
  input: { customerId: string; jobId?: string | null; channel?: 'GOOGLE' | 'OWN_FORM' | 'OTHER'; externalUrl?: string | null },
): Promise<{ ok: true; request: ReviewRequest } | { ok: false; error: string }> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.organizationId, ctx.organizationId)))
    .limit(1);
  if (!customer) return { ok: false, error: 'Nie znaleziono klienta.' };

  if (input.jobId) {
    const [job] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, input.jobId), eq(jobs.organizationId, ctx.organizationId)))
      .limit(1);
    if (!job) return { ok: false, error: 'Nie znaleziono zlecenia.' };
  }

  const [request] = await db
    .insert(reviewRequests)
    .values({
      organizationId: ctx.organizationId,
      customerId: input.customerId,
      jobId: input.jobId ?? null,
      channel: (input.channel ?? 'OWN_FORM') as never,
      token: randomBytes(24).toString('base64url'),
      externalUrl: input.externalUrl ?? null,
      status: 'PENDING',
    })
    .returning();

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'review.request_created',
    entityType: 'review_request',
    entityId: request.id,
    meta: { customerId: input.customerId, jobId: input.jobId ?? null },
  });

  return { ok: true, request };
}

/** Klient ocenia realizację — zapis jest prawdziwą zmianą stanu w bazie. */
export async function submitReview(
  token: string,
  input: { rating: number; comment?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const request = await getReviewRequestByToken(token);
  if (!request) return { ok: false, error: 'Nie znaleziono prośby o opinię.' };
  if (request.status === 'COMPLETED') return { ok: false, error: 'Opinia została już zapisana.' };

  const rating = Math.round(input.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: 'Ocena musi być liczbą od 1 do 5.' };
  }

  await db
    .update(reviewRequests)
    .set({
      rating,
      comment: input.comment?.trim() || null,
      status: 'COMPLETED',
      respondedAt: new Date(),
    })
    .where(eq(reviewRequests.id, request.id));

  await writeAuditLog({
    organizationId: request.organizationId,
    action: 'review.submitted',
    entityType: 'review_request',
    entityId: request.id,
    meta: { rating },
  });

  return { ok: true };
}

export async function getReviewSummary(organizationId: string) {
  const rows = await db
    .select({ rating: reviewRequests.rating })
    .from(reviewRequests)
    .where(and(eq(reviewRequests.organizationId, organizationId), eq(reviewRequests.status, 'COMPLETED')));

  const rated = rows.map((row) => row.rating).filter((value): value is number => typeof value === 'number');
  const sum = rated.reduce((total, value) => total + value, 0);

  return {
    count: rated.length,
    average: rated.length > 0 ? Math.round((sum / rated.length) * 10) / 10 : null,
    pending: await db
      .select({ id: reviewRequests.id })
      .from(reviewRequests)
      .where(and(eq(reviewRequests.organizationId, organizationId), eq(reviewRequests.status, 'PENDING')))
      .then((pending) => pending.length),
  };
}
