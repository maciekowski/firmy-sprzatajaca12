'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { cancelInvoice, createInvoice, createInvoiceFromJob, markInvoiceSent, recordPayment } from '@/lib/services/invoices';
import { enqueueAutomations } from '@/lib/automation/engine';

const PAYMENT_METHODS = new Set(['CASH', 'BANK_TRANSFER', 'CARD', 'STRIPE', 'OTHER']);

export async function createInvoiceFromJobAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('invoice:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const jobId = String(formData.get('jobId') ?? '');

  const result = await createInvoiceFromJob(ctx, jobId);
  if (!result.ok) redirect(`/faktury?blad=${encodeURIComponent(result.error)}`);

  revalidatePath('/faktury');
  redirect(`/faktury/${result.data!.id}`);
}

export async function createInvoiceAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('invoice:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  const customerId = String(formData.get('customerId') ?? '');
  const names = formData.getAll('name').map(String);
  const quantities = formData.getAll('quantity').map(String);
  const prices = formData.getAll('unitPrice').map(String);

  const lines = names
    .map((name, index) => ({
      name,
      description: null,
      quantity: Number(quantities[index] ?? 0),
      unitPriceCents: Math.round(Number(prices[index] ?? 0) * 100),
      unit: 'SERVICE',
      taxRateBps: context.organization.taxRateBps,
    }))
    .filter((line) => line.name.trim() && line.quantity > 0);

  if (!customerId || lines.length === 0) {
    redirect('/faktury/nowa?blad=Nie%20podano%20klienta%20ani%20pozycji');
  }

  const paymentDays = Number(formData.get('paymentDays') ?? 14) || 14;
  const result = await createInvoice(ctx, {
    customerId,
    jobId: formData.get('jobId') ? String(formData.get('jobId')) : null,
    notes: String(formData.get('notes') ?? '') || null,
    dueDate: new Date(Date.now() + paymentDays * 24 * 60 * 60 * 1000),
    lines,
  });

  if (!result.ok) redirect(`/faktury/nowa?blad=${encodeURIComponent(result.error)}`);

  revalidatePath('/faktury');
  redirect(`/faktury/${result.data!.id}`);
}

export async function markInvoiceSentAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('invoice:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const invoiceId = String(formData.get('invoiceId') ?? '');

  const result = await markInvoiceSent(ctx, invoiceId);
  if (!result.ok) redirect(`/faktury/${invoiceId}?blad=${encodeURIComponent(result.error)}`);

  await enqueueAutomations({ organizationId: context.organization.id, trigger: 'INVOICE_SENT', targetType: 'invoice', targetId: invoiceId });

  revalidatePath(`/faktury/${invoiceId}`);
  redirect(`/faktury/${invoiceId}?wynik=wyslano`);
}

export async function recordPaymentAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('invoice:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const invoiceId = String(formData.get('invoiceId') ?? '');

  const amountCents = Math.round(Number(formData.get('amount') ?? 0) * 100);
  const methodRaw = String(formData.get('method') ?? 'BANK_TRANSFER');
  const method = (PAYMENT_METHODS.has(methodRaw) ? methodRaw : 'OTHER') as 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'STRIPE' | 'OTHER';

  const result = await recordPayment(ctx, invoiceId, {
    amountCents,
    method,
    reference: String(formData.get('reference') ?? '') || null,
    note: String(formData.get('note') ?? '') || null,
  });

  if (!result.ok) redirect(`/faktury/${invoiceId}?blad=${encodeURIComponent(result.error)}`);

  if (result.data?.status === 'PAID') {
    await enqueueAutomations({ organizationId: context.organization.id, trigger: 'INVOICE_PAID', targetType: 'invoice', targetId: invoiceId });
  }

  revalidatePath(`/faktury/${invoiceId}`);
  revalidatePath('/faktury');
  redirect(`/faktury/${invoiceId}?wynik=platnosc`);
}

export async function cancelInvoiceAction(formData: FormData): Promise<void> {
  const context = await requirePermissionOrThrow('invoice:write');
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };
  const invoiceId = String(formData.get('invoiceId') ?? '');

  const result = await cancelInvoice(ctx, invoiceId);
  revalidatePath(`/faktury/${invoiceId}`);
  redirect(result.ok ? `/faktury/${invoiceId}?wynik=anulowano` : `/faktury/${invoiceId}?blad=${encodeURIComponent(result.error)}`);
}
