/**
 * Przechowywanie plików.
 *
 * Zasady bezpieczeństwa:
 *  - nazwa pliku w storage jest generowana przez system (nigdy nie pochodzi od użytkownika),
 *  - typ pliku weryfikujemy po nagłówku (magic bytes), a nie po deklaracji klienta,
 *  - rozmiar jest ograniczony,
 *  - każdy odczyt sprawdza organizationId — użytkownik firmy A nie pobierze pliku firmy B.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { files, type FileRecord } from '@/lib/db/schema';

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB
export const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ANY_BYTES = 25 * 1024 * 1024;

type DetectedType = { mime: string; extension: 'jpg' | 'png' | 'webp' | 'pdf' };

/** Wykrywanie typu po sygnaturze pliku (nie ufamy Content-Type od klienta). */
export function detectFileType(buffer: Buffer): DetectedType | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }
  if (buffer.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', extension: 'pdf' };
  return null;
}

export class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileValidationError';
  }
}

function storageRoot(): string {
  const configured = process.env.STORAGE_DIR || '.storage';
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

/**
 * Zapisuje plik i tworzy rekord w bazie.
 * `kind` określa kontekst użycia (zdjęcie zlecenia, zdjęcie zapytania, PDF oferty...).
 */
export async function saveFile(input: {
  organizationId: string;
  uploadedById?: string | null;
  originalName: string;
  bytes: Buffer;
  kind?: string;
  estimateId?: string | null;
  quoteId?: string | null;
  requestId?: string | null;
  allowed?: 'IMAGE' | 'PDF' | 'ANY';
}): Promise<FileRecord> {
  const { organizationId, bytes } = input;
  const allowed = input.allowed ?? 'IMAGE';

  if (!bytes || bytes.length === 0) {
    throw new FileValidationError('Plik jest pusty.');
  }
  if (bytes.length > MAX_ANY_BYTES) {
    throw new FileValidationError('Plik jest za duży (maksymalnie 25 MB).');
  }

  const detected = detectFileType(bytes);
  if (!detected) {
    throw new FileValidationError('Niedozwolony typ pliku. Dozwolone są zdjęcia (JPG, PNG, WEBP) oraz PDF.');
  }
  if (allowed === 'IMAGE' && detected.mime === 'application/pdf') {
    throw new FileValidationError('W tym miejscu można dodać tylko zdjęcie.');
  }
  if (allowed === 'PDF' && detected.mime !== 'application/pdf') {
    throw new FileValidationError('W tym miejscu można dodać tylko plik PDF.');
  }
  if (detected.mime === 'application/pdf' && bytes.length > MAX_PDF_BYTES) {
    throw new FileValidationError('Dokument PDF jest za duży.');
  }
  if (detected.mime !== 'application/pdf' && bytes.length > MAX_IMAGE_BYTES) {
    throw new FileValidationError('Zdjęcie jest za duże (maksymalnie 12 MB).');
  }

  // bezpieczna, wygenerowana nazwa — oryginalna nazwa jest tylko metadaną
  const storageKey = path.posix.join(organizationId, `${randomBytes(16).toString('hex')}.${detected.extension}`);
  const target = path.join(storageRoot(), storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { mode: 0o600 });

  const checksum = createHash('sha256').update(bytes).digest('hex');

  const [row] = await db
    .insert(files)
    .values({
      organizationId,
      storageKey,
      originalName: (input.originalName || 'plik').slice(0, 200),
      mimeType: detected.mime,
      sizeBytes: bytes.length,
      checksum,
      kind: input.kind ?? 'OTHER',
      uploadedById: input.uploadedById ?? null,
      estimateId: input.estimateId ?? null,
      quoteId: input.quoteId ?? null,
      requestId: input.requestId ?? null,
    })
    .returning();

  return row;
}

/** Zapis wygenerowanego dokumentu (np. PDF oferty/faktury). */
export async function saveGeneratedPdf(input: {
  organizationId: string;
  uploadedById?: string | null;
  bytes: Buffer;
  originalName: string;
  kind?: string;
  quoteId?: string | null;
  estimateId?: string | null;
}): Promise<FileRecord> {
  return saveFile({ ...input, allowed: 'PDF', kind: input.kind ?? 'DOCUMENT' });
}

/**
 * Pobranie pliku z kontrolą dostępu: plik musi należeć do organizacji.
 * Zwraca null, gdy nie istnieje lub nie należy do firmy (IDOR -> brak dostępu).
 */
export async function getFileForOrganization(
  organizationId: string,
  fileId: string,
): Promise<{ record: FileRecord; absolutePath: string; size: number } | null> {
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.organizationId, organizationId)))
    .limit(1);

  const record = rows[0];
  if (!record) return null;

  const absolutePath = path.join(storageRoot(), record.storageKey);
  // ochrona przed path traversal — storageKey zawsze generujemy sami, ale sprawdzamy ponownie
  const root = storageRoot();
  if (!absolutePath.startsWith(root + path.sep)) return null;

  try {
    const info = await stat(absolutePath);
    return { record, absolutePath, size: info.size };
  } catch {
    return null;
  }
}

export function openFileStream(absolutePath: string) {
  return createReadStream(absolutePath);
}
