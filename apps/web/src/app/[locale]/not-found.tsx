import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export default async function NotFound() {
  const t = await getTranslations('common');

  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent-text">
          404
        </p>
        <h1 className="mt-2 text-lg font-semibold tracking-[-0.02em]">{t('notFound')}</h1>
        <p className="mt-1.5 max-w-[40ch] text-sm text-foreground-muted">{t('notFoundBody')}</p>
        <Button variant="primary" className="mt-6" asChild>
          <Link href="/notebooks">{t('goHome')}</Link>
        </Button>
      </div>
    </div>
  );
}
