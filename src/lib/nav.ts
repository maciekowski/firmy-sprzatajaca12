import type { Permission } from '@/lib/authz/permissions';

/** Ikony dostępne w nawigacji (klucz mapowany na komponent w komponencie klienckim). */
export type NavIconKey =
  | 'LayoutDashboard'
  | 'Users'
  | 'Users2'
  | 'Briefcase'
  | 'Inbox'
  | 'FileText'
  | 'ClipboardList'
  | 'CalendarDays'
  | 'Wallet'
  | 'MessageSquare'
  | 'Zap'
  | 'Star'
  | 'BarChart3'
  | 'Sparkles'
  | 'Settings';

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconKey;
  permission?: Permission;
};

/**
 * Definicja nawigacji żyje w module serwerowym (nie w komponencie 'use client'),
 * dzięki czemu layout (Server Component) dostaje prawdziwą tablicę, a nie referencję.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { href: '/klienci', label: 'Klienci', icon: 'Users', permission: 'customer:read' },
  { href: '/leady', label: 'Leady', icon: 'Briefcase', permission: 'lead:read' },
  { href: '/zapytania', label: 'Zapytania', icon: 'Inbox', permission: 'request:read' },
  { href: '/wyceny', label: 'Wyceny', icon: 'FileText', permission: 'estimate:read' },
  { href: '/oferty', label: 'Oferty', icon: 'FileText', permission: 'quote:read' },
  { href: '/zlecenia', label: 'Zlecenia', icon: 'ClipboardList', permission: 'job:read' },
  { href: '/kalendarz', label: 'Kalendarz', icon: 'CalendarDays', permission: 'job:read' },
  { href: '/ekipy', label: 'Ekipy', icon: 'Users2', permission: 'job:read' },
  { href: '/faktury', label: 'Faktury', icon: 'Wallet', permission: 'invoice:read' },
  { href: '/komunikacja', label: 'Komunikacja', icon: 'MessageSquare', permission: 'communication:send' },
  { href: '/automatyzacje', label: 'Automatyzacje', icon: 'Zap', permission: 'automation:manage' },
  { href: '/opinie', label: 'Opinie', icon: 'Star', permission: 'review:manage' },
  { href: '/analityka', label: 'Analityka', icon: 'BarChart3', permission: 'analytics:read' },
  { href: '/asystent', label: 'Asystent AI', icon: 'Sparkles', permission: 'analytics:read' },
  { href: '/ustawienia', label: 'Ustawienia', icon: 'Settings', permission: 'org:manage' },
];
