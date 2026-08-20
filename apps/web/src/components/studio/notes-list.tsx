'use client';

import { Plus, StickyNote, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { Note } from '@everlast/contracts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/primitives';
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from '@/hooks/use-studio';

export function NotesList({
  notebookId,
  canEdit,
}: {
  notebookId: string;
  canEdit: boolean;
}) {
  const t = useTranslations('notes');
  const { data: notes } = useNotes(notebookId);
  const create = useCreateNote(notebookId);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);

  const addNote = async () => {
    const note = await create.mutateAsync({ content: '', origin: 'manual', citations: [] });
    setOpenNoteId(note.id);
  };

  return (
    <div className="p-3">
      {canEdit && (
        <Button
          variant="secondary"
          size="sm"
          onClick={addNote}
          loading={create.isPending}
          className="mb-3 w-full"
        >
          <Plus className="size-3.5" />
          {t('add')}
        </Button>
      )}

      {!notes || notes.length === 0 ? (
        <EmptyState
          icon={<StickyNote className="size-5" />}
          title={t('empty')}
          body={t('emptyBody')}
        />
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id}>
              <NoteCard
                notebookId={notebookId}
                note={note}
                canEdit={canEdit}
                expanded={openNoteId === note.id}
                onToggle={() => setOpenNoteId((id) => (id === note.id ? null : note.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteCard({
  notebookId,
  note,
  canEdit,
  expanded,
  onToggle,
}: {
  notebookId: string;
  note: Note;
  canEdit: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('notes');
  const format = useFormatter();

  const update = useUpdateNote(notebookId);
  const remove = useDeleteNote(notebookId);

  const [draft, setDraft] = useState(note.content);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autosave. Editing a note should not require finding a save
  // button, but a request per keystroke would be absurd.
  useEffect(() => {
    if (!dirty) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void update.mutateAsync({ noteId: note.id, content: draft }).then(() => setDirty(false));
    }, 900);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, dirty, note.id, update]);

  const originLabel = {
    manual: t('originManual'),
    chat: t('originChat'),
    studio: t('originStudio'),
  }[note.origin];

  return (
    <div className="group rounded-lg border border-border-default bg-background p-2.5">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {note.title || t('untitled')}
          </span>
          <span className="mt-0.5 block text-[11px] text-foreground-subtle">
            {originLabel} · {format.dateTime(new Date(note.updatedAt), 'short')}
          </span>
        </button>

        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('delete')}
            loading={remove.isPending}
            onClick={() => remove.mutate(note.id)}
            className="size-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {expanded && (
        <div className="mt-2 border-t border-border-default pt-2">
          {canEdit ? (
            <>
              <textarea
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setDirty(true);
                }}
                rows={8}
                placeholder={t('placeholder')}
                aria-label={note.title || t('untitled')}
                className="w-full resize-none bg-transparent text-[13px] leading-relaxed placeholder:text-foreground-subtle focus:outline-none"
              />
              <p className="text-right text-[10px] text-foreground-subtle" aria-live="polite">
                {dirty ? t('saving') : t('saved')}
              </p>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground-muted">
              {note.content}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
