import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@everlast/contracts';

/**
 * Locale lives in the URL (`/de/notebooks`) rather than only in a cookie, so a
 * shared link keeps its language and both versions are independently
 * addressable. `as-needed` keeps the default locale prefix-free.
 */
export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeDetection: true,
});

export type AppLocale = (typeof routing.locales)[number];
