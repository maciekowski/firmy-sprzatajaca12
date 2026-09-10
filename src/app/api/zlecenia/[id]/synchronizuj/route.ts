import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { syncRecords } from '@/lib/db/schema';
import { ForbiddenError, UnauthorizedError, requireJobExecutionAccessOrThrow } from '@/lib/auth/guards';
import { rateLimit } from '@/lib/rate-limit';
import { addJobNote, addJobPhoto, getJob, recordOfflineTimeEntry, toggleChecklistItem, updateJobStatus } from '@/lib/services/jobs';
import type { Job } from '@/lib/db/schema';

const ALLOWED_STATUSES: Job['status'][] = ['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];

type SyncItem =
  | { clientId: string; kind: 'note'; body: string }
  | { clientId: string; kind: 'photo'; fileId: string; type?: 'BEFORE' | 'DURING' | 'AFTER' | 'OTHER'; caption?: string }
  | { clientId: string; kind: 'status'; status: Job['status']; note?: string }
  | { clientId: string; kind: 'checklist'; itemId: string; done: boolean }
  | { clientId: string; kind: 'time'; startedAt: string; endedAt: string; pausedMs?: number; note?: string };

function parseItem(raw: unknown): SyncItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const clientId = typeof item.clientId === 'string' ? item.clientId : '';
  if (clientId.length < 8 || clientId.length > 128) return null;

  switch (item.kind) {
    case 'note':
      return typeof item.body === 'string' && item.body.trim() ? { clientId, kind: 'note', body: item.body.trim() } : null;
    case 'photo':
      return typeof item.fileId === 'string' && item.fileId
        ? {
            clientId,
            kind: 'photo',
            fileId: item.fileId,
            type: (['BEFORE', 'DURING', 'AFTER', 'OTHER'].includes(String(item.type)) ? item.type : 'OTHER') as
              | 'BEFORE'
              | 'DURING'
              | 'AFTER'
              | 'OTHER',
            caption: typeof item.caption === 'string' ? item.caption : undefined,
          }
        : null;
    case 'status':
      return ALLOWED_STATUSES.includes(item.status as Job['status'])
        ? {
            clientId,
            kind: 'status',
            status: item.status as Job['status'],
            note: typeof item.note === 'string' ? item.note : undefined,
          }
        : null;
    case 'checklist':
      return typeof item.itemId === 'string' && item.itemId
        ? { clientId, kind: 'checklist', itemId: item.itemId, done: item.done !== false }
        : null;
    case 'time': {
      const startedAt = new Date(String(item.startedAt));
      const endedAt = new Date(String(item.endedAt));
      if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return null;
      if (endedAt.getTime() <= startedAt.getTime()) return null;
      return {
        clientId,
        kind: 'time',
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        pausedMs: Number.isFinite(Number(item.pausedMs)) ? Math.max(0, Math.round(Number(item.pausedMs))) : 0,
        note: typeof item.note === 'string' ? item.note : undefined,
      };
    }
    default:
      return null;
  }
}

/**
 * Synchronizacja operacji zapisanych offline (kolejka na urządzeniu).
 *
 * Zasady:
 *  - dostęp: zalogowany użytkownik z prawem do tego zlecenia (`job:write`
 *    albo pracownik przypisany do zlecenia) — cudze zlecenie = 404,
 *  - idempotencja: `clientId` z urządzenia jest unikalny w obrębie firmy,
 *    więc ponowiona partia (utrata sieci w trakcie wysyłki) nie tworzy duplikatów,
 *  - wynik zwracany jest per pozycja — jedna błędna pozycja nie odrzuca partii.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;

  let context;
  try {
    context = await requireJobExecutionAccessOrThrow(jobId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Brak dostępu do tego zlecenia.' }, { status: 403 });
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Brak autoryzacji.' }, { status: 401 });
    }
    throw error;
  }

  // Zlecenie musi należeć do organizacji z kontekstu — cudze = 404 (brak wycieku istnienia).
  const job = await getJob(context.organization.id, jobId);
  if (!job) return NextResponse.json({ error: 'Nie znaleziono zlecenia.' }, { status: 404 });

  const limit = rateLimit(`sync:${context.user.id}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Zbyt wiele żądań. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Niepoprawny format danych.' }, { status: 400 });
  }

  const rawItems = (payload as { items?: unknown })?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: 'Brak pozycji do synchronizacji.' }, { status: 400 });
  }
  if (rawItems.length > 100) {
    return NextResponse.json({ error: 'Partia może mieć maksymalnie 100 pozycji.' }, { status: 413 });
  }

  const ctx = {
    organizationId: context.organization.id,
    userId: context.user.id,
    userName: context.user.name,
  };

  const results: { clientId: string; status: 'ok' | 'duplicate' | 'error'; error?: string }[] = [];

  for (const raw of rawItems) {
    const item = parseItem(raw);
    if (!item) {
      results.push({
        clientId: typeof (raw as Record<string, unknown>)?.clientId === 'string' ? String((raw as Record<string, unknown>).clientId) : 'nieznany',
        status: 'error',
        error: 'Niepoprawna pozycja.',
      });
      continue;
    }

    // Idempotencja: ta sama partia wysłana drugi raz niczego nie zmienia.
    const already = await db
      .select({ id: syncRecords.id })
      .from(syncRecords)
      .where(and(eq(syncRecords.organizationId, ctx.organizationId), eq(syncRecords.clientId, item.clientId)))
      .limit(1);

    if (already[0]) {
      results.push({ clientId: item.clientId, status: 'duplicate' });
      continue;
    }

    let outcome: { ok: true; entityId: string } | { ok: false; error: string };

    switch (item.kind) {
      case 'note': {
        const result = await addJobNote(ctx, jobId, item.body);
        outcome = result.ok ? { ok: true, entityId: jobId } : { ok: false, error: result.error };
        break;
      }
      case 'photo': {
        const result = await addJobPhoto(ctx, jobId, item.fileId, item.type ?? 'OTHER', item.caption);
        outcome = result.ok ? { ok: true, entityId: item.fileId } : { ok: false, error: result.error };
        break;
      }
      case 'status': {
        const result = await updateJobStatus(ctx, jobId, item.status, item.note ?? null);
        outcome = result.ok ? { ok: true, entityId: jobId } : { ok: false, error: result.error };
        break;
      }
      case 'checklist': {
        const result = await toggleChecklistItem(ctx, jobId, item.itemId, item.done);
        outcome = result.ok ? { ok: true, entityId: item.itemId } : { ok: false, error: result.error };
        break;
      }
      case 'time': {
        const result = await recordOfflineTimeEntry(ctx, jobId, {
          startedAt: new Date(item.startedAt),
          endedAt: new Date(item.endedAt),
          pausedMs: item.pausedMs,
          note: item.note ?? null,
        });
        outcome = result.ok
          ? { ok: true, entityId: result.data!.id }
          : { ok: false, error: result.error };
        break;
      }
    }

    if (!outcome.ok) {
      results.push({ clientId: item.clientId, status: 'error', error: outcome.error });
      continue;
    }

    await db.insert(syncRecords).values({
      organizationId: ctx.organizationId,
      jobId,
      clientId: item.clientId,
      kind: item.kind,
      entityType: item.kind,
      entityId: outcome.entityId,
      userId: ctx.userId,
    });

    results.push({ clientId: item.clientId, status: 'ok' });
  }

  const ok = results.filter((row) => row.status === 'ok').length;
  const duplicates = results.filter((row) => row.status === 'duplicate').length;
  const errors = results.filter((row) => row.status === 'error').length;

  return NextResponse.json({ ok, duplicates, errors, results });
}
