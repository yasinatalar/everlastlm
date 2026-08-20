'use client';

import { AlertCircle, ChevronRight, Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { StudioArtifact, StudioKind } from '@everlast/contracts';
import { ArtifactViewer } from '@/components/studio/artifact-viewer';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/primitives';
import { useDeleteArtifact } from '@/hooks/use-studio';
import { cn, formatDuration } from '@/lib/utils';

const LABEL_KEYS: Record<StudioKind, string> = {
  study_guide: 'kindStudyGuide',
  briefing_doc: 'kindBriefingDoc',
  faq: 'kindFaq',
  timeline: 'kindTimeline',
  audio_overview: 'kindAudioOverview',
};

export function ArtifactCard({
  notebookId,
  artifact,
  canEdit,
}: {
  notebookId: string;
  artifact: StudioArtifact;
  canEdit: boolean;
}) {
  const t = useTranslations('studio');
  const remove = useDeleteArtifact(notebookId);
  const [open, setOpen] = useState(false);

  const working = artifact.status === 'pending' || artifact.status === 'generating';
  const failed = artifact.status === 'failed';
  const ready = artifact.status === 'ready' && artifact.content !== null;

  return (
    <>
      <div className="group flex items-center gap-2 rounded-lg border border-border-default bg-background p-2.5">
        <button
          type="button"
          disabled={!ready}
          onClick={() => setOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-foreground">
              {t(LABEL_KEYS[artifact.kind])}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-foreground-subtle">
              {working && <Loader2 className="size-2.5 animate-spin" aria-hidden />}
              {failed && <AlertCircle className="size-2.5 text-danger" aria-hidden />}
              <span className={cn(failed && 'text-danger')}>
                {working
                  ? t('generating')
                  : failed
                    ? (artifact.failureReason ?? t('failed'))
                    : artifact.durationSeconds
                      ? formatDuration(artifact.durationSeconds)
                      : ''}
              </span>
            </span>
          </span>

          {ready && (
            <ChevronRight className="size-4 shrink-0 text-foreground-subtle" aria-hidden />
          )}
        </button>

        {artifact.kind === 'audio_overview' && ready && !artifact.audioUrl && (
          <Badge tone="warning">script</Badge>
        )}

        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('delete')}
            loading={remove.isPending}
            onClick={() => remove.mutate(artifact.id)}
            className="size-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t(LABEL_KEYS[artifact.kind])} size="lg" className="max-h-[85dvh]">
          <div className="max-h-[70dvh] overflow-y-auto scrollbar-thin px-6 py-4">
            {artifact.content && (
              <ArtifactViewer content={artifact.content} audioUrl={artifact.audioUrl} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
