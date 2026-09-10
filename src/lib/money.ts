/**
 * Operacje finansowe — ZAWSZE deterministyczne, na liczbach całkowitych (grosze).
 *
 * Zasady:
 *  - kwoty przechowujemy i liczymy w groszach (integer),
 *  - procenty przechowujemy w punktach bazowych (bps): 2300 = 23,00%,
 *  - zaokrąglanie: „pół w górę” (half-up) dla wartości dodatnich, symetrycznie dla ujemnych,
 *  - do mnożenia przez bps używamy BigInt, żeby wykluczyć błędy zmiennoprzecinkowe.
 */

export const CENTS_PER_UNIT = 100;

/** 2300 bps = 23,00% */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/** 23 (%) => 2300 bps */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

/**
 * Mnożenie kwoty przez stawkę w bps z zaokrągleniem half-up.
 * Przykład: mulBps(60000, 2300) = 13800  (600,00 zł * 23% = 138,00 zł)
 */
export function mulBps(valueCents: number, bps: number): number {
  if (!Number.isFinite(valueCents) || !Number.isFinite(bps)) {
    throw new Error('Nieprawidłowe dane finansowe: wartość lub stawka nie jest liczbą.');
  }
  if (bps === 0 || valueCents === 0) return 0;
  const negative = valueCents < 0 !== bps < 0;
  const a = BigInt(Math.abs(Math.trunc(valueCents)));
  const b = BigInt(Math.abs(Math.trunc(bps)));
  const denominator = 10_000n;
  // half-up: (|a|*|b| + 5000) / 10000
  const result = (a * b + denominator / 2n) / denominator;
  return negative ? -Number(result) : Number(result);
}

/** Kwota netto + podatek = brutto. */
export function addTax(netCents: number, taxRateBps: number): number {
  return netCents + mulBps(netCents, taxRateBps);
}

/** Kwota brutto -> netto (przy podanej stawce). */
export function netFromGross(grossCents: number, taxRateBps: number): number {
  if (!Number.isFinite(grossCents) || !Number.isFinite(taxRateBps)) {
    throw new Error('Nieprawidłowe dane finansowe.');
  }
  const denominator = 10_000n + BigInt(Math.trunc(taxRateBps));
  if (denominator <= 0n) throw new Error('Nieprawidłowa stawka podatku.');
  const negative = grossCents < 0;
  const value = BigInt(Math.abs(Math.trunc(grossCents))) * 10_000n;
  const result = (value + denominator / 2n) / denominator;
  return negative ? -Number(result) : Number(result);
}

/**
 * Rozdziela kwotę proporcjonalnie do wag (metoda największych reszt).
 * Gwarantuje: suma(wynik) === total — nie gubimy ani nie dodajemy groszy.
 */
export function allocateProportional(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (totalWeight === 0) {
    // brak wag — pierwsza pozycja bierze wszystko (deterministycznie)
    const out = new Array<number>(weights.length).fill(0);
    out[0] = total;
    return out;
  }
  const absTotal = Math.abs(total);
  const sign = total < 0 ? -1 : 1;
  const raw = weights.map((w) => (Math.max(0, w) * absTotal) / totalWeight);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = absTotal - floors.reduce((s, f) => s + f, 0);
  const restOrder = raw
    .map((r, index) => ({ index, frac: r - Math.floor(r) }))
    .sort((a, b) => (b.frac === a.frac ? a.index - b.index : b.frac - a.frac));
  const out = [...floors];
  let cursor = 0;
  while (remainder > 0 && restOrder.length > 0) {
    out[restOrder[cursor % restOrder.length].index] += 1;
    remainder -= 1;
    cursor += 1;
  }
  return out.map((v) => v * sign);
}

/** Złote (np. 1234.56) -> grosze (123456). Akceptuje liczby i stringi z przecinkiem. */
export function toCents(amount: number | string): number {
  if (typeof amount === 'number') return Math.round(amount * 100);
  const normalized = amount.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d*(\.\d+)?$/.test(normalized) || normalized === '' || normalized === '-') {
    throw new Error(`Nieprawidłowa kwota: "${amount}"`);
  }
  const [intPart = '0', fracPart = ''] = normalized.split('.');
  const frac = (fracPart + '00').slice(0, 2);
  return Number(intPart) * 100 + Number(frac) * (Number(intPart) < 0 ? -1 : 1);
}

/**
 * Grosze -> "1\u00A0234,56" (separator tysięcy: twarda spacja, zgodnie z polską typografią).
 * Formatowanie jest niezależne od lokalizacji środowiska — wynik zawsze identyczny.
 */
export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const zl = Math.floor(abs / 100);
  const gr = abs % 100;
  const digits = String(zl);
  let grouped = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += '\u00A0';
    grouped += digits[i];
  }
  return `${negative ? '-' : ''}${grouped},${String(gr).padStart(2, '0')}`;
}

/** Grosze -> "1 234,56 zł" */
export function formatMoney(cents: number, currency = 'PLN'): string {
  const suffix: Record<string, string> = { PLN: 'zł', EUR: '€', USD: '$', GBP: '£', CZK: 'Kč' };
  return `${formatAmount(cents)} ${suffix[currency] ?? currency}`.trim();
}

/** Bezpieczne sumowanie kwot w groszach. */
export function sumCents(values: number[]): number {
  return values.reduce((sum, v) => sum + (Number.isFinite(v) ? Math.trunc(v) : 0), 0);
}

/** Zabezpieczenie: kwota nie może być ujemna (np. po rabacie). */
export function clampNonNegative(cents: number): number {
  return cents < 0 ? 0 : cents;
}
