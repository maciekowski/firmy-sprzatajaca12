import { describe, expect, it } from 'vitest';
import {
  addTax,
  allocateProportional,
  clampNonNegative,
  formatMoney,
  mulBps,
  netFromGross,
  sumCents,
  toCents,
} from '@/lib/money';

describe('money — operacje na groszach', () => {
  it('zamienia złotówki na grosze (liczba i tekst z przecinkiem)', () => {
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents('600,50')).toBe(60050);
    expect(toCents('0,01')).toBe(1);
    expect(toCents('-12,30')).toBe(-1230);
  });

  it('odrzuca nieprawidłowe kwoty', () => {
    expect(() => toCents('abc')).toThrow();
    expect(() => toCents('')).toThrow();
  });

  it('mnoży przez stawkę w bps z zaokrągleniem pół w górę', () => {
    expect(mulBps(60000, 2300)).toBe(13800); // 600 zł * 23% = 138 zł
    expect(mulBps(1, 5000)).toBe(1); // 0,5 gr -> 1 gr (half-up)
    expect(mulBps(3, 5000)).toBe(2); // 1,5 gr -> 2 gr
    expect(mulBps(2, 5000)).toBe(1); // 1,0 gr -> 1 gr
    expect(mulBps(0, 2300)).toBe(0);
    expect(mulBps(-10000, 2300)).toBe(-2300);
    expect(mulBps(10000, -1000)).toBe(-1000);
  });

  it('odrzuca nieprawidłowe dane finansowe', () => {
    expect(() => mulBps(Number.NaN, 2300)).toThrow();
    expect(() => mulBps(100, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('liczy brutto i netto z podatkiem', () => {
    expect(addTax(10000, 2300)).toBe(12300);
    expect(netFromGross(12300, 2300)).toBe(10000);
    expect(netFromGross(123, 2300)).toBe(100);
  });

  it('alokuje kwotę proporcjonalnie bez gubienia groszy', () => {
    expect(allocateProportional(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportional(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(allocateProportional(1, [50, 50])).toEqual([1, 0]);
    expect(allocateProportional(0, [10, 20])).toEqual([0, 0]);
    expect(allocateProportional(9999, [1, 2, 3, 4, 5, 6, 7]).reduce((a, b) => a + b, 0)).toBe(9999);
    // brak wag — deterministycznie pierwsza pozycja
    expect(allocateProportional(55, [0, 0])).toEqual([55, 0]);
    // wartości ujemne (np. korekta)
    expect(allocateProportional(-100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(-100);
  });

  it('sumuje i formatuje', () => {
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(formatMoney(123456, 'PLN')).toBe('1\u00A0234,56 zł');
    expect(formatMoney(0)).toBe('0,00 zł');
    expect(formatMoney(-500)).toBe('-5,00 zł');
    expect(formatMoney(123456789)).toBe('1\u00A0234\u00A0567,89 zł');
    expect(clampNonNegative(-5)).toBe(0);
    expect(clampNonNegative(5)).toBe(5);
  });
});
