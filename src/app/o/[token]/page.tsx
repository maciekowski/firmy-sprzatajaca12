import Link from 'next/link';
import { notFound } from 'next/navigation';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import { headers } from 'next/headers';
import { rateLimit } from '@/lib/rate-limit';
import { getReviewRequestByToken, submitReview } from '@/lib/services/reviews';

export const metadata = { title: 'Opinia', robots: { index: false, follow: false } };

/** Publiczny formularz opinii — dostęp na podstawie tokenu. */
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ blad?: string }>;
}) {
  const { token } = await params;
  const { blad } = await searchParams;

  const request = await getReviewRequestByToken(token);
  if (!request) notFound();

  const [organization] = await db.select().from(organizations).where(eq(organizations.id, request.organizationId)).limit(1);

  async function submit(formData: FormData) {
    'use server';
    const forwarded = (await headers()).get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0]!.trim() : 'unknown';

    const limit = rateLimit(`review:${ip}:${token}`, 10, 60_000);
    if (!limit.allowed) redirect(`/o/${token}?blad=${encodeURIComponent(`Zbyt wiele prób. Spróbuj ponownie za ${limit.retryAfterSeconds} s.`)}`);

    const rating = Number(formData.get('rating') ?? 0);
    const comment = String(formData.get('comment') ?? '') || null;
    const result = await submitReview(token, { rating, comment });
    if (!result.ok) redirect(`/o/${token}?blad=${encodeURIComponent(result.error)}`);
    redirect(`/o/${token}/podziekowanie`);
  }

  if (request.status === 'COMPLETED') {
    return (
      <Shell organizationName={organization?.name ?? 'ServiceFlow'}>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Dziękujemy za opinię!</h1>
        <p className="mt-2 text-sm text-ink-700">
          Twoja ocena: {request.rating}/5{request.comment ? ` · „${request.comment}”` : ''}
        </p>
      </Shell>
    );
  }

  return (
    <Shell organizationName={organization?.name ?? 'ServiceFlow'}>
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">Jak oceniasz wykonaną usługę?</h1>
      <p className="mt-1 text-sm text-ink-600">Ocena trafia bezpośrednio do firmy — to jedyne miejsce, gdzie ją zapisujemy.</p>

      {blad ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{blad}</div>
      ) : null}

      <form action={submit} className="mt-5 space-y-4">
        <fieldset>
          <legend className="stat-label">Ocena</legend>
          <div className="mt-2 flex gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value} className="flex-1">
                <input type="radio" name="rating" value={value} required className="peer sr-only" />
                <span className="block cursor-pointer rounded-lg border border-ink-200 py-3 text-center text-sm text-ink-700 peer-checked:border-brand-500 peer-checked:bg-brand-50 peer-checked:text-brand-800">
                  {value}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="label" htmlFor="comment">
            Komentarz (opcjonalnie)
          </label>
          <textarea id="comment" name="comment" rows={4} className="input" placeholder="Co było dobrze, co poprawić?" />
        </div>

        <button type="submit" className="btn-primary w-full">
          Wyślij opinię
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children, organizationName }: { children: React.ReactNode; organizationName: string }) {
  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto max-w-lg px-5 py-12">
        <div className="card p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{organizationName}</p>
          {children}
        </div>
        <div className="mt-6 flex items-center justify-between text-xs text-ink-500">
          <span>Formularz opinii ServiceFlow.</span>
          <Link href="/" className="hover:underline">
            ServiceFlow
          </Link>
        </div>
      </div>
    </div>
  );
}
