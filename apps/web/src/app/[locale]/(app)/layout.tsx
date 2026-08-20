import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { UserMenu } from '@/components/layout/user-menu';
import { Wordmark } from '@/components/layout/wordmark';
import { Link } from '@/i18n/navigation';
import { createClient, getVerifiedSession } from '@/lib/supabase/server';

/**
 * The authenticated shell.
 *
 * The session check is repeated here even though middleware already gates these
 * routes: middleware can be bypassed by a misconfigured matcher or a direct RSC
 * payload request, and a layout that assumes a user without checking is how
 * "logged out but still rendering data" bugs happen.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getVerifiedSession();
  if (!session) redirect('/login');

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', session.user.id)
    .maybeSingle();

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border-default bg-surface px-4">
        <Link href="/notebooks" className="rounded-lg">
          <Wordmark />
        </Link>

        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
          <UserMenu
            displayName={profile?.display_name ?? null}
            email={session.user.email ?? null}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
