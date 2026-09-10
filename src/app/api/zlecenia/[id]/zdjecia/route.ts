import { NextResponse, type NextRequest } from 'next/server';
import { getOrgContext } from '@/lib/auth/guards';
import { FileValidationError, saveFile } from '@/lib/storage';
import { addJobPhoto } from '@/lib/services/jobs';

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Dodanie zdjęcia do zlecenia (działa też bez JavaScriptu — zwykły formularz).
 * Plik trafia najpierw do storage z walidacją sygnatury, potem jest wiązany ze zleceniem.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await getOrgContext();
  if (!context) return NextResponse.json({ error: 'Brak autoryzacji.' }, { status: 401 });
  if (!context.can('job:write')) return NextResponse.json({ error: 'Brak uprawnień.' }, { status: 403 });

  const { id } = await params;
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Plik jest za duży (maksymalnie 25 MB).' }, { status: 413 });
  }

  const form = await request.formData();
  const file = form.get('plik');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Nie wybrano pliku.' }, { status: 400 });
  }

  const type = (String(form.get('type') ?? 'OTHER') || 'OTHER') as 'BEFORE' | 'DURING' | 'AFTER' | 'OTHER';
  const caption = String(form.get('caption') ?? '') || undefined;
  const ctx = { organizationId: context.organization.id, userId: context.user.id, userName: context.user.name };

  try {
    const record = await saveFile({
      organizationId: context.organization.id,
      uploadedById: context.user.id,
      originalName: file.name || 'zdjecie.jpg',
      bytes: Buffer.from(await file.arrayBuffer()),
      kind: 'JOB_PHOTO',
      allowed: 'IMAGE',
    });

    const result = await addJobPhoto(ctx, id, record.id, type, caption);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof FileValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const target = new URL(`/zlecenia/${id}?wynik=zdjecie`, request.nextUrl.origin);
  return NextResponse.redirect(target, 303);
}
