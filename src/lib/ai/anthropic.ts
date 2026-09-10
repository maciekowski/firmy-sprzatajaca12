/**
 * Dostawca Anthropic (Messages API).
 * Używany wyłącznie wtedy, gdy AI_PROVIDER=anthropic i jest klucz.
 */
import type { AIProvider, ParsedRequest, ParseRequestInput } from './types';

const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const TIMEOUT_MS = 25_000;

async function callModel(system: string, user: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        max_tokens: 1024,
        temperature: 0.1,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`[ai:anthropic] odpowiedź ${response.status}`);
      return null;
    }
    const data = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n');
    return text && text.length > 0 ? text : null;
  } catch (error) {
    console.error('[ai:anthropic] błąd:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const anthropicProvider: AIProvider = {
  name: 'anthropic',
  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },
  async parseCustomerRequest(input: ParseRequestInput): Promise<ParsedRequest> {
    const system = [
      'Jesteś analitykiem zapytań dla firmy usługowej. Zwróć WYŁĄCZNIE obiekt JSON (bez komentarza).',
      'Nie wymyślaj danych — jeśli czegoś nie ma w tekście, wpisz null.',
      'Nie obliczaj cen.',
      'Klucze: items[{label,quantity,unit}], preferredDate (YYYY-MM-DD), preferredTime, urgency, contact{name,phone,email}, address, notes[].',
      `Dzisiaj jest: ${(input.today ?? new Date()).toISOString().slice(0, 10)}.`,
    ].join(' ');

    const raw = await callModel(system, `Zapytanie klienta:\n"""\n${input.text}\n"""`);
    if (!raw) {
      return {
        items: [],
        preferredDate: null,
        preferredDateLabel: null,
        preferredTime: null,
        urgency: 'NORMAL',
        contact: { name: null, phone: null, email: null },
        address: null,
        notes: ['Model AI nie zwrócił odpowiedzi.'],
        status: 'FAILED',
        provider: 'anthropic',
        usedModel: true,
      };
    }
    const parsed = extractJson(raw);
    if (!parsed) {
      return {
        items: [],
        preferredDate: null,
        preferredDateLabel: null,
        preferredTime: null,
        urgency: 'NORMAL',
        contact: { name: null, phone: null, email: null },
        address: null,
        notes: ['Nie udało się odczytać odpowiedzi modelu.'],
        status: 'FAILED',
        provider: 'anthropic',
        usedModel: true,
      };
    }

    const rawItems = Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
    const items = rawItems.slice(0, 20).map((item) => {
      const quantity = typeof item.quantity === 'number' ? item.quantity : null;
      const found = quantity !== null && input.text.replace(/\s/g, '').includes(String(quantity));
      return {
        label: typeof item.label === 'string' ? item.label.slice(0, 120) : 'Pozycja',
        quantity: found ? quantity : null,
        unit: typeof item.unit === 'string' ? (item.unit as never) : null,
        confidence: (found ? 'HIGH' : 'LOW') as never,
        quantityFound: found,
      };
    });

    const notes = Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 10) : [];
    const preferredDate = typeof parsed.preferredDate === 'string' ? parsed.preferredDate : null;
    if (items.some((item) => !item.quantityFound)) notes.push('Część danych nie występowała w tekście — do potwierdzenia.');

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
      provider: 'anthropic',
      usedModel: true,
    };
  },
  async explainEstimate(input): Promise<string | null> {
    return callModel(
      'Opisz wycenę po polsku, krótko (maks. 4 zdania). Nie zmieniaj kwot i nie wymyślaj danych.',
      `Klient: ${input.customer}. Pozycje: ${input.items.map((i) => `${i.name} (${i.quantity} × ${i.total})`).join('; ')}. Razem: ${input.total}`,
    );
  },
  async generateMessage(input): Promise<string | null> {
    return callModel(
      'Napisz krótką profesjonalną wiadomość po polsku na podstawie faktów. Nie wymyślaj informacji.',
      `Cel: ${input.goal}. Klient: ${input.customer}. Fakty: ${input.facts.join('; ')}`,
    );
  },
  async summarizeBusiness(input): Promise<string | null> {
    return callModel(
      'Podsumuj stan firmy po polsku wyłącznie na podstawie danych (maks. 6 zdań).',
      `Dane: ${JSON.stringify(input.snapshot)}`,
    );
  },
  async answerBusinessQuestion(input): Promise<string | null> {
    return callModel(
      'Odpowiedz po polsku krótko (2-5 zdań) wyłącznie na podstawie danych. Jeśli danych brakuje, powiedz to wprost.',
      `DANE: ${JSON.stringify(input.data)}\nPYTANIE: ${input.question}`,
    );
  },
};
