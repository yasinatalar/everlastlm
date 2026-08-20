'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { Locale, Profile, UpdateProfileInput } from '@everlast/contracts';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/primitives';
import { usePathname, useRouter } from '@/i18n/navigation';
import { apiFetch } from '@/lib/api-client';

export function SettingsForm() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiFetch<Profile>('/me'),
  });

  const [displayName, setDisplayName] = useState('');
  const [preferredLocale, setPreferredLocale] = useState<Locale>(locale as Locale);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName ?? '');
      setPreferredLocale(profile.locale);
    }
  }, [profile]);

  const save = useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      apiFetch<Profile>('/me', { method: 'PATCH', body: input }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['profile'], updated);
      toast.success(t('saved'));

      // The stored preference is what a fresh session uses; switch the current
      // one immediately too so the change is visible rather than pending.
      if (updated.locale !== locale) {
        router.replace(pathname, { locale: updated.locale });
      }
    },
    onError: () => toast.error(tc('error')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      locale: preferredLocale,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card className="p-5">
        <h2 className="text-[15px] font-medium tracking-[-0.01em]">{t('profile')}</h2>

        <div className="mt-4 space-y-4">
          <Input
            label={t('displayName')}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={120}
          />

          {profile?.email && (
            <Input label="Email" value={profile.email} disabled readOnly />
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-[15px] font-medium tracking-[-0.01em]">{t('appearance')}</h2>

        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">{t('appearance')}</span>
            <ThemeToggle />
          </div>

          <div className="flex items-center justify-between gap-4">
            <label htmlFor="locale" className="text-sm">
              {t('language')}
            </label>
            <select
              id="locale"
              value={preferredLocale}
              onChange={(event) => setPreferredLocale(event.target.value as Locale)}
              className="h-9 rounded-lg border border-border-default bg-surface px-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/30"
            >
              <option value="en">{t('english')}</option>
              <option value="de">{t('german')}</option>
            </select>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
