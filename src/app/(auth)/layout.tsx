import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <div className="mx-auto w-full max-w-md flex-1 px-5 py-10">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">SF</span>
          <span className="text-xl font-semibold tracking-tight text-ink-900">ServiceFlow</span>
        </Link>
        {children}
      </div>
      <div className="py-6 text-center text-xs text-ink-500">
        <Link href="/" className="hover:text-ink-700">
          ← Wróć na stronę główną
        </Link>
      </div>
    </div>
  );
}
