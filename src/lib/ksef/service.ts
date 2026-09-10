/**
 * Warstwa KSeF — synchronizacja i prezentacja stanu faktury względem KSeF.
 *
 * ServiceFlow NIE jest KSeF:
 *  - nie generujemy numeru KSeF (zapisujemy tylko ten zwrócony przez KSeF),
 *  - nie ustawiamy ACCEPTED bez potwierdzenia z KSeF,
 *  - nie oznaczamy UPO jako dostępnego bez faktycznego pobrania.
 */
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db/client';
import { invoiceItems, invoices, organizations, type Invoice } from '@/lib/db/schema';
import { writeAuditLog } from '@/lib/audit';
import { saveFile } from '@/lib/storage';
import { buildFa3Xml } from './fa3';
import { getInvoiceStatus, getUpo, submitInvoice, type KsefError } from './client';
import { getKsefConfig, isKsefConfigured } from './config';

export type ServiceContext = { organizationId: string; userId: string; userName: string };

export type KsefOperationResult =
  | { ok: true; status: string; ksefNumber?: string | null; message?: string }
  | { ok: false; error: string; code?: string };

async function loadInvoiceBundle(organizationId: string, invoiceId: string) {
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
    .limit(1);
  const invoice = rows[0];
  if (!invoice) return null;

  const [items, organization] = await Promise.all([
    db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId)),
    db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1).then((result) => result[0] ?? null),
  ]);

  return { invoice, items, organization };
}

function buildXml(invoice: Invoice, items: { name: string; quantity: string; unit: string; unitPriceCents: number; netCents: number; taxRateBps: number; taxCents: number; grossCents: number }[], organization: { name: string; taxId: string | null; street: string | null; city: string | null; postalCode: string | null; email: string | null; phone: string | null; currency: string }): string {
  return buildFa3Xml({
    number: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: organization.currency,
    seller: {
      name: organization.name,
      nip: (organization.taxId ?? '').replace(/[^0-9]/g, ''),
      street: organization.street,
      city: organization.city,
      postalCode: organization.postalCode,
      email: organization.email,
      phone: organization.phone,
    },
    buyer: {
      name: invoice.buyerName,
      nip: invoice.buyerTaxId,
      street: invoice.buyerStreet,
      city: invoice.buyerCity,
      postalCode: invoice.buyerPostalCode,
    },
    lines: items.map((item) => ({
      name: item.name,
      quantity: Number(item.quantity),
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      netCents: item.netCents,
      taxRateBps: item.taxRateBps,
      taxCents: item.taxCents,
      grossCents: item.grossCents,
    })),
    subtotalCents: invoice.subtotalCents,
    taxCents: invoice.taxCents,
    totalCents: invoice.totalCents,
    notes: invoice.notes,
  });
}

function validationErrors(invoice: Invoice, organization: { taxId: string | null } | null): string[] {
  const problems: string[] = [];
  if (!organization?.taxId) problems.push('brak NIP sprzedawcy w ustawieniach firmy');
  if (invoice.status === 'DRAFT') problems.push('faktura jest w statusie szkicu');
  if (invoice.status === 'CANCELLED') problems.push('faktura jest anulowana');
  return problems;
}

/** Wysyłka faktury do KSeF. Bezpieczna przy ponowieniu: najpierw sprawdza stan. */
export async function submitInvoiceToKsef(ctx: ServiceContext, invoiceId: string): Promise<KsefOperationResult> {
  const bundle = await loadInvoiceBundle(ctx.organizationId, invoiceId);
  if (!bundle) return { ok: false, error: 'Nie znaleziono faktury.' };
  const { invoice, items, organization } = bundle;

  if (!isKsefConfigured()) {
    return { ok: false, error: 'Integracja KSeF nie jest jeszcze skonfigurowana.', code: 'NOT_CONFIGURED' };
  }
  if (!organization) return { ok: false, error: 'Nie znaleziono danych firmy.' };

  const problems = validationErrors(invoice, organization);
  if (problems.length > 0) {
    return { ok: false, error: `Nie można wysłać faktury do KSeF: ${problems.join(', ')}.`, code: 'VALIDATION' };
  }

  // Bezpieczny retry: jeżeli faktura była już wysłana, najpierw ustalamy stan w KSeF.
  if (invoice.ksefReferenceNumber) {
    const refreshed = await refreshKsefStatus(ctx, invoiceId);
    if (!refreshed.ok) return refreshed;
    if (refreshed.status === 'ACCEPTED' || refreshed.status === 'PROCESSING' || refreshed.status === 'SUBMITTED') {
      return { ok: true, status: refreshed.status, ksefNumber: refreshed.ksefNumber, message: 'Faktura była już wysłana — odświeżono stan z KSeF.' };
    }
  }

  const xml = buildXml(invoice, items, organization);
  const idempotencyKey = createHash('sha256').update(xml).digest('hex').slice(0, 40);

  if (invoice.ksefIdempotencyKey === idempotencyKey && ['SUBMITTED', 'PROCESSING', 'ACCEPTED'].includes(invoice.ksefStatus)) {
    return { ok: true, status: invoice.ksefStatus, ksefNumber: invoice.ksefNumber, message: 'Dokument o tej treści został już przekazany do KSeF.' };
  }

  await db
    .update(invoices)
    .set({
      ksefStatus: 'SUBMITTING',
      ksefErrorMessage: null,
      ksefErrorCode: null,
      ksefMode: getKsefConfig()?.mode ?? null,
      ksefSubmittedAt: new Date(),
      ksefLastCheckedAt: new Date(),
      ksefIdempotencyKey: idempotencyKey,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));

  const result = await submitInvoice(xml);

  if (!result.ok) {
    await db
      .update(invoices)
      .set({
        ksefStatus: 'ERROR',
        ksefErrorCode: result.error.code,
        ksefErrorMessage: result.error.message,
        ksefLastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId));

    await writeAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: 'ksef.submit_failed',
      entityType: 'invoice',
      entityId: invoiceId,
      meta: { code: result.error.code, message: result.error.message },
    });

    return { ok: false, error: ksefMessage(result.error), code: result.error.code };
  }

  await db
    .update(invoices)
    .set({
      ksefStatus: 'SUBMITTED',
      ksefReferenceNumber: result.referenceNumber,
      ksefSubmittedAt: new Date(),
      ksefLastCheckedAt: new Date(),
      ksefErrorMessage: null,
      ksefErrorCode: null,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'ksef.submitted',
    entityType: 'invoice',
    entityId: invoiceId,
    meta: { referenceNumber: result.referenceNumber, mode: getKsefConfig()?.mode ?? null },
  });

  // po wysłaniu od razu pytamy o stan — „wysłane” to nie to samo co „przyjęte”
  return refreshKsefStatus(ctx, invoiceId);
}

/** Odświeżenie stanu faktury na podstawie KSeF. */
export async function refreshKsefStatus(ctx: ServiceContext, invoiceId: string): Promise<KsefOperationResult> {
  const bundle = await loadInvoiceBundle(ctx.organizationId, invoiceId);
  if (!bundle) return { ok: false, error: 'Nie znaleziono faktury.' };
  const { invoice } = bundle;

  if (!isKsefConfigured()) {
    return { ok: false, error: 'Integracja KSeF nie jest jeszcze skonfigurowana.', code: 'NOT_CONFIGURED' };
  }
  if (!invoice.ksefReferenceNumber) {
    return { ok: true, status: invoice.ksefStatus, ksefNumber: invoice.ksefNumber, message: 'Faktura nie została jeszcze wysłana do KSeF.' };
  }

  const status = await getInvoiceStatus(invoice.ksefReferenceNumber);
  const now = new Date();

  if (!status.ok) {
    await db
      .update(invoices)
      .set({
        ksefStatus: 'ERROR',
        ksefErrorCode: status.error.code,
        ksefErrorMessage: status.error.message,
        ksefLastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(invoices.id, invoiceId));
    return { ok: false, error: ksefMessage(status.error), code: status.error.code };
  }

  const patch: Partial<typeof invoices.$inferInsert> = {
    ksefStatus: status.state,
    ksefErrorCode: status.code === null ? null : String(status.code),
    ksefErrorMessage: status.description,
    ksefLastCheckedAt: now,
    updatedAt: now,
  };

  if (status.state === 'ACCEPTED') {
    patch.ksefAcceptedAt = now;
    // numer KSeF zapisujemy TYLKO wtedy, gdy KSeF go zwrócił
    if (status.ksefNumber) patch.ksefNumber = status.ksefNumber;
  }
  if (status.state === 'REJECTED') patch.ksefRejectedAt = now;
  if (status.state === 'PROCESSING' && !invoice.ksefSubmittedAt) patch.ksefSubmittedAt = now;

  await db.update(invoices).set(patch).where(eq(invoices.id, invoiceId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'ksef.status_refreshed',
    entityType: 'invoice',
    entityId: invoiceId,
    meta: { state: status.state, code: status.code, ksefNumber: status.ksefNumber },
  });

  const current = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  return { ok: true, status: status.state, ksefNumber: current[0]?.ksefNumber ?? null };
}

/** Pobranie UPO — oznaczamy dostępność dopiero po faktycznym pobraniu. */
export async function downloadKsefUpo(ctx: ServiceContext, invoiceId: string): Promise<KsefOperationResult> {
  const bundle = await loadInvoiceBundle(ctx.organizationId, invoiceId);
  if (!bundle) return { ok: false, error: 'Nie znaleziono faktury.' };
  const { invoice } = bundle;

  if (!isKsefConfigured()) {
    return { ok: false, error: 'Integracja KSeF nie jest jeszcze skonfigurowana.', code: 'NOT_CONFIGURED' };
  }
  if (invoice.ksefStatus !== 'ACCEPTED' || !invoice.ksefReferenceNumber) {
    return { ok: false, error: 'UPO jest dostępne dopiero dla faktury przyjętej przez KSeF.', code: 'NOT_ACCEPTED' };
  }

  const upo = await getUpo(invoice.ksefReferenceNumber);
  if (!upo.ok) {
    return { ok: false, error: upo.error.message, code: upo.error.code };
  }

  await saveFile({
    organizationId: ctx.organizationId,
    uploadedById: ctx.userId,
    originalName: `UPO-${invoice.number.replace(/\//g, '-')}.xml`,
    bytes: Buffer.from(upo.upoXml, 'utf8'),
    kind: 'KSEF_UPO',
    allowed: 'ANY',
  });

  await db
    .update(invoices)
    .set({ ksefUpoAvailable: true, ksefUpoDownloadedAt: new Date(), updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'ksef.upo_downloaded',
    entityType: 'invoice',
    entityId: invoiceId,
    meta: { referenceNumber: invoice.ksefReferenceNumber },
  });

  return { ok: true, status: invoice.ksefStatus, ksefNumber: invoice.ksefNumber, message: 'UPO pobrane i zapisane w plikach firmy.' };
}

/** Oznaczenie faktury jako gotowej do wysyłki (po przejściu walidacji). */
export async function markInvoiceReadyForKsef(ctx: ServiceContext, invoiceId: string): Promise<KsefOperationResult> {
  if (!isKsefConfigured()) {
    return { ok: false, error: 'Integracja KSeF nie jest jeszcze skonfigurowana.', code: 'NOT_CONFIGURED' };
  }
  const bundle = await loadInvoiceBundle(ctx.organizationId, invoiceId);
  if (!bundle) return { ok: false, error: 'Nie znaleziono faktury.' };

  const problems = validationErrors(bundle.invoice, bundle.organization);
  if (problems.length > 0) {
    return { ok: false, error: `Nie można oznaczyć jako gotową: ${problems.join(', ')}.`, code: 'VALIDATION' };
  }

  await db
    .update(invoices)
    .set({ ksefStatus: 'READY', ksefErrorMessage: null, ksefErrorCode: null, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  return { ok: true, status: 'READY', message: 'Faktura oznaczona jako gotowa do wysłania.' };
}

function ksefMessage(error: KsefError): string {
  switch (error.code) {
    case 'NOT_CONFIGURED':
      return 'Integracja KSeF nie jest jeszcze skonfigurowana.';
    case 'TIMEOUT':
      return `${error.message} Spróbuj odświeżyć stan za chwilę.`;
    case 'NETWORK':
      return `${error.message} Sprawdź połączenie i spróbuj ponownie.`;
    case '401':
    case '403':
      return 'KSeF odrzucił autoryzację. Sprawdź token i NIP w konfiguracji.';
    default:
      return error.message;
  }
}
