import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/guards';
import { buildQuotePdf } from '@/lib/pdf/build';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await getOrgContext();
  if (!context) return new NextResponse('Brak autoryzacji', { status: 401 });
  if (!context.can('quote:read')) return new NextResponse('Brak uprawnień', { status: 403 });

  const { id } = await params;
  const document = await buildQuotePdf(context.organization.id, id);
  if (!document) return new NextResponse('Nie znaleziono oferty', { status: 404 });

  return new NextResponse(new Uint8Array(document.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${document.filename}"`,
      'cache-control': 'private, no-store',
    },
  });
}
