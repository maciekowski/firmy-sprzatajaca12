import { NextResponse, type NextRequest } from 'next/server';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { generateJpkFa } from '@/lib/exports/jpk';
import { rateLimit } from '@/lib/rate-limit';

/**
 * Eksport JPK_FA wskazanej firmy za okres.
 * Dostęp: uprawnienie `invoice:read` — nigdy osoba spoza firmy.
 */
export async function GET(request: NextRequest) {
  let context;
  try {
    context = await requirePermissionOrThrow('invoice:read');
  } catch {
    return NextResponse.json({ error: 'Brak dostępu.' }, { status: 403 });
  }

  const limit = rateLimit(`jpk:${context.organization.id}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Zbyt wiele eksportów. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  const params = request.nextUrl.searchParams;
  const from = new Date(`${String(params.get('od') ?? '')}T00:00:00.000Z`);
  const to = new Date(`${String(params.get('do') ?? '')}T23:59:59.999Z`);

  const result = await generateJpkFa(context.organization.id, from, to);
  if (!result.ok) {
    const badRange = Number.isNaN(from.getTime()) || Number.isNaN(to.getTime());
    return NextResponse.json({ error: result.error }, { status: badRange ? 400 : 422 });
  }

  return new NextResponse(result.xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'content-disposition': `attachment; filename="${result.fileName}"`,
    },
  });
}
