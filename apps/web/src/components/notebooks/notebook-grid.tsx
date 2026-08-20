'use client';

import { Library, Plus, Search } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useDeferredValue, useState } from 'react';
import { CreateNotebookDialog } from '@/components/notebooks/create-notebook-dialog';
import { NotebookCard } from '@/components/notebooks/notebook-card';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useNotebooks } from '@/hooks/use-notebooks';

export function NotebookGrid() {
  const t = useTranslations('notebooks');
  const format = useFormatter();

  const [search, setSearch] = useState('');
  // Keeps typing responsive: the input updates immediately, the query follows.
  const deferredSearch = useDeferredValue(search);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isPending } = useNotebooks(deferredSearch || undefined);
  const notebooks = data?.items ?? [];

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">{t('title')}</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {isPending ? ' ' : t('subtitle', { count: notebooks.length })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="h-9.5 w-56 rounded-lg border border-border-default bg-surface pl-8 pr-3 text-sm placeholder:text-foreground-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t('create')}
          </Button>
        </div>
      </header>

      <div className="mt-8">
        {isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-[132px]" />
            ))}
          </div>
        ) : notebooks.length === 0 ? (
          <EmptyState
            icon={<Library className="size-5" />}
            title={deferredSearch ? t('noResults', { query: deferredSearch }) : t('empty')}
            {...(deferredSearch ? {} : { body: t('emptyBody') })}
            action={
              deferredSearch ? undefined : (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  {t('create')}
                </Button>
              )
            }
            className="rounded-card border border-dashed border-border-default"
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {notebooks.map((notebook) => (
              <li key={notebook.id}>
                <NotebookCard
                  notebook={notebook}
                  updatedLabel={t('updated', {
                    date: format.dateTime(new Date(notebook.updatedAt), 'short'),
                  })}
                  sourceLabel={t('sourceCount', { count: notebook.sourceCount })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreateNotebookDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
