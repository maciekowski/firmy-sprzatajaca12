'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  BarChart3,
  Briefcase,
  CalendarDays,
  ClipboardList,
  FileText,
  Inbox,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Settings,
  Sparkles,
  Star,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { Permission } from '@/lib/authz/permissions';
import { NAV_ITEMS, type NavIconKey, type NavItem } from '@/lib/nav';

export { NAV_ITEMS };
export type { NavItem };

const ICONS: Record<NavIconKey, LucideIcon> = {
  LayoutDashboard,
  Users,
  Briefcase,
  Inbox,
  FileText,
  ClipboardList,
  CalendarDays,
  Users2: Users,
  Wallet,
  MessageSquare,
  Zap,
  Star,
  BarChart3,
  Sparkles,
  Settings,
};

export function NavLink({ item, can }: { item: NavItem; can: boolean }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  if (item.permission && !can) return null;
  const Icon = ICONS[item.icon];

  return (
    <Link href={item.href} className={clsx('nav-link', active && 'nav-link-active')}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="lg:hidden">
      <div className="flex items-center justify-between border-b border-ink-200 bg-white px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">SF</span>
          <span className="font-semibold text-ink-900">ServiceFlow</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
          aria-label="Menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open ? (
        <nav className="space-y-1 border-b border-ink-200 bg-white px-3 py-3" onClick={() => setOpen(false)}>
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href} className={clsx('nav-link', active && 'nav-link-active')}>
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
