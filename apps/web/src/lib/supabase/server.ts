import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client for Server Components and Route Handlers.
 *
 * Session cookies are written by `@supabase/ssr` as httpOnly + sameSite=lax, so
 * the refresh token is never reachable from JavaScript. Server Components
 * cannot set cookies, which is why the setter tolerates a failure — the
 * middleware is what actually refreshes the session on each navigation.
 */
export const createClient = async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component; middleware handles the refresh.
          }
        },
      },
    },
  );
};

/**
 * The access token the browser will send to the NestJS API.
 *
 * `getUser()` is called first on purpose: it validates the token against the
 * auth server, whereas `getSession()` returns whatever is in the cookie without
 * verifying it. Trusting an unverified session on the server is the classic
 * Supabase SSR mistake.
 */
export const getVerifiedSession = async () => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  return { user, accessToken: session.access_token };
};
