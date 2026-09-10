import { NextResponse, type NextRequest } from 'next/server';
import { getOrgContext } from '@/lib/auth/guards';
import { FileValidationError, saveFile } from '@/lib/storage';

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Wgrywanie plików (zdjęcia z realizacji, zdjęcia zapytań).
 * Plik jest walidowany po treści (sygnatura), a dostęp do niego zawsze
 * sprawdza organizację — brak możliwości odczytu cudzego pliku.
 */
export async function POST(request: NextRequest) {
  const context = await getOrgContext();
  if (!context) return NextResponse.json({ error: 'Brak autoryzacji.' }, { status: 401 });

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Plik jest za duży (maksymalnie 25 MB).' }, { status: 413 });
  }

  const form = await request.formData();
  const file = form.get('plik');
  const kind = String(form.get('kind') ?? 'JOB_PHOTO');
  const jobId = form.get('jobId') ? String(form.get('jobId')) : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Nie wybrano pliku.' }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const record = await saveFile({
      organizationId: context.organization.id,
      uploadedById: context.user.id,
      originalName: file.name,
      bytes,
      kind,
      allowed: 'IMAGE',
    });

    return NextResponse.json({ fileId: record.id, jobId, mimeType: record.mimeType, sizeBytes: record.sizeBytes });
  } catch (error) {
    if (error instanceof FileValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
