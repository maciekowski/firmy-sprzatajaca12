/**
 * Budowanie dokumentów PDF z rzeczywistych danych (oferta, faktura).
 * Plik jest generowany prawdziwym generatorem PDF (pdfkit) — bez „udawanych” dokumentów.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { customers, invoices, invoiceItems, organizations, quotes, quoteItems } from '@/lib/db/schema';
import { renderDocumentPdf, unitLabelPl, type PdfDocumentInput } from './document';

type Org = typeof organizations.$inferSelect;
type Customer = typeof customers.$inferSelect;

function sellerFrom(org: Org) {
  return {
    name: org.name,
    lines: [org.street, [org.postalCode, org.city].filter(Boolean).join(' '), org.phone, org.email, org.taxId ? `NIP ${org.taxId}` : null],
    taxId: org.taxId,
  };
}

function buyerFrom(customer: Customer) {
  return {
    name: customer.displayName,
    lines: [customer.street, [customer.postalCode, customer.city].filter(Boolean).join(' '), customer.phone, customer.email],
    taxId: customer.taxId,
  };
}

export async function buildQuotePdf(organizationId: string, quoteId: string): Promise<{ filename: string; bytes: Buffer } | null> {
  const orgRows = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const organization = orgRows[0];
  if (!organization) return null;

  const quoteRows = await db.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.organizationId, organizationId))).limit(1);
  const quote = quoteRows[0];
  if (!quote) return null;

  const customerRows = await db.select().from(customers).where(eq(customers.id, quote.customerId)).limit(1);
  const customer = customerRows[0];
  if (!customer) return null;

  const items = await db.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));

  const input: PdfDocumentInput = {
    title: 'OFERTA',
    number: quote.number,
    issueDate: quote.createdAt,
    validUntil: quote.validUntil,
    seller: sellerFrom(organization),
    buyer: buyerFrom(customer),
    serviceAddress: [quote.addressLabel, quote.addressStreet, quote.addressCity].filter(Boolean).join(', ') || null,
    lines: items.map((item) => ({
      name: item.name,
      description: item.description,
      quantity: item.quantity.replace(/\.0+$/, ''),
      unit: unitLabelPl(item.unit, item.customUnitLabel),
      unitPriceCents: item.unitPriceCents,
      netCents: item.netCents - item.discountCents,
      taxRateBps: item.taxRateBps,
      taxCents: item.taxCents,
      grossCents: item.grossCents,
    })),
    totals: {
      subtotalCents: quote.subtotalCents,
      discountCents: quote.discountCents,
      travelCents: quote.travelCents,
      urgencyFeeCents: quote.urgencyFeeCents,
      taxCents: quote.taxCents,
      totalCents: quote.totalCents,
    },
    notes: quote.notes,
    terms: quote.terms,
    currency: quote.currency ?? organization.currency,
    footerNote: `${organization.name} · oferta wygenerowana w ServiceFlow`,
  };

  const bytes = await renderDocumentPdf(input);
  return { filename: `oferta-${quote.number.replace(/\//g, '-')}.pdf`, bytes };
}

export async function buildInvoicePdf(organizationId: string, invoiceId: string): Promise<{ filename: string; bytes: Buffer } | null> {
  const orgRows = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const organization = orgRows[0];
  if (!organization) return null;

  const invoiceRows = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId))).limit(1);
  const invoice = invoiceRows[0];
  if (!invoice) return null;

  const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));

  const input: PdfDocumentInput = {
    title: 'FAKTURA',
    number: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    seller: sellerFrom(organization),
    buyer: {
      name: invoice.buyerName,
      lines: [invoice.buyerStreet, [invoice.buyerPostalCode, invoice.buyerCity].filter(Boolean).join(' ')],
      taxId: invoice.buyerTaxId,
    },
    lines: items.map((item) => ({
      name: item.name,
      description: item.description,
      quantity: item.quantity.replace(/\.0+$/, ''),
      unit: unitLabelPl(item.unit, item.customUnitLabel),
      unitPriceCents: item.unitPriceCents,
      netCents: item.netCents,
      taxRateBps: item.taxRateBps,
      taxCents: item.taxCents,
      grossCents: item.grossCents,
    })),
    totals: {
      subtotalCents: invoice.subtotalCents,
      discountCents: 0,
      travelCents: 0,
      urgencyFeeCents: 0,
      taxCents: invoice.taxCents,
      totalCents: invoice.totalCents,
      paidCents: invoice.paidCents,
      dueCents: invoice.totalCents - invoice.paidCents,
    },
    notes: invoice.notes,
    terms: `Termin płatności: ${invoice.dueDate.toLocaleDateString('pl-PL')}`,
    currency: invoice.currency ?? organization.currency,
    footerNote: `${organization.name} · faktura wygenerowana w ServiceFlow`,
  };

  const bytes = await renderDocumentPdf(input);
  return { filename: `faktura-${invoice.number.replace(/\//g, '-')}.pdf`, bytes };
}
