'use client';

import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useTransition } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/utils';

const LABELS: Record<string, string> = { en: 'English', de: 'Deutsch' };

export function LocaleSwitcher() {
  const t = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [pending, startTransition] = useTransition();

  const switchTo = (next: string) => {
    startTransition(() => {
      // `params` is forwarded so a dynamic route (/notebooks/[id]) keeps its
      // segments when the locale prefix changes.
      router.replace(
        // @ts-expect-error -- pathname is a valid route for the current params
        { pathname, params },
        { locale: next },
      );
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('language')}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-default bg-surface px-2.5',
          'text-[13px] font-medium text-foreground-muted transition-colors',
          'hover:bg-surface-hover hover:text-foreground',
          pending && 'opacity-60',
        )}
      >
        <Languages className="size-3.5" />
        <span className="uppercase">{locale}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        {routing.locales.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => switchTo(option)}
            data-active={option === locale}
          >
            {LABELS[option] ?? option}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
