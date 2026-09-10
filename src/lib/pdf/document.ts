/**
 * Generowanie prawdziwych dokumentów PDF (pdfkit).
 * Żadnych „udawanych” PDF-ów — wynikiem jest poprawny plik binarny.
 */
import PDFDocument from 'pdfkit';
import { formatMoney } from '@/lib/money';

export type PdfParty = {
  name: string;
  lines: (string | null | undefined)[];
  taxId?: string | null;
};

export type PdfLine = {
  name: string;
  description?: string | null;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  netCents: number;
  taxRateBps: number;
  taxCents: number;
  grossCents: number;
};

export type PdfTotals = {
  subtotalCents: number;
  discountCents: number;
  travelCents: number;
  urgencyFeeCents: number;
  taxCents: number;
  totalCents: number;
  paidCents?: number;
  dueCents?: number;
};

export type PdfDocumentInput = {
  title: string;
  number: string;
  issueDate: Date;
  validUntil?: Date | null;
  dueDate?: Date | null;
  seller: PdfParty;
  buyer: PdfParty;
  serviceAddress?: string | null;
  lines: PdfLine[];
  totals: PdfTotals;
  notes?: string | null;
  terms?: string | null;
  currency?: string;
  taxBreakdown?: { taxRateBps: number; netCents: number; taxCents: number }[];
  footerNote?: string | null;
};

const MARGIN = 48;
const PRIMARY = '#1c5cf5';
const INK = '#22252f';
const MUTED = '#657694';

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatPercent(bps: number): string {
  return `${(bps / 100).toString().replace('.', ',')}%`;
}

function nonEmpty(lines: (string | null | undefined)[]): string[] {
  return lines.filter((line): line is string => Boolean(line && String(line).trim().length > 0));
}

/** Buduje dokument PDF i zwraca go jako Buffer. */
export function renderDocumentPdf(input: PdfDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const currency = input.currency ?? 'PLN';
      const money = (cents: number) => formatMoney(cents, currency);
      const pageWidth = doc.page.width - MARGIN * 2;

      // --- nagłówek -------------------------------------------------------
      doc.rect(MARGIN, MARGIN, pageWidth, 4).fill(PRIMARY);
      doc.moveDown(1.2);

      const headerTop = doc.y;
      doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(input.title, MARGIN, headerTop);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(MUTED)
        .text(`Numer: ${input.number}`, MARGIN, headerTop + 26)
        .text(`Data wystawienia: ${formatDate(input.issueDate)}`, MARGIN, headerTop + 40);

      let rightY = headerTop + 26;
      if (input.validUntil) {
        doc.text(`Termin ważności: ${formatDate(input.validUntil)}`, MARGIN, headerTop + 54);
        rightY = headerTop + 54;
      }
      if (input.dueDate) {
        doc.text(`Termin płatności: ${formatDate(input.dueDate)}`, MARGIN, rightY + 14);
      }

      // sprzedawca / nabywca
      doc.y = Math.max(doc.y, headerTop + 80) + 10;
      const partiesTop = doc.y;
      const columnWidth = pageWidth / 2 - 12;

      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Wystawca', MARGIN, partiesTop);
      let sellerY = partiesTop + 14;
      doc.font('Helvetica').fontSize(9).fillColor(INK);
      doc.text(input.seller.name, MARGIN, sellerY, { width: columnWidth });
      sellerY = doc.y + 2;
      for (const line of nonEmpty(input.seller.lines)) {
        doc.text(line, MARGIN, sellerY, { width: columnWidth });
        sellerY = doc.y + 1;
      }
      if (input.seller.taxId) {
        doc.text(`NIP: ${input.seller.taxId}`, MARGIN, sellerY, { width: columnWidth });
      }

      const buyerX = MARGIN + columnWidth + 24;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Nabywca', buyerX, partiesTop);
      let buyerY = partiesTop + 14;
      doc.font('Helvetica').fontSize(9).fillColor(INK);
      doc.text(input.buyer.name, buyerX, buyerY, { width: columnWidth });
      buyerY = doc.y + 2;
      for (const line of nonEmpty(input.buyer.lines)) {
        doc.text(line, buyerX, buyerY, { width: columnWidth });
        buyerY = doc.y + 1;
      }
      if (input.buyer.taxId) {
        doc.text(`NIP: ${input.buyer.taxId}`, buyerX, buyerY, { width: columnWidth });
      }

      doc.y = Math.max(sellerY, buyerY, doc.y) + 18;

      if (input.serviceAddress) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Adres realizacji', MARGIN, doc.y);
        doc.font('Helvetica').fontSize(9).fillColor(INK).text(input.serviceAddress, MARGIN, doc.y + 12, {
          width: pageWidth,
        });
        doc.moveDown(1);
      }

      // --- tabela pozycji -------------------------------------------------
      const tableTop = doc.y + 6;
      const colX = {
        name: MARGIN,
        qty: MARGIN + pageWidth * 0.42,
        unit: MARGIN + pageWidth * 0.55,
        net: MARGIN + pageWidth * 0.66,
        vat: MARGIN + pageWidth * 0.79,
        gross: MARGIN + pageWidth * 0.89,
      };

      const drawHeader = () => {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
        doc.text('Nazwa', colX.name, tableTop, { width: pageWidth * 0.4 });
        doc.text('Ilość', colX.qty, tableTop, { width: pageWidth * 0.1, align: 'right' });
        doc.text('Cena', colX.unit, tableTop, { width: pageWidth * 0.1, align: 'right' });
        doc.text('Netto', colX.net, tableTop, { width: pageWidth * 0.12, align: 'right' });
        doc.text('VAT', colX.vat, tableTop, { width: pageWidth * 0.09, align: 'right' });
        doc.text('Brutto', colX.gross, tableTop, { width: pageWidth * 0.11, align: 'right' });
        doc
          .moveTo(MARGIN, tableTop + 13)
          .lineTo(MARGIN + pageWidth, tableTop + 13)
          .strokeColor('#d5dae3')
          .lineWidth(0.8)
          .stroke();
      };

      drawHeader();
      let rowY = tableTop + 20;
      doc.font('Helvetica').fontSize(9).fillColor(INK);

      for (const line of input.lines) {
        const nameHeight = doc.heightOfString(line.name, { width: pageWidth * 0.4 });
        if (rowY + Math.max(nameHeight, 14) > doc.page.height - MARGIN - 140) {
          doc.addPage();
          rowY = MARGIN;
          drawHeader();
          rowY = MARGIN + 20;
        }
        const unitLabel = unitLabelPl(line.unit);
        doc.text(line.name, colX.name, rowY, { width: pageWidth * 0.4 });
        if (line.description) {
          doc.fontSize(7.5).fillColor(MUTED);
          doc.text(line.description, colX.name, doc.y, { width: pageWidth * 0.4 });
          doc.fontSize(9).fillColor(INK);
        }
        doc.text(line.quantity, colX.qty, rowY, { width: pageWidth * 0.1, align: 'right' });
        doc.text(money(line.unitPriceCents), colX.unit, rowY, { width: pageWidth * 0.1, align: 'right' });
        doc.text(money(line.netCents), colX.net, rowY, { width: pageWidth * 0.12, align: 'right' });
        doc.text(formatPercent(line.taxRateBps), colX.vat, rowY, { width: pageWidth * 0.09, align: 'right' });
        doc.text(money(line.grossCents), colX.gross, rowY, { width: pageWidth * 0.11, align: 'right' });
        if (unitLabel && unitLabel !== 'szt.') {
          doc.fontSize(7.5).fillColor(MUTED).text(unitLabel, colX.qty, doc.y, { width: pageWidth * 0.1, align: 'right' });
          doc.fontSize(9).fillColor(INK);
        }
        rowY = doc.y + 6;
        doc
          .moveTo(MARGIN, rowY - 2)
          .lineTo(MARGIN + pageWidth, rowY - 2)
          .strokeColor('#eceef2')
          .lineWidth(0.5)
          .stroke();
        rowY += 6;
      }

      // --- podsumowanie ---------------------------------------------------
      const summaryTop = Math.max(rowY + 10, doc.page.height - MARGIN - 190);
      const summaryX = MARGIN + pageWidth * 0.55;
      const summaryWidth = pageWidth * 0.45;
      let summaryY = summaryTop;

      const summaryRow = (label: string, value: string, bold = false, color = INK) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(color);
        doc.text(label, summaryX, summaryY, { width: summaryWidth * 0.55 });
        doc.text(value, summaryX + summaryWidth * 0.55, summaryY, { width: summaryWidth * 0.45, align: 'right' });
        summaryY = doc.y + 4;
      };

      summaryRow('Suma netto', money(input.totals.subtotalCents));
      if (input.totals.discountCents > 0) summaryRow('Rabat', `-${money(input.totals.discountCents)}`);
      if (input.totals.travelCents > 0) summaryRow('Dojazd', money(input.totals.travelCents));
      if (input.totals.urgencyFeeCents > 0) summaryRow('Dopłata za pilność', money(input.totals.urgencyFeeCents));
      summaryRow('Podatek VAT', money(input.totals.taxCents));
      summaryY += 2;
      doc
        .moveTo(summaryX, summaryY)
        .lineTo(MARGIN + pageWidth, summaryY)
        .strokeColor('#d5dae3')
        .lineWidth(0.8)
        .stroke();
      summaryY += 8;
      summaryRow('RAZEM', money(input.totals.totalCents), true, PRIMARY);
      if (typeof input.totals.paidCents === 'number' && input.totals.paidCents > 0) {
        summaryRow('Zapłacono', money(input.totals.paidCents));
        summaryRow('Pozostało', money(input.totals.dueCents ?? input.totals.totalCents - input.totals.paidCents), true);
      }

      // rozbicie stawek VAT
      if (input.taxBreakdown && input.taxBreakdown.length > 0) {
        let vatY = Math.max(summaryY + 12, doc.y + 12);
        if (vatY > doc.page.height - MARGIN - 60) {
          doc.addPage();
          vatY = MARGIN;
        }
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('Rozbicie podatku', MARGIN, vatY);
        let lineY = vatY + 12;
        doc.font('Helvetica').fontSize(8.5).fillColor(INK);
        for (const entry of input.taxBreakdown) {
          doc.text(
            `${formatPercent(entry.taxRateBps)}: netto ${money(entry.netCents)} · VAT ${money(entry.taxCents)}`,
            MARGIN,
            lineY,
          );
          lineY = doc.y + 2;
        }
      }

      // uwagi i warunki
      if (input.notes || input.terms) {
        let notesY = doc.y + 16;
        if (notesY > doc.page.height - MARGIN - 90) {
          doc.addPage();
          notesY = MARGIN;
        }
        if (input.notes) {
          doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Uwagi', MARGIN, notesY);
          doc.font('Helvetica').fontSize(9).fillColor(INK).text(input.notes, MARGIN, notesY + 12, {
            width: pageWidth * 0.9,
          });
          notesY = doc.y + 10;
        }
        if (input.terms) {
          doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Warunki', MARGIN, notesY);
          doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(input.terms, MARGIN, notesY + 12, {
            width: pageWidth * 0.9,
          });
        }
      }

      // stopka
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(
            input.footerNote ?? 'Dokument wygenerowany w systemie ServiceFlow.',
            MARGIN,
            doc.page.height - MARGIN - 10,
            { width: pageWidth, align: 'center', lineBreak: false },
          );
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export function unitLabelPl(unit: string, custom?: string | null): string {
  if (unit === 'CUSTOM') return custom ?? 'usł.';
  const map: Record<string, string> = {
    HOUR: 'godz.',
    SQM: 'm²',
    PIECE: 'szt.',
    ROOM: 'pom.',
    VEHICLE: 'auto',
    VISIT: 'wizyta',
    FIXED: 'usł.',
  };
  return map[unit] ?? unit.toLowerCase();
}
