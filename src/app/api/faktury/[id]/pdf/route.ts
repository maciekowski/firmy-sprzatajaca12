import { NextResponse, type NextRequest } from 'next/server';
import { getOrgContext } from '@/lib/auth/guards';
import { getInvoiceByToken } from '@/lib/services/invoices';
import { buildInvoicePdf } from '@/lib/pdf/build';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = request.nextUrl.searchParams.get('token');

  let organizationId: string | null = null;

  if (token) {
    // dostęp publiczny: token z linku jest sekretem, ale sprawdzamy, czy pasuje do tej faktury
    const invoice = await getInvoiceByToken(token);
    if (!invoice || invoice.id !== id) return new NextResponse('Nie znaleziono faktury', { status: 404 });
    organizationId = invoice.organizationId;
  } else {
    const context = await getOrgContext();
    if (!context) return new NextResponse('Brak autoryzacji', { status: 401 });
    if (!context.can('invoice:read')) return new NextResponse('Brak uprawnień', { status: 403 });
    organizationId = context.organization.id;
  }

  const document = await buildInvoicePdf(organizationId, id);
  if (!document) return new NextResponse('Nie znaleziono faktury', { status: 404 });

  return new NextResponse(new Uint8Array(document.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${document.filename}"`,
      'cache-control': 'private, no-store',
    },
  });
}
