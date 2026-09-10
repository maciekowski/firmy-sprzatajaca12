/**
 * Dostawca OpenAI (i każdy serwis zgodny z jego API).
 * Komunikacja przez fetch — bez dodatkowych zależności.
 *
 * Odpowiedź modelu jest zawsze weryfikowana: liczby muszą występować
 * w oryginalnym tekście zapytania (AI nie może ich wymyślić).
 */
import type { AIProvider, ParsedRequest, ParseRequestInput } from './types';

const DEFAULT_MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 20_000;

function endpoint(): string {
  return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
}

async function callModel(system: string, user: string, jsonOnly = true): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        temperature: 0.1,
        response_format: jsonOnly ? { type: 'json_object' } : undefined,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`[ai:openai] odpowiedź ${response.status}`);
      return null;
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.error('[ai:openai] błąd:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Weryfikacja: czy liczba z odpowiedzi faktycznie występuje w tekście. */
function quantityAppearsInText(quantity: number | null, text: string): boolean {
  if (quantity === null) return false;
  const candidates = new Set<string>();
  candidates.add(String(quantity));
  candidates.add(String(Math.round(quantity)));
  if (Number.isInteger(quantity)) {
    candidates.add(String(quantity).replace('.', ','));
  } else {
    candidates.add(String(quantity).replace('.', ','));
    candidates.add(quantity.toFixed(2).replace('.', ','));
  }
  const normalizedText = text.replace(/[\s\u00A0]/g, '');
  for (const candidate of candidates) {
    if (normalizedText.includes(candidate.replace(/[\s\u00A0]/g, ''))) return true;
  }
  return false;
}

export const openaiProvider: AIProvider = {
  name: 'openai',
  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  },
  async parseCustomerRequest(input: ParseRequestInput): Promise<ParsedRequest> {
    const serviceNames = input.serviceNames ?? [];
    const system = [
      'Jesteś analitykiem zapytań dla firmy usługowej. Odpowiadasz WYŁĄCZNIE poprawnym JSON-em.',
      'Nie wolno Ci wymyślać danych. Jeżeli informacja nie wynika wprost z tekstu, zwróć null.',
      'Nie obliczaj żadnych cen ani kwot.',
      'Format: {"items":[{"label":string,"quantity":number|null,"unit":"SQM"|"HOUR"|"PIECE"|"ROOM"|"VEHICLE"|"VISIT"|"FIXED"|null}],',
      '"preferredDate":"YYYY-MM-DD"|null,"preferredTime":"HH:MM"|null,"urgency":"LOW"|"NORMAL"|"HIGH",',
      '"contact":{"name":string|null,"phone":string|null,"email":string|null},"address":string|null,"notes":string[]}',
      serviceNames.length > 0 ? `Dostępne usługi firmy (tylko kontekst): ${serviceNames.join(', ')}.` : '',
      `Dzisiaj jest: ${(input.today ?? new Date()).toISOString().slice(0, 10)}.`,
    ]
      .filter(Boolean)
      .join(' ');

    const raw = await callModel(system, `Treść zapytania klienta:\n"""\n${input.text}\n"""`);
    if (!raw) {
      return {
        items: [],
        preferredDate: null,
        preferredDateLabel: null,
        preferredTime: null,
        urgency: 'NORMAL',
        contact: { name: null, phone: null, email: null },
        address: null,
        notes: ['Model AI nie zwrócił odpowiedzi — wymagana analiza ręczna.'],
        status: 'FAILED',
        provider: 'openai',
        usedModel: true,
      };
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const rawItems = Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
      const items = rawItems.slice(0, 20).map((item) => {
        const quantity = typeof item.quantity === 'number' ? item.quantity : null;
        const found = quantityAppearsInText(quantity, input.text);
        return {
          label: typeof item.label === 'string' ? item.label.slice(0, 120) : 'Pozycja',
          quantity: found ? quantity : null,
          unit: typeof item.unit === 'string' ? (item.unit as never) : null,
          confidence: (found ? 'HIGH' : 'LOW') as never,
          quantityFound: found,
        };
      });

      const notes = Array.isArray(parsed.notes) ? parsed.notes.map((n) => String(n)).slice(0, 10) : [];
      if (items.some((item) => !item.quantityFound)) {
        notes.push('Część danych nie występowała w tekście — do potwierdzenia.');
      }
      const preferredDate = typeof parsed.preferredDate === 'string' ? parsed.preferredDate : null;
      if (!preferredDate) notes.push('Nie rozpoznano terminu — do potwierdzenia.');

      return {
        items,
        preferredDate,
        preferredDateLabel: preferredDate,
        preferredTime: typeof parsed.preferredTime === 'string' ? parsed.preferredTime : null,
        urgency: parsed.urgency === 'HIGH' ? 'HIGH' : parsed.urgency === 'LOW' ? 'LOW' : 'NORMAL',
        contact: {
          name: typeof (parsed.contact as Record<string, unknown>)?.name === 'string' ? String((parsed.contact as Record<string, unknown>).name) : null,
          phone: typeof (parsed.contact as Record<string, unknown>)?.phone === 'string' ? String((parsed.contact as Record<string, unknown>).phone) : null,
          email: typeof (parsed.contact as Record<string, unknown>)?.email === 'string' ? String((parsed.contact as Record<string, unknown>).email) : null,
        },
        address: typeof parsed.address === 'string' ? parsed.address : null,
        notes,
        status: items.some((item) => !item.quantityFound) || !preferredDate ? 'NEEDS_CONFIRMATION' : 'OK',
        provider: 'openai',
        usedModel: true,
      };
    } catch (error) {
      console.error('[ai:openai] niepoprawny JSON:', error instanceof Error ? error.message : error);
      return {
        items: [],
        preferredDate: null,
        preferredDateLabel: null,
        preferredTime: null,
        urgency: 'NORMAL',
        contact: { name: null, phone: null, email: null },
        address: null,
        notes: ['Nie udało się zinterpretować odpowiedzi modelu — wymagana analiza ręczna.'],
        status: 'FAILED',
        provider: 'openai',
        usedModel: true,
      };
    }
  },
  async explainEstimate(input): Promise<string | null> {
    const system =
      'Jesteś asystentem firmy usługowej. Opisz wycenę krótko i konkretnie po polsku. Nie zmieniaj kwot, nie wymyślaj danych. Maksymalnie 4 zdania.';
    return callModel(
      system,
      `Klient: ${input.customer}\nPozycje: ${input.items.map((i) => `${i.name} (${i.quantity} × ${i.total})`).join('; ')}\nRazem: ${input.total}`,
      false,
    );
  },
  async generateMessage(input): Promise<string | null> {
    const system =
      'Napisz krótką, profesjonalną wiadomość po polsku. Używaj wyłącznie podanych faktów. Bez wymyślonych obietnic i bez cudzysłowów wokół całości.';
    return callModel(system, `Cel: ${input.goal}\nKlient: ${input.customer}\nFakty: ${input.facts.join('; ')}`, false);
  },
  async summarizeBusiness(input): Promise<string | null> {
    const system =
      'Podsumuj stan firmy usługowej po polsku na podstawie otrzymanych danych. Nie wymyślaj liczb — używaj wyłącznie podanych. Maksymalnie 6 zdań.';
    return callModel(system, `Dane: ${JSON.stringify(input.snapshot)}`, false);
  },
  async answerBusinessQuestion(input): Promise<string | null> {
    const system = [
      'Odpowiadasz na pytanie właściciela firmy usługowej po polsku.',
      'Wolno Ci używać WYŁĄCZNIE danych z sekcji DANE. Jeżeli odpowiedź nie wynika z danych, napisz wprost, że tych danych nie ma w systemie.',
      'Nie wymyślaj liczb. Odpowiadaj krótko (2-5 zdań).',
    ].join(' ');
    return callModel(system, `DANE: ${JSON.stringify(input.data)}\n\nPYTANIE: ${input.question}`, false);
  },
};
