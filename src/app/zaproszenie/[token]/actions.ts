'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSessionUser, setActiveOrganizationCookie } from '@/lib/auth/session';
import { acceptInvitation } from '@/lib/services/invitations';
import { rateLimit } from '@/lib/rate-limit';

export type AcceptState = { ok: boolean; error?: string };

/**
 * Przyjęcie zaproszenia. Wymaga zalogowania kontem o tym samym adresie e-mail.
 * Token działa jednorazowo, wygasa i może zostać odwołany.
 */
export async function acceptInvitationAction(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = String(formData.get('token') ?? '');
  const user = await getSessionUser();
  if (!user) redirect(`/logowanie?next=${encodeURIComponent(`/zaproszenie/${token}`)}`);

  const limit = rateLimit(`invite-accept:${user.id}`, 10, 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Zbyt wiele prób. Spróbuj ponownie za ${limit.retryAfterSeconds} s.` };
  }

  const result = await acceptInvitation(token, { id: user.id, email: user.email });
  if (!result.ok) return { ok: false, error: result.error };

  await setActiveOrganizationCookie(result.organizationId);
  revalidatePath('/dashboard');
  redirect('/dashboard?wynik=dolaczono');
}
