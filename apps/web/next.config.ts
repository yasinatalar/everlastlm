import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isDev = process.env.NODE_ENV === 'development';

/**
 * Content-Security-Policy is NOT set here — it needs a per-request nonce, so it
 * is built in `src/proxy.ts`. A static header here would be sent alongside the
 * dynamic one, and two CSP headers are intersected: the strictest wins and the
 * nonce would be ignored. The headers below are the ones that are genuinely
 * request-independent.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  typedRoutes: true,

  experimental: {
    // The contracts package ships TypeScript-authored CJS; let Next compile it
    // with the app so its types and source maps line up.
    optimizePackageImports: ['lucide-react'],
  },

  transpilePackages: ['@everlast/contracts'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          ...(isDev
            ? []
            : [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains; preload',
                },
              ]),
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
