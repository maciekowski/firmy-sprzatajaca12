import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getOrgContext } from '@/lib/auth/guards';
import { getFileForOrganization, openFileStream } from '@/lib/storage';

/**
 * Odczyt pliku — zawsze z kontrolą organizacji.
 * Zdjęcia są wczytywane przez przeglądarkę, dlatego dla personelu firmy
 * wymagamy zalogowania (inna organizacja dostaje 404, nie 403 — nie zdradzamy istnienia).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getOrgContext();
  if (!context) return new NextResponse('Brak autoryzacji', { status: 401 });

  const { id } = await params;
  const found = await getFileForOrganization(context.organization.id, id);
  if (!found) return new NextResponse('Nie znaleziono pliku', { status: 404 });

  const stream = Readable.toWeb(openFileStream(found.absolutePath)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      'content-type': found.record.mimeType,
      'content-length': String(found.size),
      'cache-control': 'private, max-age=60',
      'content-disposition': `inline; filename="${encodeURIComponent(found.record.originalName)}"`,
    },
  });
}
