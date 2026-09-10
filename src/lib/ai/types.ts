/**
 * Abstrakcja dostawcy AI.
 *
 * Zasady:
 *  - AI NIE liczy pieniędzy. Cena zawsze powstaje w silniku cenowym (@/lib/pricing/engine).
 *  - AI NIE może wymyślać danych. Jeżeli czegoś nie da się odczytać z tekstu,
 *    wynik dostaje status NEEDS_CONFIRMATION („Do potwierdzenia”).
 *  - Brak klucza dostawcy = działający system z silnikiem regułowym
 *    (wyraźnie oznaczonym jako regułowy, a nie jako model AI).
 */

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type ParsedRequestItem = {
  /** nazwa rozpoznanej czynności / powierzchni, np. „podjazd”, „taras” */
  label: string;
  quantity: number | null;
  unit: 'SQM' | 'HOUR' | 'PIECE' | 'ROOM' | 'VEHICLE' | 'VISIT' | 'FIXED' | null;
  confidence: Confidence;
  /** czy liczba została faktycznie znaleziona w tekście (false = „do potwierdzenia”) */
  quantityFound: boolean;
};

export type ParsedRequest = {
  items: ParsedRequestItem[];
  preferredDate: string | null; // YYYY-MM-DD
  preferredDateLabel: string | null; // np. „piątek, 2026-09-18”
  preferredTime: string | null; // np. „14:00”
  urgency: 'LOW' | 'NORMAL' | 'HIGH';
  contact: { name: string | null; phone: string | null; email: string | null };
  address: string | null;
  notes: string[];
  status: 'OK' | 'NEEDS_CONFIRMATION' | 'FAILED' | 'NO_PROVIDER';
  provider: string;
  /** true, gdy wynik pochodzi z modelu AI, false — z silnika regułowego */
  usedModel: boolean;
};

export type ParseRequestInput = {
  text: string;
  /** nazwy usług firmy — pomagają dopasować usługę, ale nie pozwalają wymyślać danych */
  serviceNames?: string[];
  today?: Date;
};

export type BusinessSnapshot = Record<string, unknown>;

export interface AIProvider {
  readonly name: string;
  /** czy provider jest realnie skonfigurowany (klucz + model) */
  isConfigured(): boolean;
  parseCustomerRequest(input: ParseRequestInput): Promise<ParsedRequest>;
  /** opisuje wycenę na podstawie policzonych już kwot (AI nie liczy) */
  explainEstimate(input: { items: { name: string; quantity: string; total: string }[]; total: string; customer: string }): Promise<string | null>;
  /** proponuje treść wiadomości (do zatwierdzenia przez użytkownika) */
  generateMessage(input: { goal: string; customer: string; facts: string[] }): Promise<string | null>;
  /** podsumowanie biznesu na podstawie przekazanych, prawdziwych danych */
  summarizeBusiness(input: { snapshot: BusinessSnapshot }): Promise<string | null>;
  /** odpowiedź na pytanie właściciela — wyłącznie na podstawie przekazanych danych */
  answerBusinessQuestion(input: { question: string; data: BusinessSnapshot }): Promise<string | null>;
}
