'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', Icon: Sun, labelKey: 'themeLight' },
  { value: 'dark', Icon: Moon, labelKey: 'themeDark' },
  { value: 'system', Icon: Monitor, labelKey: 'themeSystem' },
] as const;

/**
 * A three-way segmented control rather than a two-way switch: "system" is a
 * real, distinct preference, and collapsing it into a toggle means a user who
 * wants to follow their OS has no way to say so.
 */
export function ThemeToggle() {
  const t = useTranslations('nav');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the resolved theme, so the control renders inert
  // until hydration rather than flashing the wrong selection.
  useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label={t('theme')}
      className="inline-flex items-center gap-0.5 rounded-lg border border-border-default bg-surface p-0.5"
    >
      {OPTIONS.map(({ value, Icon, labelKey }) => {
        const active = mounted && theme === value;

        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(labelKey)}
            title={t(labelKey)}
            onClick={() => setTheme(value)}
            className={cn(
              'grid size-7 place-items-center rounded-md transition-colors',
              active
                ? 'bg-surface-hover text-foreground'
                : 'text-foreground-subtle hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
