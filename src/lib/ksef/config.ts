/**
 * Konfiguracja integracji KSeF.
 *
 * KSeF jest INTEGRACJĄ ZEWNĘTRZNĄ — ServiceFlow nie jest KSeF-em i nie generuje
 * numeru KSeF. Numer przydziela wyłącznie KSeF i tylko taki numer zapisujemy.
 *
 * Wymagane zmienne (brak = status NOT_CONFIGURED, nigdy nie udajemy sukcesu):
 *  - KSEF_MODE            — TEST | PROD
 *  - KSEF_NIP             — NIP podatnika
 *  - KSEF_TOKEN           — token KSeF (autoryzacja tokenem)
 *  - KSEF_ENVIRONMENT_URL — opcjonalnie: nadpisanie adresu API
 */
export type KsefMode = 'TEST' | 'PROD';

export const KSEF_DEFAULT_URLS: Record<KsefMode, string> = {
  TEST: 'https://ksef-test.mf.gov.pl/api/v2',
  PROD: 'https://ksef.mf.gov.pl/api/v2',
};

export type KsefConfig = {
  mode: KsefMode;
  nip: string;
  token: string;
  baseUrl: string;
  /** Formularz logiczny — obowiązująca struktura FA(3). */
  formCode: { systemCode: string; schemaVersion: string; value: string };
};

export function getKsefConfig(): KsefConfig | null {
  const nip = (process.env.KSEF_NIP ?? '').replace(/[^0-9]/g, '');
  const token = process.env.KSEF_TOKEN ?? '';
  const modeRaw = (process.env.KSEF_MODE ?? '').toUpperCase();

  if (!nip || !token) return null;
  if (modeRaw !== 'TEST' && modeRaw !== 'PROD') return null;

  const mode: KsefMode = modeRaw;
  return {
    mode,
    nip,
    token,
    baseUrl: (process.env.KSEF_ENVIRONMENT_URL ?? '').replace(/\/$/, '') || KSEF_DEFAULT_URLS[mode],
    formCode: { systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' },
  };
}

export function isKsefConfigured(): boolean {
  return getKsefConfig() !== null;
}

export const KSEF_STATUS_LABELS: Record<string, string> = {
  NOT_CONFIGURED: 'Nie skonfigurowano',
  READY: 'Gotowa do wysłania',
  SUBMITTING: 'Wysyłanie',
  SUBMITTED: 'Wysłana',
  PROCESSING: 'Przetwarzanie w KSeF',
  ACCEPTED: 'Przyjęta',
  REJECTED: 'Odrzucona',
  ERROR: 'Błąd',
};
