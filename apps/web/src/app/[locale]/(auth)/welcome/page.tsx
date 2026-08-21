import { setRequestLocale } from 'next-intl/server';
import { SetPasswordForm } from '@/components/auth/set-password-form';

/**
 * Where an accepted invitation lands: signed in already, one password short of
 * being able to come back.
 *
 * No notebook id is carried through the mail — the invitation link would then
 * need an entry in Supabase's redirect allowlist for every shape it can take,
 * and the id would sit in an inbox for anyone who later reads it. The notebook
 * is waiting on `/notebooks` regardless, because the membership was written
 * when the invitation was sent.
 */
export default async function WelcomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <SetPasswordForm redirectTo="/notebooks" />;
}
