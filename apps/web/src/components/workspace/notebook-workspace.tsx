'use client';

import { ArrowLeft, PanelLeft, PanelRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { ChatPanel } from '@/components/chat/chat-panel';
import { ShareDialog } from '@/components/sharing/share-dialog';
import { SourcesPanel } from '@/components/sources/sources-panel';
import { StudioPanel } from '@/components/studio/studio-panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { Link } from '@/i18n/navigation';
import { useNotebook } from '@/hooks/use-notebooks';
import { useSources } from '@/hooks/use-sources';
import { cn } from '@/lib/utils';

/**
 * The three-pane workspace: sources on the left, chat in the middle, studio on
 * the right — the same spatial model as NotebookLM, because it maps directly
 * onto the mental model (what I have · what I ask · what I make).
 *
 * Source selection is owned here rather than in the sources panel: the chat
 * needs it to scope retrieval, and the studio needs it to scope generation, so
 * it is genuinely shared state and not panel-local.
 */
export function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  const t = useTranslations('nav');
  const { data: notebook, isPending, isError } = useNotebook(notebookId);
  const { data: sources } = useSources(notebookId);

  const [selectedSourceIds, setSelectedSourceIds] = useState<string[] | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [studioOpen, setStudioOpen] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  const readySources = (sources ?? []).filter((source) => source.status === 'ready');

  /**
   * `null` means "everything", which stays correct as sources are added — an
   * eagerly-materialised list of every id would silently exclude anything
   * uploaded afterwards.
   */
  const effectiveSelection = selectedSourceIds ?? readySources.map((source) => source.id);

  const toggleSource = useCallback(
    (sourceId: string) => {
      setSelectedSourceIds((current) => {
        const base = current ?? readySources.map((source) => source.id);
        return base.includes(sourceId)
          ? base.filter((id) => id !== sourceId)
          : [...base, sourceId];
      });
    },
    [readySources],
  );

  const selectAll = useCallback(() => setSelectedSourceIds(null), []);
  const selectNone = useCallback(() => setSelectedSourceIds([]), []);

  if (isError) {
    return <WorkspaceError />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-default bg-surface px-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/notebooks" aria-label={t('backToNotebooks')}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>

        {isPending ? (
          <Skeleton className="h-4 w-40" />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden>{notebook?.emoji || '📓'}</span>
            <h1 className="truncate text-sm font-medium tracking-[-0.01em]">
              {notebook?.title}
            </h1>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {notebook?.role === 'owner' && (
            <ShareDialog
              notebookId={notebookId}
              notebookTitle={notebook.title}
              open={shareOpen}
              onOpenChange={setShareOpen}
            />
          )}

          <Button
            variant="ghost"
            size="icon"
            aria-pressed={sourcesOpen}
            onClick={() => setSourcesOpen((open) => !open)}
            className={cn('hidden lg:inline-flex', sourcesOpen && 'text-foreground')}
          >
            <PanelLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={studioOpen}
            onClick={() => setStudioOpen((open) => !open)}
            className={cn('hidden lg:inline-flex', studioOpen && 'text-foreground')}
          >
            <PanelRight className="size-4" />
          </Button>
        </div>
      </div>

      {/*
        Below `lg` the side panels collapse into a stack above the chat rather
        than three unusable 100px columns.
      */}
      <div
        className={cn(
          'grid min-h-0 flex-1 grid-rows-[auto_1fr] lg:grid-rows-1',
          sourcesOpen && studioOpen && 'lg:grid-cols-[320px_1fr_360px]',
          sourcesOpen && !studioOpen && 'lg:grid-cols-[320px_1fr]',
          !sourcesOpen && studioOpen && 'lg:grid-cols-[1fr_360px]',
          !sourcesOpen && !studioOpen && 'lg:grid-cols-1',
        )}
      >
        {sourcesOpen && (
          <SourcesPanel
            notebookId={notebookId}
            canEdit={notebook?.role !== 'viewer'}
            selectedIds={effectiveSelection}
            allSelected={selectedSourceIds === null}
            onToggle={toggleSource}
            onSelectAll={selectAll}
            onSelectNone={selectNone}
            className="order-2 min-h-0 border-t border-border-default lg:order-1 lg:border-r lg:border-t-0"
          />
        )}

        <ChatPanel
          notebookId={notebookId}
          sourceIds={effectiveSelection}
          allSelected={selectedSourceIds === null}
          totalReadySources={readySources.length}
          canEdit={notebook?.role !== 'viewer'}
          className="order-1 min-h-0 lg:order-2"
        />

        {studioOpen && (
          <StudioPanel
            notebookId={notebookId}
            canEdit={notebook?.role !== 'viewer'}
            selectedSourceIds={effectiveSelection}
            hasReadySources={readySources.length > 0}
            className="order-3 min-h-0 border-t border-border-default lg:border-l lg:border-t-0"
          />
        )}
      </div>
    </div>
  );
}

function WorkspaceError() {
  const t = useTranslations('common');

  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <p className="text-[15px] font-medium">{t('notFound')}</p>
        <p className="mt-1.5 max-w-[40ch] text-[13px] text-foreground-muted">
          {t('notFoundBody')}
        </p>
        <Button variant="secondary" className="mt-5" asChild>
          <Link href="/notebooks">{t('goHome')}</Link>
        </Button>
      </div>
    </div>
  );
}
