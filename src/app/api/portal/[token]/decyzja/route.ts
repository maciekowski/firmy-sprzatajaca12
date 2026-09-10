import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { rateLimit } from '@/lib/rate-limit';
import { acceptQuoteByToken, rejectQuoteByToken, requestQuoteChangesByToken } from '@/lib/services/quotes';

function clientIp(request: NextRequest): string | undefined {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim();
  return request.headers.get('x-real-ip') ?? undefined;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await request.formData();
  const decision = String(form.get('decyzja') ?? '');
  const actorName = String(form.get('imie') ?? '').trim() || undefined;
  const comment = String(form.get('notatka') ?? '').trim() || undefined;
  const ip = clientIp(request);
  const userAgent = request.headers.get('user-agent') ?? undefined;

  // Ochrona przed spamowaniem publicznego linku (wg IP i tokenu).
  const limit = rateLimit(`portal-decision:${ip}:${token}`, 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Zbyt wiele prób. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    );
  }

  const meta = { actorName, ip, userAgent };

  let result: { ok: boolean; error?: string } | null = null;
  let redirectName: string;

  if (decision === 'akceptuj') {
    result = await acceptQuoteByToken(token, meta);
    redirectName = 'zaakceptowana';
  } else if (decision === 'odrzuc') {
    result = await rejectQuoteByToken(token, comment ? { ...meta, note: comment } : meta);
    redirectName = 'odrzucona';
  } else if (decision === 'zmiany') {
    result = await requestQuoteChangesByToken(token, comment ? { ...meta, note: comment } : meta);
    redirectName = 'zmiany';
  } else {
    return NextResponse.redirect(new URL(`/p/${token}?blad=1`, request.url), 303);
  }

  revalidatePath(`/p/${token}`);
  revalidatePath('/powiadomienia');

  if (!result.ok) {
    return NextResponse.redirect(new URL(`/p/${token}?blad=${encodeURIComponent(result.error ?? '')}`, request.url), 303);
  }

  return NextResponse.redirect(new URL(`/p/${token}?wynik=${redirectName}`, request.url), 303);
}
