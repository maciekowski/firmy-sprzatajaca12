/**
 * Wybór dostawcy AI.
 *
 * Jeżeli żaden model nie jest skonfigurowany, działa silnik regułowy
 * (wyraźnie oznaczony jako regułowy — nie udajemy, że to model AI).
 * Cały system działa poprawnie w obu przypadkach.
 */
import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import { rulesProvider } from './rules-provider';
import type { AIProvider } from './types';

export type AIProviderName = 'openai' | 'anthropic' | 'rules';

export function getAIProvider(): AIProvider {
  const configured = (process.env.AI_PROVIDER ?? '').toLowerCase();
  if (configured === 'openai' && openaiProvider.isConfigured()) return openaiProvider;
  if (configured === 'anthropic' && anthropicProvider.isConfigured()) return anthropicProvider;
  if (!configured) {
    if (openaiProvider.isConfigured()) return openaiProvider;
    if (anthropicProvider.isConfigured()) return anthropicProvider;
  }
  return rulesProvider;
}

export function aiProviderStatus(): { name: string; configured: boolean; label: string } {
  const provider = getAIProvider();
  const configured = provider.name !== 'rules' && provider.isConfigured();
  return {
    name: provider.name,
    configured,
    label: configured
      ? `Model AI: ${provider.name}`
      : 'Silnik regułowy (brak skonfigurowanego modelu AI) — oznacza to działanie bez modelu, nie udawane AI.',
  };
}

export { parseWithRules } from './heuristic';
export type {
  AIProvider,
  BusinessSnapshot,
  Confidence,
  ParsedRequest,
  ParsedRequestItem,
  ParseRequestInput,
} from './types';
