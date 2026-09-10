import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { checklists, invoices, jobs, organizations, payments, quoteEvents, quotes, timeEntries } from '@/lib/db/schema';
import { createEstimate, createQuoteFromEstimate } from '@/lib/services/estimates';
import { acceptQuoteByToken, sendQuote } from '@/lib/services/quotes';
import {
  addJobNote,
  addJobPhoto,
  completeJob,
  createJobFromQuote,
  findScheduleConflicts,
  getJobChecklists,
  getJobItems,
  getJobPhotos,
  pauseTimeEntry,
  resumeTimeEntry,
  startTimeEntry,
  stopTimeEntry,
  toggleChecklistItem,
  updateJobStatus,
  createChecklistTemplate,
  scheduleJob,
} from '@/lib/services/jobs';
import { createInvoiceFromJob, getInvoice, recordPayment, refreshOverdueInvoices, markInvoiceSent } from '@/lib/services/invoices';
import { saveFile } from '@/lib/storage';
import { createTestCustomer, createTestOrganization, createTestService, deleteTestOrganization, deleteTestUser } from '../helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

describe('przepływ: oferta → zlecenie → faktura → płatność', () => {
  let orgId = '';
  let userId = '';
  let customerId = '';
  let serviceId = '';
  let ctx: { organizationId: string; userId: string; userName: string };
  const userIds: string[] = [];

  beforeAll(async () => {
    const org = await createTestOrganization('Przepływ', {
      taxRateBps: 2300,
      completionRequirements: { requireChecklist: true, requireAfterPhotos: true, requireNote: true, minAfterPhotos: 1 },
    });
    orgId = org.organizationId;
    userId = org.userId;
    userIds.push(userId);
    ctx = { organizationId: orgId, userId, userName: 'Test' };

    const customer = await createTestCustomer(orgId, { displayName: 'Firma Testowa', email: 'klient@example.com' });
    customerId = customer.id;
    const service = await createTestService(orgId, {
      name: 'Mycie elewacji',
      pricingMode: 'PER_UNIT',
      unit: 'SQM',
      basePriceCents: 1200,
    });
    serviceId = service.id;

    await createChecklistTemplate(ctx, { name: 'Standard', items: ['Zabezpieczenie terenu', 'Mycie', 'Kontrola końcowa'] });
  });

  afterAll(async () => {
    await deleteTestOrganization(orgId);
    for (const id of userIds) await deleteTestUser(id);
  });

  it('wycena → oferta → wysyłka → akceptacja klienta', async () => {
    const estimate = await createEstimate(ctx, {
      customerId,
      lines: [{ serviceId, name: 'Mycie elewacji', quantity: 40, unitPriceCents: 1200, unit: 'SQM', taxRateBps: 2300 }],
    });
    expect(estimate.totalCents).toBe(48000 + 11040);

    const quote = await createQuoteFromEstimate(ctx, estimate.id, { validDays: 14 });
    expect(quote!.status).toBe('DRAFT');

    const sent = await sendQuote(ctx, quote!.id);
    expect(sent.ok).toBe(true);
    expect(sent.data!.status).toBe('SENT');
    // brak SMTP — system raportuje to wprost zamiast udawać wysyłkę
    const note = sent.data!.deliveryNote ?? '';
    expect(note).toMatch(/nie została wysłana|SMTP|providera/i);

    const accepted = await acceptQuoteByToken(quote!.publicToken, { actorName: 'Klient', ip: '127.0.0.1' });
    expect(accepted.ok).toBe(true);
    expect(accepted.data!.status).toBe('ACCEPTED');

    const events = await db.select().from(quoteEvents).where(eq(quoteEvents.quoteId, quote!.id));
    expect(events.map((event) => event.type)).toContain('ACCEPTED');

    // druga akceptacja tej samej oferty jest odrzucana
    const second = await acceptQuoteByToken(quote!.publicToken);
    expect(second.ok).toBe(false);

    (globalThis as Record<string, unknown>).__acceptedQuoteId = quote!.id;
  });

  it('z zaakceptowanej oferty powstaje zlecenie z pozycjami i checklistą', async () => {
    const quoteId = (globalThis as Record<string, unknown>).__acceptedQuoteId as string;
    const result = await createJobFromQuote(ctx, quoteId);
    expect(result.ok).toBe(true);
    const job = result.data!;

    expect(job.status).toBe('UNSCHEDULED');
    expect(job.totalCents).toBe(59040);

    const items = await getJobItems(job.id);
    expect(items).toHaveLength(1);
    expect(items[0].netCents).toBe(48000);

    const list = await getJobChecklists(job.id);
    expect(list.length).toBe(1);
    expect(list[0].items).toHaveLength(3);

    (globalThis as Record<string, unknown>).__jobId = job.id;
  });

  it('nie utworzy zlecenia z niezaakceptowanej oferty', async () => {
    const estimate = await createEstimate(ctx, {
      customerId,
      lines: [{ serviceId, name: 'Mycie', quantity: 1, unitPriceCents: 1200, unit: 'SQM', taxRateBps: 2300 }],
    });
    const quote = await createQuoteFromEstimate(ctx, estimate.id);
    const result = await createJobFromQuote(ctx, quote!.id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('zaakceptowana');
  });

  it('planowanie wykrywa konflikt terminów tej samej ekipy', async () => {
    const jobId = (globalThis as Record<string, unknown>).__jobId as string;
    const { crews } = await import('@/lib/db/schema');
    const [crew] = await db.insert(crews).values({ organizationId: orgId, name: 'Ekipa A' }).returning();

    const start = new Date('2026-10-05T09:00:00Z');
    const end = new Date('2026-10-05T12:00:00Z');
    await scheduleJob(ctx, jobId, { scheduledStart: start, scheduledEnd: end, crewId: crew.id });

    const second = await db
      .insert(jobs)
      .values({
        organizationId: orgId,
        number: 'ZL/2026/10/9001',
        customerId,
        title: 'Drugie zlecenie',
        status: 'UNSCHEDULED',
      })
      .returning();

    const conflicts = await findScheduleConflicts(orgId, {
      crewId: crew.id,
      start: new Date('2026-10-05T10:00:00Z'),
      end: new Date('2026-10-05T11:00:00Z'),
      excludeJobId: second[0].id,
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].jobId).toBe(jobId);

    // bez ekipy nie ma konfliktu
    const noCrew = await findScheduleConflicts(orgId, {
      crewId: null,
      start: new Date('2026-10-05T10:00:00Z'),
      end: new Date('2026-10-05T11:00:00Z'),
    });
    expect(noCrew).toHaveLength(0);

    (globalThis as Record<string, unknown>).__crewId = crew.id;
  });

  it('rejestracja czasu nie pozwala na błędne stany', async () => {
    const jobId = (globalThis as Record<string, unknown>).__jobId as string;

    const started = await startTimeEntry(ctx, jobId);
    expect(started.ok).toBe(true);

    const double = await startTimeEntry(ctx, jobId);
    expect(double.ok).toBe(false);
    expect(double.error).toContain('już działa');

    const paused = await pauseTimeEntry(ctx, jobId);
    expect(paused.ok).toBe(true);
    const pausedAgain = await pauseTimeEntry(ctx, jobId);
    expect(pausedAgain.ok).toBe(false);

    const resumed = await resumeTimeEntry(ctx, jobId);
    expect(resumed.ok).toBe(true);
    const resumedAgain = await resumeTimeEntry(ctx, jobId);
    expect(resumedAgain.ok).toBe(false);

    const stopped = await stopTimeEntry(ctx, jobId);
    expect(stopped.ok).toBe(true);
    expect(stopped.data!.durationSeconds).toBeGreaterThanOrEqual(0);

    const stoppedAgain = await stopTimeEntry(ctx, jobId);
    expect(stoppedAgain.ok).toBe(false);
  });

  it('zakończenie zlecenia respektuje wymagania firmy', async () => {
    const jobId = (globalThis as Record<string, unknown>).__jobId as string;

    // brak zdjęć „po”, checklisty i notatki — zakończenie musi się nie udać
    const tooEarly = await completeJob(ctx, jobId, { note: '' });
    expect(tooEarly.ok).toBe(false);
    expect(tooEarly.error).toContain('checklista');
    expect(tooEarly.error).toContain('zdjęć');
    expect(tooEarly.error).toContain('notatki');

    // checklista
    const list = await getJobChecklists(jobId);
    for (const item of list[0].items) {
      const toggled = await toggleChecklistItem(ctx, jobId, item.id, true);
      expect(toggled.ok).toBe(true);
    }

    // zdjęcie „po”
    const file = await saveFile({
      organizationId: orgId,
      uploadedById: userId,
      originalName: 'po.png',
      bytes: PNG,
      kind: 'JOB_PHOTO',
    });
    const photo = await addJobPhoto(ctx, jobId, file.id, 'AFTER', 'Po myciu');
    expect(photo.ok).toBe(true);

    // status przejściowy
    await updateJobStatus(ctx, jobId, 'IN_PROGRESS');

    // wciąż brak notatki
    const withoutNote = await completeJob(ctx, jobId, { note: '  ' });
    expect(withoutNote.ok).toBe(false);

    const done = await completeJob(ctx, jobId, { note: 'Elewacja umyta, klient odebrał.' });
    expect(done.ok).toBe(true);
    expect(done.data!.status).toBe('COMPLETED');
    expect(done.data!.completedById).toBe(userId);

    const photos = await getJobPhotos(orgId, jobId);
    expect(photos).toHaveLength(1);
  });

  it('nie pozwala dodać zdjęcia z innej firmy', async () => {
    const jobId = (globalThis as Record<string, unknown>).__jobId as string;
    const other = await createTestOrganization('Obca');
    userIds.push(other.userId);

    const foreignFile = await saveFile({
      organizationId: other.organizationId,
      originalName: 'obce.png',
      bytes: PNG,
      kind: 'JOB_PHOTO',
    });

    const result = await addJobPhoto(ctx, jobId, foreignFile.id, 'AFTER');
    expect(result.ok).toBe(false);

    await deleteTestOrganization(other.organizationId);
  });

  it('faktura ze zlecenia i płatności zmieniają status zgodnie z kwotami', async () => {
    const jobId = (globalThis as Record<string, unknown>).__jobId as string;

    const created = await createInvoiceFromJob(ctx, jobId);
    expect(created.ok).toBe(true);
    const invoice = created.data!;

    expect(invoice.subtotalCents).toBe(48000);
    expect(invoice.taxCents).toBe(11040);
    expect(invoice.totalCents).toBe(59040);
    expect(invoice.status).toBe('DRAFT');

    await markInvoiceSent(ctx, invoice.id);

    const partial = await recordPayment(ctx, invoice.id, { amountCents: 20000, method: 'BANK_TRANSFER' });
    expect(partial.ok).toBe(true);
    expect(partial.data!.status).toBe('PARTIALLY_PAID');
    expect(partial.data!.paidCents).toBe(20000);

    const tooMuch = await recordPayment(ctx, invoice.id, { amountCents: 999999, method: 'CASH' });
    expect(tooMuch.ok).toBe(false);

    const rest = await recordPayment(ctx, invoice.id, { amountCents: 39040, method: 'CASH' });
    expect(rest.ok).toBe(true);
    expect(rest.data!.status).toBe('PAID');
    expect(rest.data!.paidCents).toBe(59040);

    const paymentRows = await db.select().from(payments).where(eq(payments.invoiceId, invoice.id));
    expect(paymentRows).toHaveLength(2);

    (globalThis as Record<string, unknown>).__invoiceId = invoice.id;
  });

  it('faktura z innej firmy jest niedostępna', async () => {
    const invoiceId = (globalThis as Record<string, unknown>).__invoiceId as string;
    const other = await createTestOrganization('Obca2');
    userIds.push(other.userId);

    const foreign = await getInvoice(other.organizationId, invoiceId);
    expect(foreign).toBeNull();

    const payment = await recordPayment(
      { organizationId: other.organizationId, userId: other.userId, userName: 'Obcy' },
      invoiceId,
      { amountCents: 100, method: 'CASH' },
    );
    expect(payment.ok).toBe(false);

    await deleteTestOrganization(other.organizationId);
  });

  it('przeterminowane faktury dostają status OVERDUE', async () => {
    const estimate = await createEstimate(ctx, {
      customerId,
      lines: [{ serviceId, name: 'Mycie', quantity: 1, unitPriceCents: 10000, unit: 'VISIT', taxRateBps: 2300 }],
    });
    const created = await db
      .insert(invoices)
      .values({
        organizationId: orgId,
        number: 'FV/2020/01/0001',
        customerId,
        publicToken: 'tok-overdue-test',
        dueDate: new Date('2020-01-15T00:00:00Z'),
        status: 'SENT',
        buyerName: 'Firma Testowa',
        subtotalCents: 10000,
        taxCents: 2300,
        totalCents: 12300,
      })
      .returning();

    const count = await refreshOverdueInvoices(orgId);
    expect(count).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(invoices).where(eq(invoices.id, created[0].id));
    expect(row.status).toBe('OVERDUE');

    await db.delete(invoices).where(eq(invoices.id, created[0].id));
  });
});
