/**
 * Eksport JPK_FA — Jednolity Plik Kontrolny dla faktur sprzedaży (schemat JPK_FA(3)).
 *
 * Zasady:
 *  - plik powstaje WYŁĄCZNIE z danych zapisanych w bazie (żadnych wymyślonych kwot),
 *  - faktury robocze (DRAFT) i anulowane nie są eksportowane,
 *  - kwoty są przeliczane z groszy na złote z dokładnością do 2 miejsc (deterministycznie),
 *  - brak NIP firmy lub faktur w okresie = błąd z jasną informacją (nie generujemy pustego pliku).
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { customers, invoiceItems, invoices, organizations } from '@/lib/db/schema';

export type JpkResult = { ok: true; xml: string; fileName: string; invoiceCount: number } | { ok: false; error: string };

function esc(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function money(cents: number | null | undefined): string {
  return (Math.round(cents ?? 0) / 100).toFixed(2);
}

function dateIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function splitStreet(street: string | null): { street: string; number: string } {
  if (!street) return { street: '', number: '' };
  const match = street.trim().match(/^(.*?)\s*(\d+[\w/.-]*)$/);
  if (!match) return { street: street.trim(), number: '' };
  return { street: match[1]!.trim(), number: match[2]! };
}

/**
 * Generuje JPK_FA za wskazany okres (daty wystawienia).
 * Zwraca XML zgodny z układem nagłówka, podmiotu i wierszy faktur.
 */
export async function generateJpkFa(organizationId: string, from: Date, to: Date): Promise<JpkResult> {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, error: 'Podaj poprawny zakres dat.' };
  }
  if (from.getTime() > to.getTime()) {
    return { ok: false, error: 'Data początkowa nie może być późniejsza niż końcowa.' };
  }

  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) return { ok: false, error: 'Nie znaleziono firmy.' };

  // NIP firmy jest wymagany przez schemat — bez niego plik byłby odrzucony
  const nip = (organization.taxId ?? '').replace(/[^0-9]/g, '');
  if (nip.length !== 10) {
    return { ok: false, error: 'Uzupełnij NIP firmy w ustawieniach — bez niego JPK_FA zostanie odrzucony.' };
  }

  const rows = await db
    .select({ invoice: invoices, customer: customers })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
        // eksportujemy wyłącznie faktury, które istnieją w obrocie
        inArray(invoices.status, ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE']),
      ),
    )
    .orderBy(asc(invoices.issueDate));

  if (rows.length === 0) {
    return { ok: false, error: 'W tym okresie nie ma faktur do eksportu.' };
  }

  const sellerStreet = splitStreet(organization.street);

  const lines: string[] = [];
  let totalNet = 0;
  let totalTax = 0;

  for (const row of rows) {
    const invoice = row.invoice;
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));

    const isCompany = Boolean(invoice.buyerTaxId);

    lines.push('    <Faktura>');
    lines.push(`      <KodWaluty>${esc(organization.currency ?? 'PLN')}</KodWaluty>`);
    lines.push('      <P_1>' + esc(dateIso(invoice.issueDate)) + '</P_1>');
    lines.push('      <P_2A>' + esc(invoice.number) + '</P_2A>');
    lines.push('      <P_3A>' + esc(invoice.buyerName) + '</P_3A>');
    lines.push('      <P_3B>' + esc(invoice.buyerStreet ?? row.customer.street ?? '') + '</P_3B>');
    lines.push('      <P_3C>' + esc(isCompany ? (invoice.buyerTaxId ?? '') : '') + '</P_3C>');
    lines.push('      <P_4A>' + esc(organization.name) + '</P_4A>');
    lines.push('      <P_4B>' + esc(organization.street ?? '') + '</P_4B>');
    lines.push('      <P_5A>' + esc(nip) + '</P_5A>');
    lines.push('      <P_6A>' + esc(dateIso(invoice.dueDate)) + '</P_6A>');

    for (const item of items) {
      const rate = (item.taxRateBps ?? 0) / 100;

      lines.push('      <FakturaWiersz>');
      lines.push(`        <P_2B>${esc(invoice.number)}</P_2B>`);
      lines.push(`        <P_7>${esc(item.name)}</P_7>`);
      lines.push(`        <P_8A>${esc(String(item.unit === 'VISIT' ? 'usł.' : item.unit.toLowerCase()))}</P_8A>`);
      lines.push(`        <P_8B>${esc(String(Number(item.quantity ?? 1)))}</P_8B>`);
      lines.push(`        <P_9A>${money(item.unitPriceCents)}</P_9A>`);
      lines.push(`        <P_11>${money(item.netCents)}</P_11>`);
      lines.push(`        <P_12>${rate === 0 ? '0' : rate.toFixed(0)}</P_12>`);
      lines.push(`        <P_11A>${money(item.grossCents)}</P_11A>`);
      lines.push('      </FakturaWiersz>');
    }

    lines.push(`      <P_13_1>${money(invoice.subtotalCents)}</P_13_1>`);
    lines.push(`      <P_14_1>${money(invoice.taxCents)}</P_14_1>`);
    lines.push(`      <P_15>${money(invoice.totalCents)}</P_15>`);
    lines.push(`      <P_16>false</P_16>`); // kasowa metoda rozliczenia
    lines.push(`      <P_17>false</P_17>`); // samofakturowanie
    lines.push(`      <P_18>false</P_18>`); // odwrotne obciążenie
    lines.push(`      <P_19>false</P_19>`); // mechanizm podzielonej płatności — według danych płatności
    lines.push('    </Faktura>');

    totalNet += Number(invoice.subtotalCents ?? 0);
    totalTax += Number(invoice.taxCents ?? 0);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<JPK xmlns="http://jpk.mf.gov.pl/wzor/2023/06/29/06271/" xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2016/01/25/eD/DefinicjeTypy/">
  <Naglowek>
    <KodFormularza kodSystemowy="JPK_FA (3)" wersjaSchemy="1-0">JPK_FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
    <DataOd>${dateIso(from)}</DataOd>
    <DataDo>${dateIso(to)}</DataDo>
    <NazwaSystemu>ServiceFlow</NazwaSystemu>
    <CelZlozenia>1</CelZlozenia>
  </Naglowek>
  <Podmiot1>
    <NIP>${esc(nip)}</NIP>
    <PelnaNazwa>${esc(organization.name)}</PelnaNazwa>
    <AdresPodmiotu>
      <KodKraju>PL</KodKraju>
      <Wojewodztwo></Wojewodztwo>
      <Powiat></Powiat>
      <Gmina></Gmina>
      <Ulica>${esc(sellerStreet.street)}</Ulica>
      <NrDomu>${esc(sellerStreet.number)}</NrDomu>
      <Miejscowosc>${esc(organization.city ?? '')}</Miejscowosc>
      <KodPocztowy>${esc((organization.postalCode ?? '').replace(/-/g, ''))}</KodPocztowy>
      <Poczta>${esc(organization.city ?? '')}</Poczta>
    </AdresPodmiotu>
  </Podmiot1>
${lines.join('\n')}
  <FakturaCtrl>
    <LiczbaFaktur>${rows.length}</LiczbaFaktur>
    <WartoscFaktur>${money(rows.reduce((sum, row) => sum + Number(row.invoice.totalCents ?? 0), 0))}</WartoscFaktur>
  </FakturaCtrl>
  <FakturaWierszCtrl>
    <LiczbaWierszyFaktur>${countXmlTag(lines, '<FakturaWiersz>')}</LiczbaWierszyFaktur>
    <WartoscWierszyFaktur>${money(totalNet + totalTax)}</WartoscWierszyFaktur>
  </FakturaWierszCtrl>
</JPK>
`;

  return {
    ok: true,
    xml,
    fileName: `JPK_FA_${nip}_${dateIso(from)}_${dateIso(to)}.xml`,
    invoiceCount: rows.length,
  };
}

function countXmlTag(lines: string[], tag: string): number {
  return lines.filter((line) => line.includes(tag)).length;
}
