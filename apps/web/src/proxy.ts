import { createServerClient } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);

const isDev = process.env.NODE_ENV === 'development';

const originOf = (value: string | undefined, fallback: string): string => {
  try {
    return new URL(value ?? fallback).origin;
  } catch {
    return fallback;
  }
};

const supabaseOrigin = originOf(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  'http://127.0.0.1:54321',
);
const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL, 'http://localhost:3001');

/**
 * Content-Security-Policy with a per-request nonce.
 *
 * The App Router bootstraps hydration from an inline script. Under a policy of
 * `script-src 'self'` that script is blocked, and the result is worse than it
 * looks: the page renders from SSR HTML and is then completely inert — no state
 * updates, and forms fall back to native GET submits. The two ways out are
 * `'unsafe-inline'`, which forfeits most of the protection, or a nonce.
 *
 * `'strict-dynamic'` lets the nonced bootstrap load the chunks it needs without
 * enumerating every chunk URL.
 *
 * Known concession: `style-src 'unsafe-inline'`. React writes inline styles
 * while streaming, and Next does not nonce them. Adding a nonce to `style-src`
 * would silently *disable* `'unsafe-inline'` (a nonce beats it in the CSP
 * algorithm) and break rendering, so the two are not combined.
 */
const buildCsp = (nonce: string): string =>
  [
    "default-src 'self'",
    // Dev only: React uses eval to rebuild server stack traces, and Turbopack's
    // HMR runtime injects scripts the nonce never reaches. Production gets
    // neither allowance.
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'unsafe-inline'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} ${supabaseOrigin}${isDev ? ' ws: http://localhost:*' : ''}`,
    `media-src 'self' blob: ${supabaseOrigin}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

/** Paths reachable without a session. Everything else requires one. */
const PUBLIC_PATTERNS = [
  /^\/(en|de)?\/?$/,
  /^\/(en|de)\/(login|signup|auth)(\/.*)?$/,
  /^\/(login|signup|auth)(\/.*)?$/,
];

const isPublic = (pathname: string): boolean =>
  PUBLIC_PATTERNS.some((pattern) => pattern.test(pathname));

const stripLocale = (pathname: string): string =>
  pathname.replace(/^\/(en|de)(?=\/|$)/, '') || '/';

/**
 * Re-issues next-intl's routing decision as a response that also carries the
 * nonce on the *request*.
 *
 * A middleware-set request header only reaches the renderer when it is passed
 * through `NextResponse.next({request: {headers}})` (or the equivalent option
 * on `rewrite`). next-intl builds its response without that option, so its
 * rewrite target is read back out and re-issued here with the headers attached.
 * Its own headers and cookies — `Vary`, `Link` alternates, the locale cookie —
 * are copied across so the routing behaviour is unchanged.
 */
const withRequestHeaders = (
  intlResponse: NextResponse,
  request: NextRequest,
  requestHeaders: Headers,
): NextResponse => {
  // A redirect renders no document, so it needs no nonce — return it as-is.
  if (intlResponse.headers.get('location')) return intlResponse;

  const rewriteTarget = intlResponse.headers.get('x-middleware-rewrite');

  const response = rewriteTarget
    ? NextResponse.rewrite(new URL(rewriteTarget, request.url), {
        request: { headers: requestHeaders },
      })
    : NextResponse.next({ request: { headers: requestHeaders } });

  intlResponse.headers.forEach((value, key) => {
    if (key === 'x-middleware-rewrite' || key.startsWith('x-middleware-override')) return;
    if (key === 'set-cookie') return;
    response.headers.set(key, value);
  });

  for (const cookie of intlResponse.cookies.getAll()) response.cookies.set(cookie);

  return response;
};

/**
 * Runs CSP nonce generation, locale negotiation and session refresh in one pass.
 *
 * Order matters: next-intl decides the route, its decision is re-issued with the
 * nonce attached, and only then does Supabase write refreshed auth cookies onto
 * that final response. Building a second response later would silently drop the
 * refreshed session.
 *
 * This is Next 16's `proxy` convention — the former `middleware.ts`.
 */
export default async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = withRequestHeaders(intlMiddleware(request), request, requestHeaders);
  response.headers.set('Content-Security-Policy', csp);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the session as a side effect and validates the token with the
  // auth server, so an expired or forged cookie cannot pass this gate.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  /** Redirects must inherit any cookies the refresh above rotated. */
  const redirectTo = (target: string, search?: URLSearchParams): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = search ? `?${search.toString()}` : '';

    const redirect = NextResponse.redirect(url);
    redirect.headers.set('Content-Security-Policy', csp);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!user && !isPublic(pathname)) {
    // Preserve where they were headed so login can return them there.
    return redirectTo('/login', new URLSearchParams({ next: stripLocale(pathname) }));
  }

  if (user && /^\/(en|de)?\/?(login|signup)\/?$/.test(pathname)) {
    return redirectTo('/notebooks');
  }

  return response;
}

export const config = {
  /**
   * Skips Next internals, static files, and — importantly — `/auth/*`.
   *
   * `/auth/callback` is a Route Handler that lives outside the `[locale]`
   * segment, so it exists at exactly one path. Running it through next-intl's
   * locale detection rewrites a German browser's request to
   * `/de/auth/callback`, where no route exists, and the confirmation link from
   * every signup email dies with a 404. Route handlers carry no UI and need no
   * locale, so they are excluded outright.
   */
  matcher: ['/((?!api|auth|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
