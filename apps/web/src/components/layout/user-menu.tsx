'use client';

import { LogOut, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { initials } from '@/lib/utils';

export function UserMenu({
  displayName,
  email,
}: {
  displayName: string | null;
  email: string | null;
}) {
  const t = useTranslations('nav');
  const router = useRouter();

  const signOut = async () => {
    await createClient().auth.signOut();
    // Hard navigation so the middleware clears server-side state too.
    window.location.assign('/login');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={displayName ?? email ?? 'Account'}
        className="grid size-8 place-items-center rounded-full bg-anthracite-900 text-[11px] font-semibold text-offwhite transition-opacity hover:opacity-85 dark:bg-anthracite-800"
      >
        {initials(displayName, email)}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[13rem]">
        <DropdownMenuLabel>
          <span className="block truncate text-[13px] font-medium text-foreground">
            {displayName ?? email}
          </span>
          {displayName && email && (
            <span className="block truncate text-[11px] text-foreground-subtle">{email}</span>
          )}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => router.push('/settings')}>
          <Settings className="size-3.5" />
          {t('settings')}
        </DropdownMenuItem>

        <DropdownMenuItem destructive onSelect={signOut}>
          <LogOut className="size-3.5" />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
