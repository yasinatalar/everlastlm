'use client';

import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';

/** Supabase enforces its own minimum; this is the stricter product rule. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Maps a Supabase auth error onto one of our translation keys.
 *
 * Sign-in failures deliberately collapse to a single message regardless of
 * whether the account exists — distinguishing "no such user" from "wrong
 * password" turns the login form into an account enumeration oracle.
 */
const errorKeyFor = (message: string, mode: 'signin' | 'signup'): string => {
  const normalised = message.toLowerCase();

  if (normalised.includes('rate limit') || normalised.includes('too many')) {
    return 'rateLimited';
  }
  if (normalised.includes('email not confirmed')) return 'emailNotConfirmed';
  if (mode === 'signup') {
    if (normalised.includes('already registered') || normalised.includes('already been')) {
      return 'emailTaken';
    }
    if (normalised.includes('password')) return 'weakPassword';
    return 'genericError';
  }
  if (normalised.includes('invalid login') || normalised.includes('credentials')) {
    return 'invalidCredentials';
  }
  return 'genericError';
};

/**
 * Messages for the redirects that land here from an emailed link.
 *
 * `/auth/invite` and `/auth/callback` cannot render anything themselves, so a
 * link that has expired or been used already can only say so by sending the
 * reason along to this page. Without this the person is bounced to a login form
 * that gives no hint why the button in their mail did nothing.
 */
const REDIRECT_ERROR_KEYS: Record<string, string> = {
  invalid_invite: 'inviteExpired',
  invalid_code: 'linkExpired',
  missing_code: 'linkExpired',
};

export function AuthForm({
  mode,
  title,
  subtitle,
}: {
  mode: 'signin' | 'signup';
  title: string;
  subtitle: string;
}) {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();

  const redirectErrorKey = REDIRECT_ERROR_KEYS[searchParams.get('error') ?? ''];

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(
    redirectErrorKey ? t(redirectErrorKey) : null,
  );
  const [pending, setPending] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  // Only a path is accepted, so `?next=https://evil.example` cannot turn the
  // login page into an open redirect.
  const nextParam = searchParams.get('next');
  const nextPath = nextParam && /^\/(?!\/)/.test(nextParam) ? nextParam : '/notebooks';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
      setError(t('weakPassword'));
      return;
    }

    setPending(true);
    const supabase = createClient();

    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName.trim() || undefined },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
          },
        });
        if (signUpError) throw signUpError;
        setConfirmationSent(true);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;

      // A full navigation rather than a client push, so the middleware runs and
      // the server components see the new session cookies.
      window.location.assign(nextPath);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      setError(t(errorKeyFor(message, mode)));
      setPending(false);
    }
  };

  if (confirmationSent) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl bg-accent-subtle text-accent-text">
          <CheckCircle2 className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-[-0.02em]">{t('checkInbox')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
          {t('confirmationSent', { email })}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-1.5 text-sm text-foreground-muted">{subtitle}</p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        {mode === 'signup' && (
          <Input
            label={t('displayName')}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
            maxLength={120}
          />
        )}

        <Input
          label={t('email')}
          type="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('emailPlaceholder')}
          autoComplete="email"
          required
          autoFocus={mode === 'signin'}
        />

        <Input
          label={t('password')}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          {...(mode === 'signup' ? { hint: t('passwordHint'), minLength: MIN_PASSWORD_LENGTH } : {})}
          required
        />

        {error && (
          <p role="alert" className="rounded-lg bg-danger-subtle px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
          {pending
            ? mode === 'signup'
              ? t('creatingAccount')
              : t('signingIn')
            : mode === 'signup'
              ? t('signUp')
              : t('signIn')}
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-foreground-muted">
        {mode === 'signup' ? t('hasAccount') : t('noAccount')}{' '}
        <Link
          href={mode === 'signup' ? '/login' : '/signup'}
          className="font-medium text-accent-text underline-offset-4 hover:underline"
        >
          {mode === 'signup' ? t('signIn') : t('signUp')}
        </Link>
      </p>
    </div>
  );
}
