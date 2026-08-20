import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Pinned so server and client render identical dates regardless of the
    // host's zone, which would otherwise cause a hydration mismatch.
    timeZone: 'Europe/Berlin',
    formats: {
      dateTime: {
        short: { day: 'numeric', month: 'short', year: 'numeric' },
        full: { dateStyle: 'medium', timeStyle: 'short' },
      },
    },
  };
});
