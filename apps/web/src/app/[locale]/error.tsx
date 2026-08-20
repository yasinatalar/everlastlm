'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    // Only the digest is logged: the message can carry server detail that has
    // no business in a browser console.
    console.error('render error', error.digest);
  }, [error]);

  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <h1 className="text-lg font-semibold tracking-[-0.02em]">{t('error')}</h1>
        <p className="mt-1.5 max-w-[40ch] text-sm text-foreground-muted">{t('errorBody')}</p>
        <Button variant="primary" className="mt-6" onClick={reset}>
          {t('retry')}
        </Button>
      </div>
    </div>
  );
}
