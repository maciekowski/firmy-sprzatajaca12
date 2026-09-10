'use server';

import { revalidatePath } from 'next/cache';
import { requirePermissionOrThrow } from '@/lib/auth/guards';
import { sendCommunication } from '@/lib/comms/service';
import { activeEmailProvider } from '@/lib/comms/email';

export type TestEmailState = { ok: boolean; error?: string; message?: string };

/**
 * Test wysyłki — wykonuje PRAWDZIWE wywołanie providera.
 * Jeżeli provider nie jest skonfigurowany, raportujemy to wprost (brak udawanego sukcesu).
 */
export async function sendTestEmailAction(_prev: TestEmailState, formData: FormData): Promise<TestEmailState> {
  const context = await requirePermissionOrThrow('communication:send');
  const to = String(formData.get('to') ?? '').trim();

  if (!to.includes('@')) return { ok: false, error: 'Podaj poprawny adres e-mail.' };

  const provider = activeEmailProvider();
  if (!provider.isConfigured()) {
    return {
      ok: false,
      error: 'E-mail nie jest skonfigurowany (brak RESEND_API_KEY lub SMTP). Wiadomość nie została wysłana.',
    };
  }

  const result = await sendCommunication({
    organizationId: context.organization.id,
    channel: 'EMAIL',
    to,
    subject: 'ServiceFlow — test wysyłki',
    body: `To jest prawdziwa wiadomość testowa wysłana z ServiceFlow (firma: ${context.organization.name}).`,
    userId: context.user.id,
    respectConsent: false,
    idempotencyKey: `test-email:${context.user.id}:${new Date().toISOString().slice(0, 13)}`,
  });

  revalidatePath('/ustawienia/integracje');

  if (!result.delivered) {
    return {
      ok: false,
      error: `Wiadomość NIE została wysłana. Status: ${result.communication.status}. ${result.reason ?? ''}`.trim(),
    };
  }

  return {
    ok: true,
    message: `Wiadomość została przyjęta przez ${provider.name} (id: ${result.communication.providerMessageId ?? 'brak'}). Dostarczenie potwierdzi webhook — sprawdź status w „Komunikacja”.`,
  };
}
