import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { LoginForm } from '@/components/auth/forms';

export const metadata = { title: 'Logowanie' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getSessionUser();
  if (user) redirect('/dashboard');
  const { next } = await searchParams;

  return <LoginForm next={next} />;
}
