/**
 * Klient API KSeF (v2) — prawdziwe wywołania HTTP.
 *
 * Zasady:
 *  - brak konfiguracji → NOT_CONFIGURED (żadnego udawanego wysłania),
 *  - timeout i błędy sieci są przekształcane w czytelny błąd (status ERROR),
 *  - numer KSeF przyjmujemy WYŁĄCZNIE z odpowiedzi KSeF,
 *  - retry jest bezpieczny: najpierw pytamy o stan, dopiero potem wysyłamy ponownie.
 */
import { createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes, constants as cryptoConstants } from 'node:crypto';
import { getKsefConfig, type KsefConfig } from './config';

export type KsefError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type KsefSubmitResult =
  | { ok: true; referenceNumber: string; invoiceHash: string }
  | { ok: false; error: KsefError };

export type KsefStatusResult =
  | {
      ok: true;
      state: 'PROCESSING' | 'ACCEPTED' | 'REJECTED' | 'ERROR';
      /** numer nadany przez KSeF — tylko jeśli KSeF go zwrócił */
      ksefNumber: string | null;
      code: number | null;
      description: string | null;
    }
  | { ok: false; error: KsefError };

export type KsefUpoResult = { ok: true; upoXml: string } | { ok: false; error: KsefError };

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;

async function request<T>(config: KsefConfig, path: string, init: { method: string; body?: unknown; token?: string | null }): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: init.method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });

    const text = await response.text();
    const raw = text ? (safeJson<Record<string, unknown>>(text) as Record<string, unknown>) : {};

    if (!response.ok) {
      const exception = raw.exception as { exceptionDetailList?: { exceptionDescription?: string }[] } | undefined;
      const detail = exception?.exceptionDetailList?.[0]?.exceptionDescription;
      const message = typeof raw.message === 'string' ? raw.message : undefined;
      throw new KsefHttpError({
        code: String(response.status),
        message: detail ?? message ?? `KSeF zwrócił status ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    return raw as unknown as T;
  } catch (error) {
    if (error instanceof KsefHttpError) throw error;
    const message = error instanceof Error ? error.message : 'nieznany błąd';
    const isTimeout = message.toLowerCase().includes('abort');
    throw new KsefHttpError({
      code: isTimeout ? 'TIMEOUT' : 'NETWORK',
      message: isTimeout
        ? `KSeF nie odpowiedział w ciągu ${TIMEOUT_MS / 1000} s.`
        : `Błąd połączenia z KSeF: ${message}`,
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

class KsefHttpError extends Error {
  readonly details: KsefError;
  constructor(details: KsefError) {
    super(details.message);
    this.details = details;
  }
}

function safeJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return { message: text.slice(0, 200) } as unknown as T;
  }
}

function toKsefError(error: unknown): KsefError {
  if (error instanceof KsefHttpError) return error.details;
  const message = error instanceof Error ? error.message : 'nieznany błąd';
  return { code: 'UNKNOWN', message, retryable: false };
}

/** Pobranie certyfikatów klucza publicznego do szyfrowania faktury. */
async function fetchEncryptionCertificates(config: KsefConfig): Promise<{ certificate: string; validTo: string }[]> {
  const data = await request<{ certificates?: { certificate: string; validTo: string }[] }>(
    config,
    '/security/public-key-certificates',
    { method: 'GET' },
  );
  const list = data.certificates ?? [];
  if (list.length === 0) {
    throw new KsefHttpError({ code: 'NO_CERT', message: 'KSeF nie zwrócił certyfikatu klucza publicznego.', retryable: false });
  }
  return list;
}

/** Szyfrowanie dokumentu: AES-256-CBC + klucz sesyjny szyfrowany RSA-OAEP (SHA-256). */
function encryptPayload(xml: string, certificatePemBase64: string) {
  const symmetricKey = randomBytes(32);
  const initializationVector = randomBytes(16);

  const cipher = createCipheriv('aes-256-cbc', symmetricKey, initializationVector);
  const encrypted = Buffer.concat([cipher.update(xml, 'utf8'), cipher.final()]);

  const publicKey = createPublicKey({
    key: `-----BEGIN CERTIFICATE-----\n${certificatePemBase64.replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`,
    format: 'pem',
  });

  const encryptedKey = publicEncrypt(
    { key: publicKey, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    symmetricKey,
  );

  return {
    encryptedContent: encrypted.toString('base64'),
    encryptedSymmetricKey: encryptedKey.toString('base64'),
    initializationVector: initializationVector.toString('base64'),
    invoiceHash: createHash('sha256').update(xml, 'utf8').digest('base64'),
  };
}

type SessionResponse = { referenceNumber?: string; sessionToken?: { token?: string } };

/**
 * Otwarcie sesji online i wysłanie faktury.
 * Wymaga konfiguracji (KSEF_NIP + KSEF_TOKEN + KSEF_MODE).
 */
export async function submitInvoice(xml: string): Promise<KsefSubmitResult> {
  const config = getKsefConfig();
  if (!config) {
    return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Integracja KSeF nie jest jeszcze skonfigurowana.', retryable: false } };
  }

  try {
    const challengeResponse = await request<{ challenge: string; timestamp: string }>(config, '/auth/challenge', {
      method: 'POST',
      body: { contextIdentifier: { type: 'onip', value: config.nip } },
    });

    const certificates = await fetchEncryptionCertificates(config);
    const newest = certificates[0];
    const encrypted = encryptPayload(xml, newest.certificate);

    const session = await request<SessionResponse>(config, '/sessions/online', {
      method: 'POST',
      body: {
        challenge: challengeResponse.challenge,
        contextIdentifier: { type: 'onip', value: config.nip },
        formCode: config.formCode,
        encryption: {
          encryptedSymmetricKey: encrypted.encryptedSymmetricKey,
          initializationVector: encrypted.initializationVector,
        },
      },
    });

    const sessionToken = session.sessionToken?.token;
    const referenceNumber = session.referenceNumber;
    if (!sessionToken || !referenceNumber) {
      throw new KsefHttpError({ code: 'NO_SESSION', message: 'KSeF nie zwrócił sesji wysyłki.', retryable: true });
    }

    const sent = await request<{ referenceNumber?: string }>(
      config,
      `/sessions/online/${referenceNumber}/invoices`,
      {
        method: 'POST',
        token: sessionToken,
        body: {
          invoiceHash: encrypted.invoiceHash,
          invoicePayload: encrypted.encryptedContent,
        },
      },
    );

    const invoiceReference = sent.referenceNumber;
    if (!invoiceReference) {
      throw new KsefHttpError({ code: 'NO_REF', message: 'KSeF nie zwrócił numeru referencyjnego zgłoszenia.', retryable: false });
    }

    return { ok: true, referenceNumber: invoiceReference, invoiceHash: encrypted.invoiceHash };
  } catch (error) {
    return { ok: false, error: toKsefError(error) };
  }
}

/**
 * Pobranie stanu faktury z KSeF.
 * Mapowanie kodów KSeF:
 *  - 200 → ACCEPTED (i numer KSeF, jeśli jest w odpowiedzi),
 *  - 1xx → PROCESSING,
 *  - 4xx/5xx → REJECTED (błąd walidacji dokumentu) lub ERROR (błąd techniczny).
 */
export async function getInvoiceStatus(referenceNumber: string): Promise<KsefStatusResult> {
  const config = getKsefConfig();
  if (!config) {
    return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Integracja KSeF nie jest jeszcze skonfigurowana.', retryable: false } };
  }

  let lastError: KsefError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const data = await request<{ status?: { code?: number; description?: string }; ksefNumber?: string; invoiceNumber?: string }>(
        config,
        `/invoices/${referenceNumber}`,
        { method: 'GET' },
      );

      const code = data.status?.code ?? null;
      const description = data.status?.description ?? null;
      const ksefNumber = data.ksefNumber ?? data.invoiceNumber ?? null;

      if (code === 200) {
        return { ok: true, state: 'ACCEPTED', ksefNumber, code, description };
      }
      if (code !== null && code < 200) {
        return { ok: true, state: 'PROCESSING', ksefNumber: null, code, description };
      }
      if (code !== null && code >= 400 && code < 500) {
        return { ok: true, state: 'REJECTED', ksefNumber: null, code, description };
      }
      return { ok: true, state: 'ERROR', ksefNumber: null, code, description: description ?? `Nieobsługiwany kod KSeF: ${code}` };
    } catch (error) {
      lastError = toKsefError(error);
      if (!lastError.retryable || attempt === MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  return { ok: false, error: lastError ?? { code: 'UNKNOWN', message: 'Nie udało się pobrać statusu z KSeF.', retryable: false } };
}

/** Pobranie UPO — tylko gdy KSeF faktycznie je udostępni. */
export async function getUpo(referenceNumber: string): Promise<KsefUpoResult> {
  const config = getKsefConfig();
  if (!config) {
    return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Integracja KSeF nie jest jeszcze skonfigurowana.', retryable: false } };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const response = await fetch(`${config.baseUrl}/invoices/${referenceNumber}/upo`, {
      method: 'GET',
      headers: { accept: 'application/xml' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.status === 404 || response.status === 409) {
      return { ok: false, error: { code: 'UPO_NOT_AVAILABLE', message: 'UPO nie jest jeszcze dostępne w KSeF.', retryable: false } };
    }
    if (!response.ok) {
      return { ok: false, error: { code: String(response.status), message: `KSeF zwrócił status ${response.status} dla UPO.`, retryable: response.status >= 500 } };
    }

    return { ok: true, upoXml: await response.text() };
  } catch (error) {
    return { ok: false, error: toKsefError(error) };
  }
}
