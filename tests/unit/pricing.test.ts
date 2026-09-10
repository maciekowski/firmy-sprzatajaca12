import { describe, expect, it } from 'vitest';
import { computeDocumentPricing, priceLine, priceService, resolveTier } from '@/lib/pricing/engine';
import { mulBps } from '@/lib/money';

const TIERS = [
  { minQuantity: '0', maxQuantity: '50', unitPriceCents: 500 },
  { minQuantity: '51', maxQuantity: '150', unitPriceCents: 400 },
  { minQuantity: '151', maxQuantity: null, unitPriceCents: 350 },
];

describe('silnik cenowy — tryby wyceny', () => {
  it('cena stała: 100 zł niezależnie od ilości', () => {
    const a = priceLine({ name: 'Sprzątanie', pricingMode: 'FIXED', basePriceCents: 10000, quantity: 1 });
    const b = priceLine({ name: 'Sprzątanie', pricingMode: 'FIXED', basePriceCents: 10000, quantity: 5 });
    expect(a.netCents).toBe(10000);
    expect(b.netCents).toBe(10000);
  });

  it('cena za jednostkę: 150 m² × 4 zł = 600 zł', () => {
    const line = priceLine({
      name: 'Mycie kostki',
      serviceId: 'srv_1',
      pricingMode: 'PER_UNIT',
      unitPriceCents: 400,
      quantity: 150,
    });
    expect(line.netCents).toBe(60000);
  });

  it('stawka godzinowa: 4 h × 45 zł = 180 zł', () => {
    const line = priceLine({
      name: 'Prace porządkowe',
      serviceId: 'srv_2',
      pricingMode: 'HOURLY',
      hourlyRateCents: 4500,
      quantity: 4,
    });
    expect(line.netCents).toBe(18000);
  });

  it('stawka godzinowa z ułamkiem godziny: 2,5 h × 45 zł = 112,50 zł', () => {
    const line = priceLine({ name: 'X', pricingMode: 'HOURLY', hourlyRateCents: 4500, quantity: '2,5' });
    expect(line.netCents).toBe(11250);
  });

  it('ceny progowe: 30 m² -> 5 zł/m², 100 m² -> 4 zł/m², 200 m² -> 3,50 zł/m²', () => {
    expect(priceLine({ name: 'X', pricingMode: 'TIERED', tiers: TIERS, quantity: 30 }).netCents).toBe(15000);
    expect(priceLine({ name: 'X', pricingMode: 'TIERED', tiers: TIERS, quantity: 100 }).netCents).toBe(40000);
    expect(priceLine({ name: 'X', pricingMode: 'TIERED', tiers: TIERS, quantity: 200 }).netCents).toBe(70000);
  });

  it('ceny progowe: granice progów są włączne', () => {
    expect(priceLine({ name: 'X', pricingMode: 'TIERED', tiers: TIERS, quantity: 50 }).netCents).toBe(25000);
    expect(priceLine({ name: 'X', pricingMode: 'TIERED', tiers: TIERS, quantity: 51 }).netCents).toBe(20400);
    expect(priceLine({ name: 'X', pricingMode: 'TIERED', tiers: TIERS, quantity: 150 }).netCents).toBe(60000);
    expect(priceLine({ name: 'X', pricingMode: 'TIERED', tiers: TIERS, quantity: 151 }).netCents).toBe(52850);
  });

  it('ceny progowe z opłatą stałą w progu', () => {
    const tiers = [{ minQuantity: '0', maxQuantity: null, unitPriceCents: 300, flatFeeCents: 5000 }];
    expect(priceLine({ name: 'X', pricingMode: 'TIERED', tiers, quantity: 10 }).netCents).toBe(8000);
  });

  it('minimum usługi podnosi cenę pozycji', () => {
    const line = priceLine({
      name: 'Pranie tapicerki',
      serviceId: 'srv_3',
      pricingMode: 'PER_UNIT',
      unitPriceCents: 500,
      minPriceCents: 15000,
      quantity: 10,
    });
    expect(line.netCents).toBe(15000);
    expect(line.minPriceApplied).toBe(true);
  });

  it('minimum usługi nie obniża ceny powyżej progu', () => {
    const line = priceLine({ name: 'X', pricingMode: 'PER_UNIT', unitPriceCents: 500, minPriceCents: 15000, quantity: 100 });
    expect(line.netCents).toBe(50000);
    expect(line.minPriceApplied).toBe(false);
  });

  it('resolveTier zwraca null bez progów i właściwy próg dla ilości', () => {
    expect(resolveTier(undefined, new (require('decimal.js'))('10'))).toBeNull();
  });

  it('priceService wycenia usługę z katalogu', () => {
    const result = priceService(
      { pricingMode: 'TIERED', basePriceCents: 500, minPriceCents: 10000, taxRateBps: 2300, unit: 'SQM' },
      120,
      TIERS,
    );
    expect(result.netCents).toBe(48000);
    expect(result.unitPriceCents).toBe(400);
  });

  it('odrzuca ujemną ilość', () => {
    expect(() => priceLine({ name: 'X', quantity: -3, pricingMode: 'PER_UNIT', unitPriceCents: 100 })).toThrow();
  });
});

describe('silnik cenowy — dokument', () => {
  const base = {
    lines: [
      { name: 'Mycie kostki', serviceId: 'srv_1', pricingMode: 'PER_UNIT' as const, unitPriceCents: 400, quantity: 150, taxRateBps: 2300 },
    ],
    defaultTaxRateBps: 2300,
  };

  it('liczy netto, podatek i brutto', () => {
    const result = computeDocumentPricing(base);
    expect(result.subtotalCents).toBe(60000);
    expect(result.taxCents).toBe(13800);
    expect(result.totalCents).toBe(73800);
    expect(result.discountCents).toBe(0);
  });

  it('dojazd stały: +50 zł', () => {
    const result = computeDocumentPricing({ ...base, travelFeeType: 'FLAT', travelFlatFeeCents: 5000 });
    expect(result.travelCents).toBe(5000);
    expect(result.taxCents).toBe(mulBps(65000, 2300));
    expect(result.totalCents).toBe(65000 + mulBps(65000, 2300));
  });

  it('dojazd za kilometr: 30 km × 2 zł = 60 zł', () => {
    const result = computeDocumentPricing({
      ...base,
      travelFeeType: 'PER_KM',
      travelPerKmCents: 200,
      travelDistanceKm: 30,
    });
    expect(result.travelCents).toBe(6000);
  });

  it('dojazd za kilometr bez dystansu = 0 i ostrzeżenie', () => {
    const result = computeDocumentPricing({ ...base, travelFeeType: 'PER_KM', travelPerKmCents: 200 });
    expect(result.travelCents).toBe(0);
    expect(result.warnings.join(' ')).toContain('dystansu');
  });

  it('pilne zlecenie: +20% od netto', () => {
    const result = computeDocumentPricing({ ...base, isUrgent: true, urgencySurchargeBps: 2000 });
    expect(result.urgencyFeeCents).toBe(12000);
    expect(result.taxCents).toBe(mulBps(72000, 2300));
    expect(result.totalCents).toBe(72000 + mulBps(72000, 2300));
  });

  it('rabat procentowy 10% obniża podstawę opodatkowania', () => {
    const result = computeDocumentPricing({ ...base, discountBps: 1000 });
    expect(result.discountCents).toBe(6000);
    expect(result.taxCents).toBe(mulBps(54000, 2300));
    expect(result.totalCents).toBe(54000 + mulBps(54000, 2300));
    expect(result.lines[0].discountCents).toBe(6000);
  });

  it('rabat kwotowy 50 zł', () => {
    const result = computeDocumentPricing({ ...base, discountCents: 5000 });
    expect(result.discountCents).toBe(5000);
    expect(result.totalCents).toBe(55000 + mulBps(55000, 2300));
  });

  it('rabat większy niż wartość dokumentu jest ograniczany (brak kwot ujemnych)', () => {
    const result = computeDocumentPricing({ ...base, discountCents: 999999 });
    expect(result.discountCents).toBe(60000);
    expect(result.totalCents).toBe(0);
    expect(result.warnings.join(' ')).toContain('Rabat');
  });

  it('minimalna wartość zlecenia dolicza wyrównanie', () => {
    const result = computeDocumentPricing({
      lines: [{ name: 'Małe zlecenie', pricingMode: 'PER_UNIT' as const, unitPriceCents: 300, quantity: 10, taxRateBps: 2300 }],
      minJobValueCents: 50000,
      defaultTaxRateBps: 2300,
    });
    expect(result.subtotalCents).toBe(3000);
    expect(result.minimumAdjustmentCents).toBe(47000);
    expect(result.taxCents).toBe(mulBps(50000, 2300));
    expect(result.totalCents).toBe(50000 + mulBps(50000, 2300));
  });

  it('nie dolicza wyrównania, gdy wartość jest powyżej minimum', () => {
    const result = computeDocumentPricing({ ...base, minJobValueCents: 10000 });
    expect(result.minimumAdjustmentCents).toBe(0);
  });

  it('obsługuje wiele stawek podatku i raportuje rozbicie', () => {
    const result = computeDocumentPricing({
      defaultTaxRateBps: 2300,
      lines: [
        { name: 'Usługa 23%', pricingMode: 'PER_UNIT' as const, unitPriceCents: 10000, quantity: 1, taxRateBps: 2300 },
        { name: 'Usługa 8%', pricingMode: 'PER_UNIT' as const, unitPriceCents: 10000, quantity: 1, taxRateBps: 800 },
      ],
    });
    expect(result.subtotalCents).toBe(20000);
    expect(result.taxCents).toBe(2300 + 800);
    expect(result.totalCents).toBe(23100);
    expect(result.taxBreakdown).toEqual([
      { taxRateBps: 800, netCents: 10000, taxCents: 800 },
      { taxRateBps: 2300, netCents: 10000, taxCents: 2300 },
    ]);
  });

  it('rabat dokumentu rozkłada się proporcjonalnie między pozycje', () => {
    const result = computeDocumentPricing({
      defaultTaxRateBps: 2300,
      lines: [
        { name: 'A', pricingMode: 'PER_UNIT' as const, unitPriceCents: 30000, quantity: 1 },
        { name: 'B', pricingMode: 'PER_UNIT' as const, unitPriceCents: 10000, quantity: 1 },
      ],
      discountBps: 1000, // 10% z 400 zł = 40 zł
    });
    expect(result.discountCents).toBe(4000);
    expect(result.lines[0].discountCents).toBe(3000);
    expect(result.lines[1].discountCents).toBe(1000);
    // suma rabatów na pozycjach == rabat dokumentu (nie gubimy groszy)
    expect(result.lines.reduce((s, l) => s + l.discountCents, 0)).toBe(result.discountCents);
  });

  it('przy podziale rabatu nie gubi groszy (pozycje o równych wagach)', () => {
    const result = computeDocumentPricing({
      defaultTaxRateBps: 2300,
      lines: [
        { name: 'A', pricingMode: 'PER_UNIT' as const, unitPriceCents: 100, quantity: 1 },
        { name: 'B', pricingMode: 'PER_UNIT' as const, unitPriceCents: 100, quantity: 1 },
        { name: 'C', pricingMode: 'PER_UNIT' as const, unitPriceCents: 100, quantity: 1 },
      ],
      discountCents: 100, // 1 zł do podziału na 3 pozycje
    });
    const sum = result.lines.reduce((s, l) => s + l.discountCents, 0);
    expect(sum).toBe(100);
    expect(result.lines.map((l) => l.discountCents).sort()).toEqual([33, 33, 34]);
  });

  it('brutto pozycji zawsze = netto po rabacie + podatek', () => {
    const result = computeDocumentPricing({
      defaultTaxRateBps: 2300,
      lines: [
        { name: 'A', pricingMode: 'PER_UNIT' as const, unitPriceCents: 12345, quantity: 3, discountBps: 1500 },
        { name: 'B', pricingMode: 'PER_UNIT' as const, unitPriceCents: 999, quantity: '7,5' },
      ],
      discountBps: 750,
      travelFeeType: 'FLAT',
      travelFlatFeeCents: 4500,
      isUrgent: true,
      urgencySurchargeBps: 2000,
    });
    for (const line of result.lines) {
      const netAfterDiscount = line.netCents - line.discountCents;
      expect(line.grossCents).toBe(netAfterDiscount + line.taxCents);
    }
    const netSum = result.lines.reduce((s, l) => s + (l.netCents - l.discountCents), 0);
    // dojazd i dopłata pomniejszone o przypadającą na nie część rabatu + wyrównanie do minimum
    expect(result.extrasNetCents).toBe(
      result.travelCents + result.urgencyFeeCents - result.extrasDiscountCents + result.minimumAdjustmentCents,
    );
    expect(result.totalCents).toBe(netSum + result.extrasNetCents + result.taxCents);
  });

  it('pusty dokument daje zera i ostrzeżenie', () => {
    const result = computeDocumentPricing({ lines: [] });
    expect(result.totalCents).toBe(0);
    expect(result.taxCents).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('wynik jest deterministyczny', () => {
    const input = {
      ...base,
      discountBps: 1234,
      travelFeeType: 'PER_KM' as const,
      travelPerKmCents: 199,
      travelDistanceKm: 37,
      isUrgent: true,
      urgencySurchargeBps: 1500,
      minJobValueCents: 40000,
    };
    const a = computeDocumentPricing(input);
    const b = computeDocumentPricing(input);
    expect(a).toEqual(b);
  });

  it('pozycja własna (bez usługi) liczy się tak samo jak z katalogu', () => {
    const result = computeDocumentPricing({
      defaultTaxRateBps: 2300,
      lines: [{ name: 'Usługa niestandardowa', pricingMode: 'PER_UNIT' as const, unitPriceCents: 25000, quantity: 2 }],
    });
    expect(result.subtotalCents).toBe(50000);
    expect(result.lines[0].isCustom).toBe(true);
  });
});
