import 'server-only';
import { forbidden, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { memberships, organizations, type Organization, type Role, type User } from '@/lib/db/schema';
import { can, type Permission } from '@/lib/authz/permissions';
import { getActiveOrganizationId, getSessionUser } from './session';
import { evaluateSubscription, readOnlyMessage } from '@/lib/billing/subscription';

export type OrgContext = {
  user: User;
  organization: Organization;
  role: Role;
  membershipId: string;
  can: (permission: Permission) => boolean;
};

class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class UnauthorizedError extends AuthError {
  constructor(message = 'Wymagane zalogowanie.') {
    super(message, 401);
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = 'Brak uprawnień do tego zasobu.') {
    super(message, 403);
  }
}

export class NotFoundError extends AuthError {
  constructor(message = 'Nie znaleziono zasobu.') {
    super(message, 404);
  }
}

/** Użytkownik zalogowany — w przeciwnym razie przekierowanie na logowanie. */
export async function requireUser(returnTo?: string): Promise<User> {
  const user = await getSessionUser();
  if (!user) {
    const target = returnTo ? `/logowanie?next=${encodeURIComponent(returnTo)}` : '/logowanie';
    redirect(target);
  }
  return user;
}

/** Lista organizacji, do których użytkownik ma dostęp. */
export async function getUserOrganizations(userId: string): Promise<
  { organization: Organization; role: Role; membershipId: string }[]
> {
  const rows = await db
    .select({
      organization: organizations,
      role: memberships.role,
      membershipId: memberships.id,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(and(eq(memberships.userId, userId), eq(memberships.isActive, true)))
    .orderBy(asc(organizations.createdAt));
  return rows;
}

/**
 * GŁÓWNY PUNKT AUTORYZACJI.
 *
 * Zwraca kontekst organizacji wyłącznie wtedy, gdy zalogowany użytkownik
 * ma aktywne członkostwo w tej organizacji. Nigdy nie ufamy parametrom z URL
 * ani z formularza — organizacja zawsze wynika z członkostwa w bazie.
 */
export async function getOrgContext(organizationId?: string | null): Promise<OrgContext | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const membershipsList = await getUserOrganizations(user.id);
  if (membershipsList.length === 0) return null;

  const wanted = organizationId ?? (await getActiveOrganizationId());
  const selected =
    membershipsList.find((m) => m.organization.id === wanted) ?? membershipsList[0];

  return {
    user,
    organization: selected.organization,
    role: selected.role,
    membershipId: selected.membershipId,
    can: (permission: Permission) => can(selected.role, permission),
  };
}

/** Kontekst wymagany — brak członkostwa oznacza brak dostępu (403/404). */
export async function requireOrgContext(organizationId?: string | null): Promise<OrgContext> {
  const user = await getSessionUser();
  if (!user) redirect('/logowanie');

  const context = await getOrgContext(organizationId);
  if (!context) {
    // użytkownik bez firmy — kierujemy do onboardingu
    redirect('/onboarding');
  }
  return context;
}

/** Wymuszenie konkretnego uprawnienia (widoki / server actions). */
export async function requirePermission(permission: Permission, organizationId?: string | null): Promise<OrgContext> {
  const context = await requireOrgContext(organizationId);
  if (!context.can(permission)) {
    forbidden();
  }
  return context;
}

/** Zwraca błąd zamiast przekierowania (API route / server action). */
export async function requireOrgContextOrThrow(organizationId?: string | null): Promise<OrgContext> {
  const context = await getOrgContext(organizationId);
  if (!context) {
    const user = await getSessionUser();
    throw user ? new ForbiddenError('Brak dostępu do tej firmy.') : new UnauthorizedError();
  }
  return context;
}

export async function requirePermissionOrThrow(
  permission: Permission,
  organizationId?: string | null,
  options: { allowWhenReadOnly?: boolean } = {},
): Promise<OrgContext> {
  const context = await requireOrgContextOrThrow(organizationId);
  if (!context.can(permission)) {
    throw new ForbiddenError(`Brak uprawnienia: ${permission}`);
  }

  /**
   * Subskrypcja jest sprawdzana SERWEREM: po zakończeniu okresu próbnego
   * (10 dni) lub przy nieopłaconej subskrypcji zapisy są blokowane jawnie.
   * Akcje płatnicze (billing:manage) mogą działać dalej, żeby dało się zapłacić.
   */
  const state = evaluateSubscription({
    plan: context.organization.plan,
    status: context.organization.subscriptionStatus,
    trialEndsAt: context.organization.trialEndsAt ?? null,
    subscriptionEndsAt: context.organization.subscriptionEndsAt ?? null,
  });
  if (state.readOnly && !options.allowWhenReadOnly && permission !== 'billing:manage') {
    throw new ForbiddenError(readOnlyMessage(state));
  }

  return context;
}

/**
 * Sprawdza, czy użytkownik ma dostęp do wskazanej organizacji
 * (używane w API, gdzie organizationId przychodzi z zapytania).
 */
export async function assertOrganizationAccess(organizationId: string): Promise<OrgContext> {
  return requireOrgContextOrThrow(organizationId);
}
