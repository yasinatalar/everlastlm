'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';

/** Supabase enforces its own minimum; this is the stricter product rule. */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Gives a freshly invited account the password it was created without.
 *
 * An invitation signs someone in before they have any credential, so this is
 * the one moment where they can be handed one without proving anything further
 * — they proved it by opening a link only their inbox received. Skipping it
 * would leave a working account nobody can ever sign back in to, which is why
 * this screen has no way past it other than choosing a password.
 */
export function SetPasswordForm({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations('welcome');
  const ta = useTranslations('auth');

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(ta('weakPassword'));
      return;
    }

    setPending(true);

    const { error: updateError } = await createClient().auth.updateUser({ password });

    if (updateError) {
      const message = updateError.message.toLowerCase();
      setError(ta(message.includes('password') ? 'weakPassword' : 'genericError'));
      setPending(false);
      return;
    }

    // A full navigation rather than a client push, so the proxy runs and the
    // server components see the session cookies.
    window.location.assign(redirectTo);
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">{t('title')}</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground-muted">{t('subtitle')}</p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <Input
          label={ta('password')}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          hint={ta('passwordHint')}
          minLength={MIN_PASSWORD_LENGTH}
          required
          autoFocus
        />

        {error && (
          <p role="alert" className="rounded-lg bg-danger-subtle px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
          {pending ? t('saving') : t('submit')}
        </Button>
      </form>
    </div>
  );
}
