import type { Metadata } from 'next';
import Link from 'next/link';
import { requireOrgContext, getUserOrganizations } from '@/lib/auth/guards';
import { logoutAction } from '@/app/(auth)/actions';
import { MobileNav, NavLink } from '@/components/app/nav';
import { NAV_ITEMS } from '@/lib/nav';
import { ROLE_LABELS } from '@/lib/authz/permissions';
import { NotificationBell } from '@/components/app/notification-bell';
import { getUnreadNotifications } from '@/lib/queries/notifications';

// Aplikacja jest prywatna — nie indeksujemy jej w wyszukiwarkach.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await requireOrgContext();
  const organizations = await getUserOrganizations(context.user.id);
  const visibleNav = NAV_ITEMS.filter((item) => !item.permission || context.can(item.permission));
  const unread = await getUnreadNotifications(context.organization.id, context.user.id);

  return (
    <div className="min-h-screen bg-ink-50">
      <MobileNav items={visibleNav} />

      <div className="flex">
        <aside className="hidden w-60 shrink-0 border-r border-ink-200 bg-white lg:block">
          <div className="flex h-16 items-center gap-2 border-b border-ink-100 px-5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">SF</span>
            <span className="text-lg font-semibold tracking-tight text-ink-900">ServiceFlow</span>
          </div>

          <div className="border-b border-ink-100 px-3 py-3">
            <p className="truncate px-2 text-sm font-medium text-ink-900">{context.organization.name}</p>
            <p className="truncate px-2 text-xs text-ink-500">
              {context.user.name} · {ROLE_LABELS[context.role]}
            </p>
          </div>

          <nav className="space-y-1 p-3">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} can={item.permission ? context.can(item.permission) : true} />
            ))}
          </nav>

          <div className="mt-auto border-t border-ink-100 p-3">
            {organizations.length > 1 ? (
              <p className="px-2 pb-2 text-xs text-ink-500">
                Firmy: {organizations.length} (aktywna: {context.organization.name})
              </p>
            ) : null}
            <form action={logoutAction}>
              <button type="submit" className="nav-link w-full">
                Wyloguj się
              </button>
            </form>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-ink-200 bg-white/90 px-5 backdrop-blur">
            <div className="hidden text-sm text-ink-500 lg:block">
              <Link href="/dashboard" className="hover:text-ink-700">
                {context.organization.name}
              </Link>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <NotificationBell unread={unread} />
              <Link href="/ustawienia/konto" className="flex items-center gap-2 text-sm text-ink-700 hover:text-ink-900">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-ink-100 text-xs font-semibold text-ink-700">
                  {context.user.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden sm:block">{context.user.name}</span>
              </Link>
            </div>
          </header>

          <main className="px-5 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
