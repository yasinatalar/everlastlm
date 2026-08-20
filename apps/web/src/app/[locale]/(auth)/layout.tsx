import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/layout/wordmark';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { ThemeToggle } from '@/components/layout/theme-toggle';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('app');

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,520px)]">
      {/*
        The marketing half is hidden below `lg` rather than stacked — on a phone
        the only thing that matters is the form.
      */}
      <aside className="relative hidden flex-col justify-between bg-anthracite-950 p-12 text-offwhite lg:flex">
        <Wordmark className="text-offwhite" />

        <div className="max-w-[22ch]">
          <p className="text-[40px] font-semibold leading-[1.08] tracking-[-0.03em]">
            {t('tagline')}
          </p>
          <p className="mt-5 max-w-[44ch] text-[15px] leading-relaxed text-anthracite-300">
            {t('description')}
          </p>
        </div>

        <div className="flex items-center gap-2 text-[13px] text-anthracite-400">
          <span className="size-1.5 rounded-full bg-acid-300" aria-hidden />
          everlastlm.com
        </div>
      </aside>

      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4 lg:justify-end">
          <Wordmark className="lg:hidden" />
          <div className="flex items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-[360px]">{children}</div>
        </div>
      </main>
    </div>
  );
}
