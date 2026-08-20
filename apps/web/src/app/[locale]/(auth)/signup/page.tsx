import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthForm } from '@/components/auth/auth-form';

export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return <AuthForm mode="signup" title={t('signUpTitle')} subtitle={t('signUpSubtitle')} />;
}
