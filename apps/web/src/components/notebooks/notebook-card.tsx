'use client';

import { FileText, MoreHorizontal, Trash2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Notebook } from '@everlast/contracts';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/primitives';
import { Link } from '@/i18n/navigation';
import { useDeleteNotebook } from '@/hooks/use-notebooks';

export function NotebookCard({
  notebook,
  updatedLabel,
  sourceLabel,
}: {
  notebook: Notebook;
  updatedLabel: string;
  sourceLabel: string;
}) {
  const t = useTranslations('notebooks');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const remove = useDeleteNotebook();

  const roleLabel = {
    owner: t('roleOwner'),
    editor: t('roleEditor'),
    viewer: t('roleViewer'),
  }[notebook.role];

  return (
    <>
      {/*
        The whole card is the link; the menu is a sibling positioned above it,
        so the menu button is not nested inside an anchor (invalid, and it makes
        the click target ambiguous for keyboard users).
      */}
      <div className="group relative h-full">
        <Link
          href={`/notebooks/${notebook.id}`}
          className="flex h-full flex-col rounded-card border border-border-default bg-surface p-4 shadow-panel transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-raised"
        >
          <div className="flex items-start gap-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-sunken text-base"
              aria-hidden
            >
              {notebook.emoji || '📓'}
            </span>
            <div className="min-w-0 flex-1 pr-7">
              <h3 className="truncate text-[15px] font-medium tracking-[-0.01em] text-foreground">
                {notebook.title}
              </h3>
              {notebook.description && (
                <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-foreground-muted">
                  {notebook.description}
                </p>
              )}
            </div>
          </div>

          <div className="mt-auto flex items-center gap-2 pt-4 text-[12px] text-foreground-subtle">
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3" aria-hidden />
              {sourceLabel}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">{updatedLabel}</span>

            {notebook.role !== 'owner' && (
              <Badge tone="muted" className="ml-auto shrink-0">
                <Users className="size-2.5" aria-hidden />
                {roleLabel}
              </Badge>
            )}
          </div>
        </Link>

        {notebook.role === 'owner' && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('delete')}
              className="absolute right-3 top-3 grid size-7 place-items-center rounded-lg text-foreground-subtle opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
                <Trash2 className="size-3.5" />
                {t('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('deleteTitle')}
        description={t('deleteBody', { title: notebook.title })}
        destructive
        pending={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync(notebook.id);
          toast.success(t('deleted'));
          setConfirmOpen(false);
        }}
      />
    </>
  );
}
