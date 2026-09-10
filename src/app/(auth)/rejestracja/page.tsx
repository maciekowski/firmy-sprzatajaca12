import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { RegisterForm } from '@/components/auth/forms';

export const metadata = { title: 'Rejestracja' };

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (user) redirect('/dashboard');
  return <RegisterForm />;
}
