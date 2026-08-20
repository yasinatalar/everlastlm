import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SettingsForm } from '@/components/settings/settings-form';

export async function generateMetadata() {
  const t = await getTranslations('settings');
  return { title: t('title') };
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('settings');

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('title')}</h1>
        <div className="mt-8">
          <SettingsForm />
        </div>
      </div>
    </div>
  );
}
