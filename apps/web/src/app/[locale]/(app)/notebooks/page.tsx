import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NotebookGrid } from '@/components/notebooks/notebook-grid';

export async function generateMetadata() {
  const t = await getTranslations('notebooks');
  return { title: t('title') };
}

export default async function NotebooksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <NotebookGrid />
      </div>
    </div>
  );
}
