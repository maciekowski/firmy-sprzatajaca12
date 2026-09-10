/**
 * Synchronizacja operacji zapisanych offline (kolejka na urządzeniu pracownika).
 *
 * Kluczowe: idempotencja (clientId), brak dostępu do cudzego zlecenia
 * oraz to, że wynik rozliczany jest per pozycja.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  files,
  jobAssignments,
  jobNotes,
  jobs,
  memberships,
  sessions,
  syncRecords,
  timeEntries,
  users,
} from '@/lib/db/schema';
import { hashToken } from '@/lib/auth/tokens';
import { updateJobStatus } from '@/lib/services/jobs';
import { createTestCustomer, createTestOrganization, deleteTestOrganization, deleteTestUser } from '../helpers';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';

type Fixture = Awaited<ReturnType<typeof createTestOrganization>>;

async function cookieFor(fixture: Fixture, workerId?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId: workerId ?? fixture.userId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    userAgent: 'vitest-sync',
  });
  return `sf_session=${token}; sf_org=${fixture.organizationId}`;
}

async function post(jobId: string, items: unknown[], cookie?: string, orgId?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = orgId ? `${cookie}; sf_org=${orgId}` : cookie;

  const response = await fetch(`${BASE_URL}/api/zlecenia/${jobId}/synchronizuj`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ items }),
  });

  const body = await response.json().catch(() => ({}));
  return { status: response.status, body: body as Record<string, unknown> };
}

describe('synchronizacja offline (kolejka urządzenia)', () => {
  let org: Fixture;
  let otherOrg: Fixture;
  let jobId: string;
  let workerId: string;
  let cookieOwner: string;
  let cookieWorker: string;

  beforeAll(async () => {
    org = await createTestOrganization('SYNC-A');
    otherOrg = await createTestOrganization('SYNC-B');

    const customer = await createTestCustomer(org.organizationId, { displayName: 'Klient Sync' });

    const [job] = await db
      .insert(jobs)
      .values({
        organizationId: org.organizationId,
        customerId: customer.id,
        number: 'ZL/SYNC/1',
        title: 'Zlecenie sync',
        status: 'SCHEDULED',
        subtotalCents: 10_000,
        taxCents: 2_300,
        totalCents: 12_300,
      })
      .returning();
    jobId = job!.id;

    const [worker] = await db
      .insert(users)
      .values({ email: `pracownik-sync-${Date.now()}@example.com`, name: 'Pracownik Sync', passwordHash: 'x' })
      .returning();
    workerId = worker!.id;

    await db.insert(memberships).values({ organizationId: org.organizationId, userId: workerId, role: 'WORKER' });
    await db.insert(jobAssignments).values({ jobId, userId: workerId });

    cookieOwner = await cookieFor(org);
    cookieWorker = await cookieFor(org, workerId);
  });

  afterAll(async () => {
    await deleteTestOrganization(org.organizationId);
    await deleteTestOrganization(otherOrg.organizationId);
    await deleteTestUser(org.userId);
    await deleteTestUser(otherOrg.userId);
    await deleteTestUser(workerId);
  });

  it('niezalogowany nie wyśle partii', async () => {
    const response = await post(jobId, [{ clientId: 'a'.repeat(36), kind: 'note', body: 'test' }]);
    expect(response.status).toBe(401);
  });

  it('pracownik przypisany do zlecenia zsynchronizuje notatki', async () => {
    const clientId = randomBytes(16).toString('hex');
    const response = await post(
      jobId,
      [{ clientId, kind: 'note', body: 'Zrobione offline o 12:00' }],
      cookieWorker,
    );

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(1);
    expect(response.body.errors).toBe(0);

    const notes = await db.select().from(jobNotes).where(eq(jobNotes.jobId, jobId));
    expect(notes.some((note) => note.body === 'Zrobione offline o 12:00')).toBe(true);

    const record = await db.select().from(syncRecords).where(eq(syncRecords.clientId, clientId));
    expect(record).toHaveLength(1);
  });

  it('ponowiona partia nie tworzy duplikatów (idempotencja clientId)', async () => {
    const clientId = randomBytes(16).toString('hex');
    const items = [{ clientId, kind: 'note' as const, body: 'Druga notatka offline' }];

    const first = await post(jobId, items, cookieWorker);
    expect(first.body.ok).toBe(1);

    const second = await post(jobId, items, cookieWorker);
    expect(second.status).toBe(200);
    expect(second.body.duplicates).toBe(1);
    expect(second.body.ok).toBe(0);

    const notes = await db.select().from(jobNotes).where(and(eq(jobNotes.jobId, jobId), eq(jobNotes.body, 'Druga notatka offline')));
    expect(notes).toHaveLength(1);
  });

  it('błędna pozycja jest raportowana, ale nie odrzuca całej partii', async () => {
    const good = randomBytes(16).toString('hex');
    const badStatus = randomBytes(16).toString('hex');

    const response = await post(
      jobId,
      [
        { clientId: good, kind: 'note', body: 'Trzecia notatka' },
        { clientId: badStatus, kind: 'status', status: 'NIEISTNIEJACY_STATUS' },
        { clientId: 'krotkie', kind: 'note', body: 'za krótki clientId' },
      ],
      cookieOwner,
    );

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(1);
    expect(response.body.errors).toBe(2);
  });

  it('zdjęcie jest wiązane ze zleceniem dopiero po wgraniu pliku', async () => {
    const [file] = await db
      .insert(files)
      .values({
        organizationId: org.organizationId,
        storageKey: `sync-test-${Date.now()}`,
        originalName: 'zdjecie.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1_024,
        kind: 'JOB_PHOTO',
      })
      .returning();

    const clientId = randomBytes(16).toString('hex');
    const response = await post(
      jobId,
      [{ clientId, kind: 'photo', fileId: file!.id, type: 'AFTER', caption: 'Po sprzątaniu' }],
      cookieOwner,
    );

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(1);
  });

  it('użytkownik innej firmy nie zsynchronizuje danych do cudzego zlecenia', async () => {
    const token = randomBytes(32).toString('base64url');
    await db.insert(sessions).values({
      tokenHash: hashToken(token),
      userId: otherOrg.userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      userAgent: 'vitest-sync',
    });

    // próba „podmiany” organizacji w ciastku — użytkownik nie jest jej członkiem
    const response = await post(
      jobId,
      [{ clientId: randomBytes(16).toString('hex'), kind: 'note', body: 'wstrzyknięcie' }],
      `sf_session=${token}; sf_org=${org.organizationId}`,
    );

    expect([401, 403, 404]).toContain(response.status);

    const notes = await db.select().from(jobNotes).where(and(eq(jobNotes.jobId, jobId), eq(jobNotes.body, 'wstrzyknięcie')));
    expect(notes).toHaveLength(0);
  });

  it('użytkownik nieprzypisany do zlecenia nie ma dostępu', async () => {
    const [stranger] = await db
      .insert(users)
      .values({ email: `obcy-${Date.now()}@example.com`, name: 'Obcy', passwordHash: 'x' })
      .returning();

    const token = randomBytes(32).toString('base64url');
    await db.insert(sessions).values({
      tokenHash: hashToken(token),
      userId: stranger!.id,
      expiresAt: new Date(Date.now() + 3_600_000),
      userAgent: 'vitest-sync',
    });

    // użytkownik nie jest członkiem tej firmy → 401/403/404 (nigdy 200)
    const response = await post(jobId, [{ clientId: randomBytes(16).toString('hex'), kind: 'note', body: 'x' }], `sf_session=${token}`);
    expect([401, 403, 404]).toContain(response.status);
    expect(response.status).not.toBe(200);

    await deleteTestUser(stranger!.id);
  });

  it('pusta partia jest odrzucana', async () => {
    const response = await post(jobId, [], cookieWorker);
    expect(response.status).toBe(400);
  });

  it('czas pracy wykonany offline jest zapisywany z oznaczeniem źródła', async () => {
    const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000 - 30 * 60 * 1000);
    const endedAt = new Date(Date.now() - 30 * 60 * 1000);

    const clientId = randomBytes(16).toString('hex');
    const response = await post(
      jobId,
      [
        {
          clientId,
          kind: 'time',
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          pausedMs: 30 * 60 * 1000, // 30 minut pauzy
        },
      ],
      cookieWorker,
    );

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(1);

    const entries = await db.select().from(timeEntries).where(eq(timeEntries.jobId, jobId));
    const synced = entries.find((entry) => entry.source === 'OFFLINE_SYNC');
    expect(synced).toBeTruthy();
    // 2h30m pracy z 30-minutową pauzą = 1h30m = 5400 s
    expect(synced!.durationSeconds).toBe(5400);
    expect(synced!.status).toBe('STOPPED');
    expect(synced!.pausedMs).toBe(30 * 60 * 1000);

    // druga próba z tym samym clientId nie dubluje wpisu
    const again = await post(
      jobId,
      [{ clientId, kind: 'time', startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString() }],
      cookieWorker,
    );
    expect(again.body.duplicates).toBe(1);
    const after = await db.select().from(timeEntries).where(eq(timeEntries.jobId, jobId));
    expect(after.filter((entry) => entry.source === 'OFFLINE_SYNC')).toHaveLength(1);
  });

  it('odrzuca czas pracy z błędnymi godzinami', async () => {
    const clientId = randomBytes(16).toString('hex');
    const response = await post(
      jobId,
      [
        {
          clientId,
          kind: 'time',
          startedAt: 'nie-jest-data',
          endedAt: new Date().toISOString(),
        },
      ],
      cookieWorker,
    );

    expect(response.status).toBe(200);
    expect(response.body.errors).toBe(1);
  });

  it('status zlecenia zmieniony z kolejki jest widoczny w danych', async () => {
    const clientId = randomBytes(16).toString('hex');
    const response = await post(jobId, [{ clientId, kind: 'status', status: 'EN_ROUTE' }], cookieWorker);
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(1);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(job!.status).toBe('EN_ROUTE');

    await updateJobStatus({ organizationId: org.organizationId, userId: org.userId, userName: 'Test' }, jobId, 'SCHEDULED');
  });
});
