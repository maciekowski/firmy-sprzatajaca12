/**
 * Uprawnienia ról.
 *
 * Reguła nadrzędna: uprawnienia są sprawdzane PO STRONIE SERWERA
 * przy każdej operacji. Frontend tylko ukrywa elementy interfejsu.
 */
import type { Role } from '@/lib/db/schema';

export const PERMISSIONS = [
  'org:manage', // ustawienia firmy
  'org:delete',
  'members:manage', // użytkownicy i zaproszenia
  'billing:manage', // subskrypcja
  'service:manage', // katalog usług i cennik
  'customer:read',
  'customer:write',
  'lead:read',
  'lead:write',
  'request:read',
  'request:write',
  'estimate:read',
  'estimate:write',
  'quote:read',
  'quote:write',
  'quote:send',
  'job:read',
  'job:write',
  'job:assign',
  'job:complete',
  'job:self', // pracownik: tylko własne zlecenia
  'crew:manage',
  'invoice:read',
  'invoice:write',
  'invoice:send',
  'payment:write',
  'automation:manage',
  'analytics:read',
  'communication:send',
  'file:upload',
  'review:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const READ_ALL: Permission[] = [
  'customer:read',
  'lead:read',
  'request:read',
  'estimate:read',
  'quote:read',
  'job:read',
  'invoice:read',
  'analytics:read',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL.filter((p) => p !== 'org:delete'),
  DISPATCHER: [
    'customer:read',
    'customer:write',
    'lead:read',
    'lead:write',
    'request:read',
    'request:write',
    'estimate:read',
    'estimate:write',
    'quote:read',
    'quote:write',
    'quote:send',
    'job:read',
    'job:write',
    'job:assign',
    'job:complete',
    'crew:manage',
    'service:manage',
    'automation:manage',
    'communication:send',
    'file:upload',
    'review:manage',
  ],
  WORKER: ['job:read', 'job:self', 'job:complete', 'customer:read', 'file:upload', 'estimate:read', 'quote:read'],
  VIEWER: READ_ALL,
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return permissionsForRole(role).includes(permission);
}

export function canAny(role: Role | undefined | null, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Właściciel',
  ADMIN: 'Administrator',
  DISPATCHER: 'Dyspozytor',
  WORKER: 'Pracownik',
  VIEWER: 'Podgląd',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Pełny dostęp do wszystkich danych, ustawień i płatności.',
  ADMIN: 'Operacje, klienci, finanse i ustawienia — bez usuwania firmy.',
  DISPATCHER: 'Klienci, leady, wyceny, oferty, kalendarz, ekipy i zlecenia.',
  WORKER: 'Tylko przypisane zlecenia: zdjęcia, notatki, checklisty, status, czas pracy.',
  VIEWER: 'Wyłącznie odczyt danych firmy.',
};
