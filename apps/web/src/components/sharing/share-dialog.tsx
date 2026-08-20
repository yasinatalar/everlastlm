'use client';

import { Share2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { NotebookRole } from '@everlast/contracts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/primitives';
import {
  useChangeMemberRole,
  useInviteMember,
  useMembers,
  useRemoveMember,
} from '@/hooks/use-notebooks';
import { ApiRequestError } from '@/lib/api-client';
import { initials } from '@/lib/utils';

const inviteErrorKey = (error: unknown): string => {
  if (error instanceof ApiRequestError) {
    if (error.code === 'invitee.not_found') return 'noAccount';
    if (error.code === 'member.already_present') return 'alreadyMember';
    if (error.code === 'member.self_invite') return 'alreadyMember';
  }
  return '';
};

export function ShareDialog({
  notebookId,
  notebookTitle,
  open,
  onOpenChange,
}: {
  notebookId: string;
  notebookTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('sharing');
  const tc = useTranslations('common');

  // Members are only fetched once the dialog is opened.
  const { data: members } = useMembers(notebookId, open);
  const invite = useInviteMember(notebookId);
  const changeRole = useChangeMemberRole(notebookId);
  const removeMember = useRemoveMember(notebookId);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const member = await invite.mutateAsync({ email: email.trim(), role });
      toast.success(t('invited', { name: member.displayName ?? member.email ?? email }));
      setEmail('');
    } catch (caught) {
      const key = inviteErrorKey(caught);
      setError(key ? t(key) : tc('errorBody'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Share2 className="size-3.5" />
          {t('title')}
        </Button>
      </DialogTrigger>

      <DialogContent
        title={t('shareTitle', { title: notebookTitle })}
        description={t('shareSubtitle')}
      >
        <DialogBody className="space-y-5">
          <form onSubmit={submit} className="space-y-3">
            <div className="flex items-end gap-2">
              <Input
                label={t('inviteLabel')}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t('invitePlaceholder')}
                className="flex-1"
                required
              />
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as 'editor' | 'viewer')}
                aria-label={t('roleViewer')}
                className="h-9.5 rounded-lg border border-border-default bg-surface px-2 text-[13px] focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/30"
              >
                <option value="viewer">{t('roleViewer')}</option>
                <option value="editor">{t('roleEditor')}</option>
              </select>
              <Button
                type="submit"
                variant="primary"
                loading={invite.isPending}
                disabled={!email.trim()}
              >
                {t('invite')}
              </Button>
            </div>

            {error && (
              <p role="alert" className="text-[13px] text-danger">
                {error}
              </p>
            )}
          </form>

          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
              {t('members')}
            </h3>

            <ul className="space-y-1">
              {members?.map((member) => (
                <li key={member.userId} className="flex items-center gap-2.5 rounded-lg py-1.5">
                  <span
                    className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-sunken text-[10px] font-semibold text-foreground-muted"
                    aria-hidden
                  >
                    {initials(member.displayName, member.email)}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">
                      {member.displayName ?? member.email}
                    </span>
                    {member.displayName && member.email && (
                      <span className="block truncate text-[11px] text-foreground-subtle">
                        {member.email}
                      </span>
                    )}
                  </span>

                  {member.role === 'owner' ? (
                    <Badge tone="accent">{t('owner')}</Badge>
                  ) : (
                    <>
                      <select
                        value={member.role}
                        onChange={(event) =>
                          changeRole.mutate({
                            userId: member.userId,
                            role: event.target.value as Exclude<NotebookRole, 'owner'>,
                          })
                        }
                        aria-label={member.email ?? member.userId}
                        className="h-7 rounded-md border border-border-default bg-surface px-1.5 text-[12px] focus:border-accent focus:outline-none"
                      >
                        <option value="viewer">{t('roleViewer')}</option>
                        <option value="editor">{t('roleEditor')}</option>
                      </select>

                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('remove')}
                        className="size-7"
                        onClick={() => {
                          removeMember.mutate(member.userId, {
                            onSuccess: () => toast.success(t('removed')),
                            onError: (caught) => {
                              const message =
                                caught instanceof ApiRequestError &&
                                caught.code === 'member.last_owner'
                                  ? t('lastOwner')
                                  : tc('errorBody');
                              toast.error(message);
                            },
                          });
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
