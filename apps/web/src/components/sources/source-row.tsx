'use client';

import {
  AlertCircle,
  ExternalLink,
  FileText,
  Globe,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Type,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Source, SourceKind, SourceStatus } from '@everlast/contracts';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { openSourceOriginal, useDeleteSource, useRetrySource } from '@/hooks/use-sources';
import { cn } from '@/lib/utils';

const ICONS: Record<SourceKind, typeof FileText> = {
  pdf: FileText,
  docx: FileText,
  text: Type,
  markdown: Type,
  url: Globe,
};

const STATUS_KEYS: Record<SourceStatus, string> = {
  pending: 'statusPending',
  extracting: 'statusExtracting',
  chunking: 'statusChunking',
  embedding: 'statusEmbedding',
  ready: 'statusReady',
  failed: 'statusFailed',
};

export function SourceRow({
  notebookId,
  source,
  canEdit,
  selected,
  onToggle,
}: {
  notebookId: string;
  source: Source;
  canEdit: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('sources');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const remove = useDeleteSource(notebookId);
  const retry = useRetrySource(notebookId);

  const Icon = ICONS[source.kind];
  const isReady = source.status === 'ready';
  const isFailed = source.status === 'failed';
  const isWorking = !isReady && !isFailed;

  return (
    <>
      <div
        className={cn(
          'group rounded-lg border px-2.5 py-2 transition-colors',
          selected && isReady
            ? 'border-accent/40 bg-accent-subtle/40'
            : 'border-transparent hover:bg-surface-hover',
        )}
      >
        <div className="flex items-start gap-2.5">
          {/*
            Only a ready source can be selected — an unprocessed one has no
            chunks, so including it in a query would silently do nothing.
          */}
          <input
            type="checkbox"
            checked={selected && isReady}
            onChange={onToggle}
            disabled={!isReady}
            aria-label={source.title}
            className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-border-strong accent-acid-400 disabled:cursor-not-allowed disabled:opacity-40"
          />

          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="min-w-0 flex-1 text-left"
          >
            <span className="flex items-center gap-1.5">
              <Icon className="size-3.5 shrink-0 text-foreground-subtle" aria-hidden />
              <span className="truncate text-[13px] font-medium text-foreground">
                {source.title}
              </span>
            </span>

            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-foreground-subtle">
              {isWorking && <Loader2 className="size-2.5 animate-spin" aria-hidden />}
              {isFailed && <AlertCircle className="size-2.5 text-danger" aria-hidden />}
              <span className={cn(isFailed && 'text-danger')}>{t(STATUS_KEYS[source.status])}</span>
            </span>
          </button>

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('remove')}
                className="grid size-6 shrink-0 place-items-center rounded text-foreground-subtle opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="size-3.5" />
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end">
                {source.kind !== 'url' && isReady && (
                  <DropdownMenuItem
                    onSelect={() => void openSourceOriginal(notebookId, source.id)}
                  >
                    <ExternalLink className="size-3.5" />
                    {t('openOriginal')}
                  </DropdownMenuItem>
                )}
                {isFailed && (
                  <DropdownMenuItem onSelect={() => retry.mutate(source.id)}>
                    <RefreshCw className="size-3.5" />
                    {t('retry')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
                  <Trash2 className="size-3.5" />
                  {t('remove')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {expanded && (
          <div className="mt-2 space-y-2 border-t border-border-default pl-6 pt-2">
            {isFailed && source.failureReason && (
              <p className="text-[12px] leading-relaxed text-danger">{source.failureReason}</p>
            )}
            {source.summary && (
              <p className="text-[12px] leading-relaxed text-foreground-muted">
                {source.summary}
              </p>
            )}
            {source.keyTopics.length > 0 && (
              <ul className="flex flex-wrap gap-1">
                {source.keyTopics.map((topic) => (
                  <li
                    key={topic}
                    className="rounded border border-border-default px-1.5 py-0.5 text-[10px] text-foreground-muted"
                  >
                    {topic}
                  </li>
                ))}
              </ul>
            )}
            {source.originUri && source.kind === 'url' && (
              <a
                href={source.originUri}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 text-[11px] text-accent-text hover:underline"
              >
                <ExternalLink className="size-2.5" />
                {new URL(source.originUri).hostname}
              </a>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('removeTitle')}
        description={t('removeBody', { title: source.title })}
        destructive
        pending={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync(source.id);
          toast.success(t('removed'));
          setConfirmOpen(false);
        }}
      />
    </>
  );
}
