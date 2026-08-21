import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Redeems a notebook invitation and signs the invitee in.
 *
 * The link in the mail points here rather than at Supabase's own `/verify`
 * endpoint, which matters more than it looks. `/verify` answers a browser with
 * `303 → <site>#access_token=…`, and a fragment never leaves the browser, so a
 * Route Handler cannot see it, cannot set the session cookie, and the invitee
 * lands on the marketing page holding tokens nothing reads. Exchanging the
 * single-use `token_hash` here instead keeps the whole handshake server-side:
 * the tokens are never in a URL, never in `Referer`, and never in history.
 *
 * It also means an invitation link needs no entry in Supabase's redirect
 * allowlist — it is an ordinary link to our own site.
 *
 * Lives outside `[locale]` on purpose: the proxy excludes `/auth/*` from
 * locale rewriting, so this exists at exactly one path and an emailed link
 * cannot 404 on a German browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');

  if (!tokenHash) {
    return NextResponse.redirect(`${origin}/login?error=invalid_invite`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: 'invite',
    token_hash: tokenHash,
  });

  // Expired, already used, or forged — all indistinguishable to us, and all
  // the same to the person reading: this link will not work, sign in instead.
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=invalid_invite`);
  }

  return NextResponse.redirect(`${origin}/welcome`);
}
