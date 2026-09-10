import Link from 'next/link';

/**
 * Nawigacja po stronach listy. Linki zachowują aktualne filtry (np. status),
 * dzięki czemu paginacja nie gubi kontekstu wyszukiwania.
 */
export function Pagination({
  page,
  pages,
  basePath,
  query = {},
}: {
  page: number;
  pages: number;
  basePath: string;
  query?: Record<string, string | number | undefined>;
}) {
  if (pages <= 1) return null;

  function href(target: number): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue;
      params.set(key, String(value));
    }
    if (target > 1) params.set('strona', String(target));
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  }

  const from = (page - 1) * 1 + 1;

  return (
    <nav className="flex items-center justify-between border-t border-ink-100 pt-3 text-sm" aria-label="Paginacja">
      <p className="text-ink-500">
        Strona <span className="tabular font-medium text-ink-800">{page}</span> z{' '}
        <span className="tabular font-medium text-ink-800">{pages}</span>
        <span className="sr-only"> (pozycja od {from})</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="btn-secondary">
            ← Poprzednia
          </Link>
        ) : (
          <span className="btn-secondary pointer-events-none opacity-50">← Poprzednia</span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className="btn-secondary">
            Następna →
          </Link>
        ) : (
          <span className="btn-secondary pointer-events-none opacity-50">Następna →</span>
        )}
      </div>
    </nav>
  );
}
