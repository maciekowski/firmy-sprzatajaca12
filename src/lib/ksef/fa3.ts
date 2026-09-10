/**
 * Budowa dokumentu faktury w strukturze FA(3) (KSeF).
 *
 * Dane pochodzą wyłącznie z rekordu faktury i danych firmy —
 * żadnych przykładowych wartości, żadnych wyliczeń „na oko”.
 */

export type Fa3Seller = {
  name: string;
  nip: string;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type Fa3Buyer = {
  name: string;
  nip?: string | null;
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  email?: string | null;
};

export type Fa3Line = {
  name: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  netCents: number;
  taxRateBps: number;
  taxCents: number;
  grossCents: number;
};

export type Fa3Input = {
  number: string;
  issueDate: Date;
  dueDate?: Date | null;
  currency: string;
  seller: Fa3Seller;
  buyer: Fa3Buyer;
  lines: Fa3Line[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes?: string | null;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .slice(0, 512);
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Stawka VAT w kodzie KSeF: 23% → „23”, 8% → „08” itd. */
function taxRateCode(taxRateBps: number): string {
  const percent = Math.round(taxRateBps / 100);
  return String(percent).padStart(2, '0');
}

export function buildFa3Xml(input: Fa3Input): string {
  const lines = input.lines
    .map(
      (line, index) => `    <Fa:FaWiersz>
      <Fa:NrWierszaFa>${index + 1}</Fa:NrWierszaFa>
      <Fa:P_7>${escapeXml(line.name)}</Fa:P_7>
      <Fa:P_8A>${escapeXml(line.unit || 'usl.')}</Fa:P_8A>
      <Fa:P_8B>${line.quantity}</Fa:P_8B>
      <Fa:P_9A>${money(line.unitPriceCents)}</Fa:P_9A>
      <Fa:P_11>${money(line.netCents)}</Fa:P_11>
      <Fa:P_12>${taxRateCode(line.taxRateBps)}</Fa:P_12>
    </Fa:FaWiersz>`,
    )
    .join('\n');

  const taxSummary = new Map<string, { net: number; tax: number }>();
  for (const line of input.lines) {
    const code = taxRateCode(line.taxRateBps);
    const current = taxSummary.get(code) ?? { net: 0, tax: 0 };
    current.net += line.netCents;
    current.tax += line.taxCents;
    taxSummary.set(code, current);
  }

  const summary = [...taxSummary.entries()]
    .map(
      ([code, value], index) => `    <Fa:Deklaracja>
      <Fa:NrWierszaDek>${index + 1}</Fa:NrWierszaDek>
      <Fa:P_13_1>${money(value.net)}</Fa:P_13_1>
      <Fa:P_14_1>${money(value.tax)}</Fa:P_14_1>
      <Fa:P_13_2>${code}</Fa:P_13_2>
    </Fa:Deklaracja>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns:Fa="http://crd.gov.pl/wzor/2023/06/29/12648/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Fa:Naglowek>
    <Fa:KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</Fa:KodFormularza>
    <Fa:WariantFormularza>3</Fa:WariantFormularza>
    <Fa:DataWytworzeniaFa>${new Date().toISOString().slice(0, 10)}</Fa:DataWytworzeniaFa>
    <Fa:SystemInfo>ServiceFlow</Fa:SystemInfo>
  </Fa:Naglowek>
  <Fa:Podmiot1>
    <Fa:DaneIdentyfikacyjne>
      <Fa:NIP>${escapeXml(input.seller.nip)}</Fa:NIP>
      <Fa:Nazwa>${escapeXml(input.seller.name)}</Fa:Nazwa>
    </Fa:DaneIdentyfikacyjne>
    <Fa:Adres>
      <Fa:KodKraju>PL</Fa:KodKraju>
      <Fa:AdresL1>${escapeXml([input.seller.street, input.seller.postalCode, input.seller.city].filter(Boolean).join(' '))}</Fa:AdresL1>
    </Fa:Adres>
    ${input.seller.email ? `<Fa:DaneKontaktowe><Fa:Email>${escapeXml(input.seller.email)}</Fa:Email></Fa:DaneKontaktowe>` : ''}
  </Fa:Podmiot1>
  <Fa:Podmiot2>
    <Fa:DaneIdentyfikacyjne>
      ${input.buyer.nip ? `<Fa:NIP>${escapeXml(input.buyer.nip)}</Fa:NIP>` : '<Fa:BrakID>1</Fa:BrakID>'}
      <Fa:Nazwa>${escapeXml(input.buyer.name)}</Fa:Nazwa>
    </Fa:DaneIdentyfikacyjne>
    <Fa:Adres>
      <Fa:KodKraju>PL</Fa:KodKraju>
      <Fa:AdresL1>${escapeXml([input.buyer.street, input.buyer.postalCode, input.buyer.city].filter(Boolean).join(' '))}</Fa:AdresL1>
    </Fa:Adres>
  </Fa:Podmiot2>
  <Fa:Fa>
    <Fa:KodWaluty>${escapeXml(input.currency)}</Fa:KodWaluty>
    <Fa:P_1>${isoDate(input.issueDate)}</Fa:P_1>
    <Fa:P_2>${escapeXml(input.number)}</Fa:P_2>
    ${input.dueDate ? `<Fa:P_6>${isoDate(input.dueDate)}</Fa:P_6>` : ''}
    <Fa:P_13_1>${money(input.subtotalCents)}</Fa:P_13_1>
    <Fa:P_15>${money(input.totalCents)}</Fa:P_15>
    <Fa:RodzajFaktury>VAT</Fa:RodzajFaktury>
${lines}
${summary}
  </Fa:Fa>
  ${input.notes ? `<Fa:Stopka><Fa:Uwagi><Fa:Uwaga><Fa:P_20>${escapeXml(input.notes)}</Fa:P_20></Fa:Uwaga></Fa:Uwagi></Fa:Stopka>` : ''}
</Faktura>`;
}

/** Skrót dokumentu (SHA-256) wymagany przez API KSeF. */
export async function sha256Base64(content: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(content, 'utf8').digest('base64');
}
