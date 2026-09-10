/**
 * SILNIK CENOWY — jedyne miejsce, w którym liczone są pieniądze.
 *
 * Wszystkie obliczenia są deterministyczne i wykonywane przez kod.
 * AI nigdy nie ustala ceny — może jedynie zaproponować interpretację zapytania
 * (usługa / ilość / termin), a ostateczna kwota zawsze powstaje tutaj.
 *
 * Obsługiwane reguły (zgodnie ze specyfikacją):
 *  - cena stała (FIXED)
 *  - cena za jednostkę (PER_UNIT): ilość × cena
 *  - stawka godzinowa (HOURLY): godziny × stawka
 *  - ceny progowe (TIERED): 0–50 m² -> 5 zł/m², 51–150 -> 4 zł/m², 151+ -> 3,50 zł/m²
 *  - minimum usługi (minPriceCents) oraz minimum zlecenia (minJobValueCents)
 *  - dojazd: stawka stała lub za kilometr
 *  - dopłata za pilne zlecenie (%)
 *  - rabat: procentowy i/lub kwotowy — alokowany proporcjonalnie (metoda największych reszt)
 *  - podatek liczony per pozycja po uwzględnieniu rabatu
 */
import Decimal from 'decimal.js';
import { allocateProportional, clampNonNegative, mulBps, sumCents, toCents } from '@/lib/money';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type PricingMode = 'FIXED' | 'PER_UNIT' | 'HOURLY' | 'TIERED';

export type PricingTier = {
  minQuantity: number | string;
  maxQuantity?: number | string | null;
  unitPriceCents: number;
  flatFeeCents?: number;
  sortOrder?: number;
};

export type PricingLineInput = {
  /** identyfikator usługi w katalogu (opcjonalnie — pozycje własne go nie mają) */
  serviceId?: string | null;
  addonId?: string | null;
  name: string;
  description?: string | null;
  unit?: string;
  customUnitLabel?: string | null;
  quantity?: number | string;
  pricingMode?: PricingMode;
  /** cena jednostkowa / cena stała (grosze) */
  unitPriceCents?: number;
  basePriceCents?: number;
  hourlyRateCents?: number | null;
  minPriceCents?: number;
  taxRateBps?: number | null;
  /** rabat na pozycji: procentowo i/lub kwotowo */
  discountBps?: number;
  discountCents?: number;
  /** progi cenowe (tylko dla pricingMode = TIERED) */
  tiers?: PricingTier[];
  isUrgent?: boolean;
  isCustom?: boolean;
  sortOrder?: number;
};

export type PricingLineResult = {
  serviceId: string | null;
  addonId: string | null;
  name: string;
  description: string | null;
  unit: string;
  customUnitLabel: string | null;
  quantity: string;
  unitPriceCents: number;
  taxRateBps: number;
  discountCents: number;
  discountBps: number;
  netCents: number;
  taxCents: number;
  grossCents: number;
  isCustom: boolean;
  sortOrder: number;
  /** informacja pomocnicza: skąd wzięła się cena (stała / próg / stawka) */
  pricingSource: 'FIXED' | 'UNIT' | 'HOURLY' | 'TIER' | 'CUSTOM';
  /** czy zadziałało minimum usługi */
  minPriceApplied: boolean;
};

export type DocumentPricingInput = {
  lines: PricingLineInput[];
  /** rabat dokumentu — procentowo (bps) */
  discountBps?: number;
  /** rabat dokumentu — kwotowo (grosze) */
  discountCents?: number;
  /** dojazd */
  travelFeeType?: 'NONE' | 'FLAT' | 'PER_KM';
  travelFlatFeeCents?: number;
  travelPerKmCents?: number;
  travelDistanceKm?: number | string | null;
  /** dopłata za pilne zlecenie (bps) */
  urgencySurchargeBps?: number;
  isUrgent?: boolean;
  /** minimalna wartość zlecenia (grosze) */
  minJobValueCents?: number;
  /** domyślna stawka podatku (gdy pozycja jej nie określa) */
  defaultTaxRateBps?: number;
};

export type DocumentPricingResult = {
  lines: PricingLineResult[];
  subtotalCents: number;
  discountCents: number;
  discountBps: number;
  travelCents: number;
  urgencyFeeCents: number;
  /** część rabatu dokumentu przypadająca na dojazd i dopłatę za pilność */
  extrasDiscountCents: number;
  minimumAdjustmentCents: number;
  /** podstawa opodatkowania dla dojazdu, dopłaty i wyrównania do minimum */
  extrasNetCents: number;
  taxCents: number;
  totalCents: number;
  /** podatek rozbity na stawki (przydatne na fakturze) */
  taxBreakdown: { taxRateBps: number; netCents: number; taxCents: number }[];
  warnings: string[];
};

/** Bezpieczna konwersja ilości na Decimal (akceptuje "150", "12,5", 12.5). */
function toDecimal(value: number | string | null | undefined, fallback = '1'): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(fallback);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return new Decimal(fallback);
    return new Decimal(value);
  }
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d*(\.\d+)?$/.test(normalized) || normalized === '' || normalized === '-') {
    return new Decimal(fallback);
  }
  return new Decimal(normalized);
}

/** Ilość zapisana z maksymalnie 3 miejscami po przecinku. */
function formatQuantity(value: Decimal): string {
  return value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3).replace(/\.?0+$/, '');
}

/**
 * Wybór progu cenowego dla ilości. Progi sortowane wg minQuantity.
 * Próg obowiązuje gdy: minQuantity <= ilość < maxQuantity (lub bez górnego limitu).
 */
export function resolveTier(tiers: PricingTier[] | undefined, quantity: Decimal): PricingTier | null {
  if (!tiers || tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => toDecimal(a.minQuantity, '0').comparedTo(toDecimal(b.minQuantity, '0')));
  let matched: PricingTier | null = null;
  for (const tier of sorted) {
    const min = toDecimal(tier.minQuantity, '0');
    if (quantity.greaterThanOrEqualTo(min)) {
      if (tier.maxQuantity === null || tier.maxQuantity === undefined) {
        matched = tier;
      } else {
        const max = toDecimal(tier.maxQuantity);
        if (quantity.lessThanOrEqualTo(max)) {
          matched = tier;
          break;
        }
        // ilość powyżej tego progu — szukamy dalej, ale zapamiętujemy jako fallback
        matched = tier;
      }
    }
  }
  return matched;
}

/**
 * Oblicza cenę jednej pozycji (bez rabatu dokumentu i bez podatku
 * wynikającego z korekt dokumentu — te są aplikowane w computeDocumentPricing).
 */
export function priceLine(input: PricingLineInput, defaultTaxRateBps = 2300): Omit<PricingLineResult, 'taxCents' | 'grossCents'> & {
  taxableBaseCents: number;
} {
  const quantity = toDecimal(input.quantity, '1');
  if (quantity.isNegative()) {
    throw new Error('Ilość nie może być ujemna.');
  }
  const mode: PricingMode = input.pricingMode ?? 'FIXED';
  const taxRateBps = input.taxRateBps ?? defaultTaxRateBps;

  let netCents = 0;
  let unitPriceCents = input.unitPriceCents ?? input.basePriceCents ?? 0;
  let pricingSource: PricingLineResult['pricingSource'] = 'CUSTOM';

  switch (mode) {
    case 'FIXED': {
      unitPriceCents = input.basePriceCents ?? input.unitPriceCents ?? 0;
      netCents = unitPriceCents;
      pricingSource = 'FIXED';
      break;
    }
    case 'HOURLY': {
      const rate = input.hourlyRateCents ?? input.basePriceCents ?? input.unitPriceCents ?? 0;
      unitPriceCents = rate;
      netCents = quantity.mul(rate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
      pricingSource = 'HOURLY';
      break;
    }
    case 'TIERED': {
      const tier = resolveTier(input.tiers, quantity);
      if (tier) {
        unitPriceCents = tier.unitPriceCents;
        const flat = tier.flatFeeCents ?? 0;
        netCents = quantity.mul(tier.unitPriceCents).plus(flat).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
        pricingSource = 'TIER';
      } else {
        // brak dopasowanego progu — fallback do ceny bazowej
        unitPriceCents = input.basePriceCents ?? 0;
        netCents = quantity.mul(unitPriceCents).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
        pricingSource = 'UNIT';
      }
      break;
    }
    case 'PER_UNIT':
    default: {
      unitPriceCents = input.unitPriceCents ?? input.basePriceCents ?? 0;
      netCents = quantity.mul(unitPriceCents).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
      pricingSource = input.serviceId ? 'UNIT' : 'CUSTOM';
      break;
    }
  }

  // minimum usługi
  let minPriceApplied = false;
  const minPrice = input.minPriceCents ?? 0;
  if (minPrice > 0 && netCents < minPrice) {
    netCents = minPrice;
    minPriceApplied = true;
  }

  // rabat na pozycji: procentowy, potem kwotowy
  const lineDiscountBps = input.discountBps ?? 0;
  let discountCents = mulBps(netCents, lineDiscountBps);
  discountCents += input.discountCents ?? 0;
  if (discountCents > netCents) discountCents = netCents;
  const taxableBaseCents = clampNonNegative(netCents - discountCents);

  return {
    serviceId: input.serviceId ?? null,
    addonId: input.addonId ?? null,
    name: input.name,
    description: input.description ?? null,
    unit: input.unit ?? 'VISIT',
    customUnitLabel: input.customUnitLabel ?? null,
    quantity: formatQuantity(quantity),
    unitPriceCents,
    taxRateBps,
    discountCents,
    discountBps: lineDiscountBps,
    netCents,
    taxableBaseCents,
    isCustom: input.isCustom ?? !input.serviceId,
    sortOrder: input.sortOrder ?? 0,
    pricingSource,
    minPriceApplied,
  };
}

/**
 * Główne wyliczenie dokumentu (wycena / oferta / zlecenie / faktura).
 * Kolejność operacji jest stała i udokumentowana — dzięki temu wynik jest powtarzalny.
 */
export function computeDocumentPricing(input: DocumentPricingInput): DocumentPricingResult {
  const defaultTaxRateBps = input.defaultTaxRateBps ?? 2300;
  const warnings: string[] = [];

  if (input.lines.length === 0) {
    return {
      lines: [],
      subtotalCents: 0,
      discountCents: 0,
      discountBps: input.discountBps ?? 0,
      travelCents: 0,
      urgencyFeeCents: 0,
      extrasDiscountCents: 0,
      minimumAdjustmentCents: 0,
      extrasNetCents: 0,
      taxCents: 0,
      totalCents: 0,
      taxBreakdown: [],
      warnings: ['Dokument nie zawiera pozycji.'],
    };
  }

  // 1. pozycje
  const priced = input.lines.map((line) => priceLine(line, defaultTaxRateBps));
  const subtotalCents = sumCents(priced.map((l) => l.netCents));

  // 2. dojazd
  let travelCents = 0;
  if (input.travelFeeType === 'FLAT') {
    travelCents = input.travelFlatFeeCents ?? 0;
  } else if (input.travelFeeType === 'PER_KM') {
    const km = toDecimal(input.travelDistanceKm, '0');
    travelCents = km.mul(input.travelPerKmCents ?? 0).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    if (km.isZero()) warnings.push('Dojazd liczony od kilometrów, ale nie podano dystansu — przyjęto 0.');
  }

  // 3. dopłata za pilne zlecenie
  const urgent = input.isUrgent ?? input.lines.some((l) => l.isUrgent);
  const urgencyFeeCents = urgent ? mulBps(subtotalCents, input.urgencySurchargeBps ?? 0) : 0;

  // 4. rabat dokumentu (procentowy + kwotowy), alokowany proporcjonalnie do podstawy opodatkowania
  const baseForDiscount = subtotalCents + travelCents + urgencyFeeCents;
  let documentDiscountCents = mulBps(baseForDiscount, input.discountBps ?? 0);
  documentDiscountCents += input.discountCents ?? 0;
  if (documentDiscountCents > baseForDiscount) {
    documentDiscountCents = baseForDiscount;
    warnings.push('Rabat przewyższał wartość dokumentu — ograniczono go do wartości netto.');
  }
  if (documentDiscountCents < 0) documentDiscountCents = 0;

  // Podstawę rabatu rozbijamy na pozycje + dojazd + dopłatę (wagi = wartości przed rabatem).
  // Dojazd i dopłatę traktujemy jako jedną „pozycję dodatkową” ze stawką domyślną.
  const extrasCents = travelCents + urgencyFeeCents;
  const weights = [...priced.map((l) => l.taxableBaseCents), extrasCents];
  const allocatedDiscounts = allocateProportional(documentDiscountCents, weights);
  const lineDiscounts = allocatedDiscounts.slice(0, priced.length);
  const extrasDiscount = allocatedDiscounts[priced.length] ?? 0;

  // 5. minimalna wartość zlecenia
  let minimumAdjustmentCents = 0;
  const netAfterDiscount = sumCents(priced.map((l, i) => l.taxableBaseCents - lineDiscounts[i])) + (extrasCents - extrasDiscount);
  const minJobValue = input.minJobValueCents ?? 0;
  if (minJobValue > 0 && netAfterDiscount < minJobValue) {
    minimumAdjustmentCents = minJobValue - netAfterDiscount;
  }

  // 6. podatek per pozycja (po rabacie) + podatek od dojazdu/dopłaty/dopłaty do minimum
  let taxCents = 0;
  const taxMap = new Map<number, { netCents: number; taxCents: number }>();
  const addTax = (base: number, rateBps: number) => {
    const tax = mulBps(base, rateBps);
    taxCents += tax;
    const entry = taxMap.get(rateBps) ?? { netCents: 0, taxCents: 0 };
    entry.netCents += base;
    entry.taxCents += tax;
    taxMap.set(rateBps, entry);
  };

  const lines: PricingLineResult[] = priced.map((line, index) => {
    const lineDiscount = lineDiscounts[index] ?? 0;
    // rabat dokumentu jest rozłożony proporcjonalnie — dodajemy go do rabatu pozycji
    const totalLineDiscount = line.discountCents + lineDiscount;
    const taxable = clampNonNegative(line.taxableBaseCents - lineDiscount);
    addTax(taxable, line.taxRateBps);
    return {
      serviceId: line.serviceId,
      addonId: line.addonId,
      name: line.name,
      description: line.description,
      unit: line.unit,
      customUnitLabel: line.customUnitLabel,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      taxRateBps: line.taxRateBps,
      discountCents: totalLineDiscount,
      discountBps: line.discountBps,
      netCents: line.netCents,
      taxCents: mulBps(taxable, line.taxRateBps),
      grossCents: taxable + mulBps(taxable, line.taxRateBps),
      isCustom: line.isCustom,
      sortOrder: line.sortOrder,
      pricingSource: line.pricingSource,
      minPriceApplied: line.minPriceApplied,
    };
  });

  const extrasTaxable = clampNonNegative(extrasCents - extrasDiscount + minimumAdjustmentCents);
  if (extrasTaxable !== 0) {
    addTax(extrasTaxable, defaultTaxRateBps);
  }

  const netTotal = sumCents(lines.map((l) => clampNonNegative(l.netCents - l.discountCents))) + extrasTaxable;
  const totalCents = netTotal + taxCents;

  return {
    lines,
    subtotalCents,
    discountCents: documentDiscountCents,
    discountBps: input.discountBps ?? 0,
    travelCents,
    urgencyFeeCents,
    extrasDiscountCents: extrasDiscount,
    minimumAdjustmentCents,
    extrasNetCents: extrasTaxable,
    taxCents,
    totalCents,
    taxBreakdown: [...taxMap.entries()]
      .map(([taxRateBps, v]) => ({ taxRateBps, ...v }))
      .sort((a, b) => a.taxRateBps - b.taxRateBps),
    warnings,
  };
}

/**
 * Szybka wycena pojedynczej usługi z katalogu (używana w kreatorze wycen i API).
 * Nie ustala „prawdy objawionej” — to czysta matematyka na podstawie konfiguracji firmy.
 */
export function priceService(
  service: {
    pricingMode?: string | null;
    basePriceCents?: number | null;
    hourlyRateCents?: number | null;
    minPriceCents?: number | null;
    taxRateBps?: number | null;
    unit?: string | null;
    customUnitLabel?: string | null;
  },
  quantity: number | string,
  tiers: PricingTier[] = [],
  defaultTaxRateBps = 2300,
): { netCents: number; unitPriceCents: number; quantity: string } {
  const result = priceLine(
    {
      name: 'x',
      quantity,
      pricingMode: (service.pricingMode as PricingMode) ?? 'FIXED',
      basePriceCents: service.basePriceCents ?? 0,
      hourlyRateCents: service.hourlyRateCents,
      minPriceCents: service.minPriceCents ?? 0,
      taxRateBps: service.taxRateBps ?? defaultTaxRateBps,
      unit: service.unit ?? 'VISIT',
      customUnitLabel: service.customUnitLabel,
      tiers,
      serviceId: 'x',
    },
    defaultTaxRateBps,
  );
  return { netCents: result.netCents, unitPriceCents: result.unitPriceCents, quantity: result.quantity };
}

/** Parsowanie kwoty wpisanej przez użytkownika (np. "600,50" -> 60050). */
export function parseAmountToCents(value: string | number): number {
  if (typeof value === 'number') return Math.round(value * 100);
  return toCents(value);
}
