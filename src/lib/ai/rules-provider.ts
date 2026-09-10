/**
 * Provider „regułowy” — używany, gdy nie skonfigurowano modelu AI.
 * Jasno komunikuje swój charakter (usedModel = false).
 */
import { parseWithRules } from './heuristic';
import type { AIProvider, ParsedRequest, ParseRequestInput } from './types';

export const rulesProvider: AIProvider = {
  name: 'rules',
  isConfigured(): boolean {
    // silnik regułowy jest zawsze dostępny, ale nie jest modelem AI
    return false;
  },
  async parseCustomerRequest(input: ParseRequestInput): Promise<ParsedRequest> {
    return parseWithRules(input);
  },
  async explainEstimate(): Promise<string | null> {
    return null; // brak modelu — UI pokazuje podsumowanie z danych, bez udawanego tekstu
  },
  async generateMessage(): Promise<string | null> {
    return null;
  },
  async summarizeBusiness(): Promise<string | null> {
    return null;
  },
  async answerBusinessQuestion(): Promise<string | null> {
    return null;
  },
};
