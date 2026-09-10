/**
 * Deterministyczny silnik regułowy do interpretacji zapytań klientów.
 *
 * To NIE jest model AI — to zestaw reguł (wyrażenia regularne + słowniki).
 * Działa zawsze, również bez klucza dostawcy AI, i nigdy nie wymyśla danych:
 * jeżeli czegoś nie uda się odczytać z tekstu, wynik jest oznaczany
 * jako „Do potwierdzenia” (status NEEDS_CONFIRMATION).
 */
import type { Confidence, ParsedRequest, ParsedRequestItem, ParseRequestInput } from './types';

const NUMBER = '(\\d+(?:[\\s\\u00A0]?\\d+)*(?:[.,]\\d+)?)';

function parseNumber(raw: string): number | null {
  const normalized = raw.replace(/[\s\u00A0]/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const UNIT_PATTERNS: { unit: NonNullable<ParsedRequestItem['unit']>; regex: RegExp }[] = [
  { unit: 'SQM', regex: new RegExp(`${NUMBER}\\s*(m2|m²|m\\^2|metr(?:ów|y|ow)?|metry|metra)\\b`, 'gi') },
  { unit: 'HOUR', regex: new RegExp(`${NUMBER}\\s*(godz(?:in|iny|ina)?\\.?|h)\\b`, 'gi') },
  { unit: 'ROOM', regex: new RegExp(`${NUMBER}\\s*(pokoj(?:e|i|ów|u)?|pomieszcze(?:nie|nia|ń))`, 'gi') },
  { unit: 'VEHICLE', regex: new RegExp(`${NUMBER}\\s*(aut(?:o|a|omobil)|samochod(?:u|y|ów)?|pojazd(?:u|y|ów)?)`, 'gi') },
  { unit: 'PIECE', regex: new RegExp(`${NUMBER}\\s*(szt(?:uk|uki|uka|\\.)?|sztuki)`, 'gi') },
];

const LABEL_HINTS: { label: string; unit: NonNullable<ParsedRequestItem['unit']>; regex: RegExp }[] = [
  { label: 'podjazd', unit: 'SQM', regex: /podjazd|wjazd|droga dojazdowa|dojazdow/gi },
  { label: 'taras', unit: 'SQM', regex: /taras/gi },
  { label: 'kostka', unit: 'SQM', regex: /kostk/i },
  { label: 'elewacja', unit: 'SQM', regex: /elewacj/i },
  { label: 'dach', unit: 'SQM', regex: /dach/i },
  { label: 'okna', unit: 'PIECE', regex: /okn/i },
  { label: 'mieszkanie', unit: 'VISIT', regex: /mieszkan/i },
  { label: 'dom', unit: 'VISIT', regex: /\bdom\b|domku|domu/gi },
  { label: 'biuro', unit: 'VISIT', regex: /biur/i },
  { label: 'kuchnia', unit: 'VISIT', regex: /kuchni/i },
  { label: 'łazienka', unit: 'VISIT', regex: /łazien/i },
  { label: 'dywan', unit: 'SQM', regex: /dywan|wykładzin/i },
  { label: 'tapicerka', unit: 'VISIT', regex: /tapicer/i },
  { label: 'ogród', unit: 'SQM', regex: /ogród|ogrod|trawnik/i },
  { label: 'pokoje', unit: 'ROOM', regex: /pokoj|pomieszcze/gi },
];

const WEEKDAYS: { names: string[]; index: number }[] = [
  { names: ['niedziela', 'niedzielę', 'w niedzielę'], index: 0 },
  { names: ['poniedziałek', 'poniedziałek', 'w poniedziałek'], index: 1 },
  { names: ['wtorek', 'we wtorek'], index: 2 },
  { names: ['środa', 'środę', 'w środę'], index: 3 },
  { names: ['czwartek', 'w czwartek'], index: 4 },
  { names: ['piątek', 'piatek', 'w piątek'], index: 5 },
  { names: ['sobota', 'sobotę', 'w sobotę'], index: 6 },
];

const MONTHS: Record<string, number> = {
  stycznia: 0,
  styczeń: 0,
  lutego: 1,
  luty: 1,
  marca: 2,
  marzec: 2,
  kwietnia: 3,
  kwiecień: 3,
  maja: 4,
  maj: 4,
  czerwca: 5,
  czerwiec: 5,
  lipca: 6,
  lipiec: 6,
  sierpnia: 7,
  sierpień: 7,
  września: 8,
  wrzesień: 8,
  października: 9,
  październik: 9,
  listopada: 10,
  listopad: 10,
  grudnia: 11,
  grudzień: 11,
};

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekdayNamePl(date: Date): string {
  return date.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
}

function findPreferredDate(text: string, today: Date): { date: Date | null; label: string | null; confidence: Confidence } {
  const lower = text.toLowerCase();

  if (/\bdzisiaj\b|\bdziś\b/.test(lower)) {
    return { date: today, label: `dzisiaj (${weekdayNamePl(today)})`, confidence: 'HIGH' };
  }
  if (/\bjutro\b/.test(lower)) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    return { date, label: `jutro (${weekdayNamePl(date)})`, confidence: 'HIGH' };
  }
  if (/\bpojutrze\b/.test(lower)) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    return { date, label: `pojutrze (${weekdayNamePl(date)})`, confidence: 'HIGH' };
  }

  const nextWeek = /\bprzyszł\w+\s+(poniedziałek|wtorek|środ[ęa]|czwartek|piątek|sobot[ęa]|niedziel[ęa])/i.exec(lower);
  if (nextWeek) {
    const target = WEEKDAYS.find((day) => day.names.some((name) => nextWeek[1].includes(name.replace('w ', ''))));
    if (target) {
      const date = new Date(today);
      let diff = (target.index - date.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      date.setDate(date.getDate() + diff + 7);
      return { date, label: `przyszły tydzień (${weekdayNamePl(date)})`, confidence: 'MEDIUM' };
    }
  }

  for (const day of WEEKDAYS) {
    for (const name of day.names) {
      if (lower.includes(name)) {
        const date = new Date(today);
        let diff = (day.index - date.getDay() + 7) % 7;
        if (diff === 0) diff = 7; // „w piątek” oznacza kolejny piątek
        date.setDate(date.getDate() + diff);
        return { date, label: weekdayNamePl(date), confidence: 'MEDIUM' };
      }
    }
  }

  // data w formacie 12.09 / 12.09.2026
  const numeric = /(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/.exec(text);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const yearPart = numeric[3];
    let year = today.getFullYear();
    if (yearPart) {
      year = yearPart.length === 2 ? 2000 + Number(yearPart) : Number(yearPart);
    }
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const date = new Date(year, month, day);
      if (date < today && !yearPart) date.setFullYear(year + 1);
      return { date, label: weekdayNamePl(date), confidence: 'MEDIUM' };
    }
  }

  // „12 września”
  for (const [monthName, monthIndex] of Object.entries(MONTHS)) {
    const match = new RegExp(`(\\d{1,2})\\s*${monthName}`, 'i').exec(lower);
    if (match) {
      const day = Number(match[1]);
      if (day >= 1 && day <= 31) {
        const date = new Date(today.getFullYear(), monthIndex, day);
        if (date < today) date.setFullYear(today.getFullYear() + 1);
        return { date, label: weekdayNamePl(date), confidence: 'MEDIUM' };
      }
    }
  }

  return { date: null, label: null, confidence: 'LOW' };
}

function findTime(text: string): string | null {
  const match = /(\d{1,2})(?::(\d{2}))?\s*(?::)?/.exec(text);
  const rangeMatch = /(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})/.exec(text);
  if (rangeMatch) {
    return `${rangeMatch[1].padStart(2, '0')}:${rangeMatch[2]}-${rangeMatch[3].padStart(2, '0')}:${rangeMatch[4]}`;
  }
  const timeMatch = /\b(\d{1,2})[:.](\d{2})\b/.exec(text);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (hours <= 23 && minutes <= 59) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  const hourOnly = /\bo\s*godzinie\s*(\d{1,2})\b|\bna\s*(\d{1,2})\s*(?:godzinę|:00)?\b/i.exec(text);
  if (hourOnly) {
    const hours = Number(hourOnly[1] ?? hourOnly[2]);
    if (hours >= 6 && hours <= 22) return `${String(hours).padStart(2, '0')}:00`;
  }
  if (/rano/.test(text)) return 'rano';
  if (/południ|w południe/.test(text)) return 'południe';
  if (/popołudni|po południu/.test(text)) return 'popołudnie';
  if (/wieczor|wieczorem/.test(text)) return 'wieczorem';
  return match ? null : null;
}

function detectUrgency(text: string): { urgency: 'LOW' | 'NORMAL' | 'HIGH'; found: boolean } {
  const lower = text.toLowerCase();
  if (/piln|natychmiast|jak najszybciej|nagl|awari|zalani|ekspres/.test(lower)) {
    return { urgency: 'HIGH', found: true };
  }
  if (/nie spieszy|bez pośpiechu|w wolnej chwili|kiedyś/.test(lower)) {
    return { urgency: 'LOW', found: true };
  }
  return { urgency: 'NORMAL', found: false };
}

function findContact(text: string) {
  const email = /[\w.+-]+@[\w-]+\.[\w.]{2,}/.exec(text)?.[0] ?? null;
  const phone =
    /(?:\+?48)?[\s-]?(?:\d{3}[\s-]?\d{3}[\s-]?\d{3}|\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})/.exec(text)?.[0]?.trim() ?? null;
  return { name: null, phone, email };
}

function findAddress(text: string): string | null {
  const street = /(?:ul\.|ulica|adres[:\s]*)\s*([A-ZĄĆĘŁŃÓŚŹŻ][\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s./-]{2,60})/i.exec(text);
  if (street) return street[1].trim().slice(0, 120);
  const city = /\b(w\s+(?:Krakowie|Warszawie|Wrocławiu|Poznaniu|Gdańsku|Łodzi|Katowicach|Szczecinie|Bydgoszczy|Lublinie))\b/i.exec(text);
  return city ? city[1] : null;
}

/**
 * Główna funkcja silnika regułowego.
 * Zwraca wyłącznie to, co da się odeczytać z tekstu.
 */
export function parseWithRules(input: ParseRequestInput): ParsedRequest {
  const text = input.text ?? '';
  const today = input.today ?? new Date();
  const notes: string[] = [];
  const items: ParsedRequestItem[] = [];

  // 1. liczby z jednostkami — bierzemy je w kolejności występowania
  const found: { index: number; quantity: number; unit: NonNullable<ParsedRequestItem['unit']> }[] = [];
  for (const { unit, regex } of UNIT_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const quantity = parseNumber(match[1]);
      if (quantity !== null && quantity > 0) {
        found.push({ index: match.index, quantity, unit });
      }
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
  }
  found.sort((a, b) => a.index - b.index);

  // 2. dla każdej znalezionej liczby szukamy etykiety w jej pobliżu
  for (const entry of found) {
    const windowStart = Math.max(0, entry.index - 40);
    const windowEnd = Math.min(text.length, entry.index + 60);
    const context = text.slice(windowStart, windowEnd);
    let label: string | null = null;
    for (const hint of LABEL_HINTS) {
      hint.regex.lastIndex = 0;
      if (hint.regex.test(context)) {
        label = hint.label;
        break;
      }
    }
    items.push({
      label: label ?? 'Pozycja',
      quantity: entry.quantity,
      unit: entry.unit,
      confidence: label ? 'HIGH' : 'MEDIUM',
      quantityFound: true,
    });
  }

  // 3. usługi rozpoznane po słowie, ale bez podanej ilości
  if (items.length === 0) {
    for (const hint of LABEL_HINTS) {
      hint.regex.lastIndex = 0;
      if (hint.regex.test(text)) {
        items.push({
          label: hint.label,
          quantity: null,
          unit: hint.unit,
          confidence: 'LOW',
          quantityFound: false,
        });
        notes.push(`Rozpoznano „${hint.label}”, ale brak ilości — do potwierdzenia.`);
        break;
      }
    }
  }

  const dateResult = findPreferredDate(text, today);
  const time = findTime(text);
  const urgencyResult = detectUrgency(text);
  const contact = findContact(text);
  const address = findAddress(text);

  if (!dateResult.date) notes.push('Nie udało się odczytać terminu — do potwierdzenia.');
  if (!time) notes.push('Nie podano preferowanej godziny — do potwierdzenia.');
  if (items.length === 0) notes.push('Nie rozpoznano zakresu prac — do potwierdzenia.');
  if (!contact.phone && !contact.email) notes.push('Brak telefonu lub e-maila w treści — do potwierdzenia.');

  const needsConfirmation =
    items.length === 0 || items.some((item) => !item.quantityFound) || !dateResult.date || dateResult.confidence === 'LOW';

  return {
    items,
    preferredDate: dateResult.date ? isoDate(dateResult.date) : null,
    preferredDateLabel: dateResult.label,
    preferredTime: time,
    urgency: urgencyResult.urgency,
    contact,
    address,
    notes,
    status: needsConfirmation ? 'NEEDS_CONFIRMATION' : 'OK',
    provider: 'rules',
    usedModel: false,
  };
}
