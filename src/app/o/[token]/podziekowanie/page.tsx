import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import { getReviewRequestByToken } from '@/lib/services/reviews';

export const metadata = { title: 'Dziękujemy', robots: { index: false, follow: false } };

export default async function ReviewThanksPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await getReviewRequestByToken(token);
  if (!request) notFound();

  const [organization] = await db.select().from(organizations).where(eq(organizations.id, request.organizationId)).limit(1);

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto max-w-lg px-5 py-16 text-center">
        <div className="card p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Dziękujemy za opinię</h1>
          <p className="mt-2 text-sm text-ink-700">
            Twoja ocena została zapisana{request.rating ? ` (${request.rating}/5)` : ''}. Dzięki niej {organization?.name ?? 'firma'} może
            poprawiać jakość usług.
          </p>
          {request.externalUrl ? (
            <a href={request.externalUrl} target="_blank" rel="noreferrer" className="btn-secondary mt-4">
              Dodaj opinię też w Google
            </a>
          ) : null}
        </div>
        <div className="mt-6 text-xs text-ink-500">
          <Link href="/" className="hover:underline">
            ServiceFlow
          </Link>
        </div>
      </div>
    </div>
  );
}
