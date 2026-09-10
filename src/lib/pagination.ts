/**
 * Paginacja dużych tabel.
 *
 * Zasada: serwer zawsze ogranicza liczbę zwracanych wierszy (limit + offset),
 * a interfejs pokazuje nawigację po stronach. Brak paginacji oznaczałby
 * pobieranie całej tabeli przy każdym wejściu na listę.
 */

export const PAGE_SIZE = 25;

export type PageParams = {
  page: number;
  limit: number;
  offset: number;
};

export function parsePage(raw: string | string[] | undefined, pageSize: number = PAGE_SIZE): PageParams {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  const page = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  // twardy limit — zbyt duża strona nie może obciążyć bazy
  const safePage = Math.min(page, 10_000);
  return { page: safePage, limit: pageSize, offset: (safePage - 1) * pageSize };
}

export function totalPages(total: number, limit: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / limit));
}
