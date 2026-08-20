'use client';

import { FileStack, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AddSourceDialog } from '@/components/sources/add-source-dialog';
import { SourceRow } from '@/components/sources/source-row';
import { Button } from '@/components/ui/button';
import { EmptyState, SectionHeader, Skeleton } from '@/components/ui/primitives';
import { useSources } from '@/hooks/use-sources';
import { cn } from '@/lib/utils';

export function SourcesPanel({
  notebookId,
  canEdit,
  selectedIds,
  allSelected,
  onToggle,
  onSelectAll,
  onSelectNone,
  className,
}: {
  notebookId: string;
  canEdit: boolean;
  selectedIds: string[];
  allSelected: boolean;
  onToggle: (sourceId: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  className?: string;
}) {
  const t = useTranslations('sources');
  const { data: sources, isPending } = useSources(notebookId);
  const [addOpen, setAddOpen] = useState(false);

  const readyCount = (sources ?? []).filter((source) => source.status === 'ready').length;

  return (
    <aside className={cn('flex flex-col bg-surface', className)}>
      <SectionHeader
        title={t('title')}
        count={sources?.length}
        action={
          canEdit && (
            <Button variant="ghost" size="icon" onClick={() => setAddOpen(true)} aria-label={t('add')}>
              <Plus className="size-4" />
            </Button>
          )
        }
      />

      {readyCount > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-border-default px-4 py-2">
          <span className="text-[12px] text-foreground-muted">
            {t('selectedCount', { count: selectedIds.length, total: readyCount })}
          </span>
          <button
            type="button"
            onClick={allSelected ? onSelectNone : onSelectAll}
            className="rounded text-[12px] font-medium text-accent-text underline-offset-2 hover:underline"
          >
            {allSelected ? t('deselectAll') : t('selectAll')}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {isPending ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-14" />
            ))}
          </div>
        ) : !sources || sources.length === 0 ? (
          <EmptyState
            icon={<FileStack className="size-5" />}
            title={t('empty')}
            body={t('emptyBody')}
            action={
              canEdit && (
                <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="size-3.5" />
                  {t('add')}
                </Button>
              )
            }
          />
        ) : (
          <ul className="space-y-1 p-2">
            {sources.map((source) => (
              <li key={source.id}>
                <SourceRow
                  notebookId={notebookId}
                  source={source}
                  canEdit={canEdit}
                  selected={selectedIds.includes(source.id)}
                  onToggle={() => onToggle(source.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddSourceDialog notebookId={notebookId} open={addOpen} onOpenChange={setAddOpen} />
    </aside>
  );
}
