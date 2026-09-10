import { ResetPasswordForm } from '@/components/auth/forms';

export const metadata = { title: 'Nowe hasło' };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ResetPasswordForm token={token} />;
}
