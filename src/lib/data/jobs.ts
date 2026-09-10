import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  checklistItems,
  checklists,
  crews,
  crewMembers,
  files,
  jobAssignments,
  jobNotes,
  jobPhotos,
  memberships,
  timeEntries,
  users,
  type Role,
} from '@/lib/db/schema';

/** Lista pracowników firmy (do przypisania do zlecenia i do ekip). */
export async function listMembers(organizationId: string) {
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: memberships.role,
      isActive: memberships.isActive,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(asc(users.name));
}

export async function listCrews(organizationId: string) {
  const rows = await db.select().from(crews).where(eq(crews.organizationId, organizationId)).orderBy(asc(crews.name));
  const members = await db
    .select({ crewId: crewMembers.crewId, userId: crewMembers.userId, isLeader: crewMembers.isLeader, name: users.name })
    .from(crewMembers)
    .innerJoin(crews, eq(crews.id, crewMembers.crewId))
    .innerJoin(users, eq(users.id, crewMembers.userId))
    .where(eq(crews.organizationId, organizationId));

  return rows.map((crew) => ({
    ...crew,
    members: members.filter((member) => member.crewId === crew.id),
  }));
}

export async function getCrew(organizationId: string, crewId: string) {
  const rows = await db.select().from(crews).where(and(eq(crews.id, crewId), eq(crews.organizationId, organizationId))).limit(1);
  return rows[0] ?? null;
}

/** Zdjęcia zlecenia wraz z danymi pliku (dostęp do pliku zawsze sprawdza organizację). */
export async function getJobPhotosWithFiles(organizationId: string, jobId: string) {
  return db
    .select({
      id: jobPhotos.id,
      type: jobPhotos.type,
      caption: jobPhotos.caption,
      takenAt: jobPhotos.takenAt,
      fileId: jobPhotos.fileId,
      originalName: files.originalName,
      authorName: users.name,
    })
    .from(jobPhotos)
    .innerJoin(files, eq(files.id, jobPhotos.fileId))
    .leftJoin(users, eq(users.id, jobPhotos.authorId))
    .where(and(eq(jobPhotos.jobId, jobId), eq(jobPhotos.organizationId, organizationId)))
    .orderBy(desc(jobPhotos.takenAt));
}

export async function getJobNotesWithAuthors(jobId: string) {
  return db
    .select({
      id: jobNotes.id,
      body: jobNotes.body,
      isPinned: jobNotes.isPinned,
      authorName: jobNotes.authorName,
      authorUserName: users.name,
      createdAt: jobNotes.createdAt,
    })
    .from(jobNotes)
    .leftJoin(users, eq(users.id, jobNotes.authorId))
    .where(eq(jobNotes.jobId, jobId))
    .orderBy(desc(jobNotes.isPinned), desc(jobNotes.createdAt));
}

export async function getJobChecklists(jobId: string) {
  const lists = await db
    .select()
    .from(checklists)
    .where(eq(checklists.jobId, jobId))
    .orderBy(asc(checklists.sortOrder), asc(checklists.name));

  if (lists.length === 0) return [];
  const items = await db
    .select()
    .from(checklistItems)
    .where(
      inArray(
        checklistItems.checklistId,
        lists.map((list) => list.id),
      ),
    )
    .orderBy(asc(checklistItems.sortOrder));

  return lists.map((list) => ({
    ...list,
    items: items.filter((item) => item.checklistId === list.id),
  }));
}

export async function getJobAssignmentsWithUsers(jobId: string) {
  return db
    .select({ userId: jobAssignments.userId, isLead: jobAssignments.isLead, name: users.name })
    .from(jobAssignments)
    .innerJoin(users, eq(users.id, jobAssignments.userId))
    .where(eq(jobAssignments.jobId, jobId));
}

export async function getJobTimeEntriesWithUsers(jobId: string) {
  return db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      userName: users.name,
      status: timeEntries.status,
      startedAt: timeEntries.startedAt,
      endedAt: timeEntries.endedAt,
      pausedMs: timeEntries.pausedMs,
      durationSeconds: timeEntries.durationSeconds,
      note: timeEntries.note,
    })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(eq(timeEntries.jobId, jobId))
    .orderBy(asc(timeEntries.startedAt));
}

export async function memberRole(organizationId: string, userId: string): Promise<Role | null> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

/** Zlecenia w zadanym zakresie dat (widok kalendarza). */
export async function listJobsInRange(organizationId: string, from: Date, to: Date) {
  const { customers, jobs } = await import('@/lib/db/schema');
  const { gte, lt } = await import('drizzle-orm');

  return db
    .select({
      id: jobs.id,
      number: jobs.number,
      title: jobs.title,
      status: jobs.status,
      scheduledStart: jobs.scheduledStart,
      scheduledEnd: jobs.scheduledEnd,
      crewId: jobs.crewId,
      crewName: crews.name,
      crewColor: crews.color,
      customerName: customers.displayName,
      addressCity: jobs.addressCity,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .leftJoin(crews, eq(crews.id, jobs.crewId))
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        gte(jobs.scheduledStart, from),
        lt(jobs.scheduledStart, to),
      ),
    )
    .orderBy(asc(jobs.scheduledStart));
}

/** Zakończone zlecenia, które można zafakturować (bez faktury). */
export async function listInvoiceableJobs(organizationId: string) {
  const { customers, invoices, jobs } = await import('@/lib/db/schema');
  const { notExists } = await import('drizzle-orm');

  return db
    .select({
      id: jobs.id,
      number: jobs.number,
      title: jobs.title,
      totalCents: jobs.totalCents,
      completedAt: jobs.completedAt,
      customerName: customers.displayName,
    })
    .from(jobs)
    .innerJoin(customers, eq(customers.id, jobs.customerId))
    .where(
      and(
        eq(jobs.organizationId, organizationId),
        eq(jobs.status, 'COMPLETED'),
        notExists(
          db
            .select({ id: invoices.id })
            .from(invoices)
            .where(and(eq(invoices.jobId, jobs.id), sql`${invoices.status} <> 'CANCELLED'`)),
        ),
      ),
    )
    .orderBy(desc(jobs.completedAt));
}
