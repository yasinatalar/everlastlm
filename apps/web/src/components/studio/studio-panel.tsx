'use client';

import * as Tabs from '@radix-ui/react-tabs';
import {
  AudioLines,
  CalendarClock,
  FileQuestion,
  GraduationCap,
  Newspaper,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import type { StudioKind } from '@everlast/contracts';
import { ArtifactCard } from '@/components/studio/artifact-card';
import { NotesList } from '@/components/studio/notes-list';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useGenerateArtifact, useStudioArtifacts } from '@/hooks/use-studio';
import { cn } from '@/lib/utils';

const KINDS: { kind: StudioKind; Icon: typeof GraduationCap; labelKey: string; hintKey: string }[] =
  [
    {
      kind: 'audio_overview',
      Icon: AudioLines,
      labelKey: 'kindAudioOverview',
      hintKey: 'kindAudioOverviewHint',
    },
    {
      kind: 'study_guide',
      Icon: GraduationCap,
      labelKey: 'kindStudyGuide',
      hintKey: 'kindStudyGuideHint',
    },
    {
      kind: 'briefing_doc',
      Icon: Newspaper,
      labelKey: 'kindBriefingDoc',
      hintKey: 'kindBriefingDocHint',
    },
    { kind: 'faq', Icon: FileQuestion, labelKey: 'kindFaq', hintKey: 'kindFaqHint' },
    {
      kind: 'timeline',
      Icon: CalendarClock,
      labelKey: 'kindTimeline',
      hintKey: 'kindTimelineHint',
    },
  ];

export function StudioPanel({
  notebookId,
  canEdit,
  selectedSourceIds,
  hasReadySources,
  className,
}: {
  notebookId: string;
  canEdit: boolean;
  selectedSourceIds: string[];
  hasReadySources: boolean;
  className?: string;
}) {
  const t = useTranslations('studio');
  const tn = useTranslations('notes');

  const { data: artifacts, isPending } = useStudioArtifacts(notebookId);
  const generate = useGenerateArtifact(notebookId);
  const [generatingKind, setGeneratingKind] = useState<StudioKind | null>(null);

  const start = async (kind: StudioKind) => {
    setGeneratingKind(kind);
    try {
      await generate.mutateAsync({
        kind,
        ...(selectedSourceIds.length > 0 ? { sourceIds: selectedSourceIds } : {}),
      });
      toast.success(t('started'));
    } catch {
      toast.error(t('failed'));
    } finally {
      setGeneratingKind(null);
    }
  };

  return (
    <aside className={cn('flex flex-col bg-surface', className)}>
      <Tabs.Root defaultValue="studio" className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="flex h-12 shrink-0 items-center gap-1 border-b border-border-default px-3">
          {[
            { value: 'studio', label: t('title') },
            { value: 'notes', label: tn('title') },
          ].map(({ value, label }) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-[13px] font-semibold uppercase tracking-[0.06em]',
                'text-foreground-subtle transition-colors hover:text-foreground',
                'data-[state=active]:bg-surface-hover data-[state=active]:text-foreground',
              )}
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="studio" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {canEdit && (
            <div className="border-b border-border-default p-3">
              <p className="mb-2 text-[12px] leading-relaxed text-foreground-muted">
                {t('subtitle')}
              </p>
              <div className="grid gap-1.5">
                {KINDS.map(({ kind, Icon, labelKey, hintKey }) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={!hasReadySources || generate.isPending}
                    onClick={() => void start(kind)}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border border-border-default bg-background p-2.5 text-left',
                      'transition-colors hover:border-border-strong hover:bg-surface-hover',
                      'disabled:cursor-not-allowed disabled:opacity-50',
                      generatingKind === kind && 'border-accent bg-accent-subtle/40',
                    )}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-foreground-subtle" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-foreground">
                        {t(labelKey)}
                      </span>
                      <span className="block text-[11px] leading-snug text-foreground-subtle">
                        {t(hintKey)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-3">
            {isPending ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }, (_, index) => (
                  <Skeleton key={index} className="h-16" />
                ))}
              </div>
            ) : !artifacts || artifacts.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="size-5" />}
                title={t('empty')}
                body={t('emptyBody')}
              />
            ) : (
              <ul className="space-y-2">
                {artifacts.map((artifact) => (
                  <li key={artifact.id}>
                    <ArtifactCard notebookId={notebookId} artifact={artifact} canEdit={canEdit} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Tabs.Content>

        <Tabs.Content value="notes" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <NotesList notebookId={notebookId} canEdit={canEdit} />
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  );
}
