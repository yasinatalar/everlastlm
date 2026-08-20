import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getVerifiedSession } from '@/lib/supabase/server';

/**
 * The root is a router, not a landing page: signed in goes to the workspace,
 * signed out goes to login. A marketing site would live on a separate surface.
 */
export default async function RootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getVerifiedSession();
  redirect(session ? '/notebooks' : '/login');
}
