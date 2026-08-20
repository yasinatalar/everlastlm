import { Injectable } from '@nestjs/common';
import type { CreateNoteInput, Note, UpdateNoteInput } from '@everlast/contracts';
import { NotFoundError } from '../../../shared/kernel/domain-error';
import { AuditService } from '../../../shared/security/audit.service';
import { NoteRepository } from '../domain/note.repository';

@Injectable()
export class NoteService {
  constructor(
    private readonly notes: NoteRepository,
    private readonly audit: AuditService,
  ) {}

  async list(notebookId: string): Promise<Note[]> {
    return this.notes.listByNotebook(notebookId);
  }

  async create(notebookId: string, input: CreateNoteInput): Promise<Note> {
    const note = await this.notes.create({
      notebookId,
      title: input.title ?? deriveTitle(input.content),
      content: input.content,
      origin: input.origin,
      citations: input.citations,
    });

    await this.audit.record({
      action: 'note.created',
      notebookId,
      targetType: 'note',
      targetId: note.id,
      metadata: { origin: input.origin },
    });
    return note;
  }

  async update(notebookId: string, noteId: string, input: UpdateNoteInput): Promise<Note> {
    await this.require(notebookId, noteId);
    return this.notes.update(noteId, input);
  }

  async remove(notebookId: string, noteId: string): Promise<void> {
    await this.require(notebookId, noteId);
    await this.notes.delete(noteId);
    await this.audit.record({
      action: 'note.deleted',
      notebookId,
      targetType: 'note',
      targetId: noteId,
    });
  }

  /**
   * Confirms the note belongs to the notebook the caller was authorised for.
   * Without it, a valid note id from another notebook the caller can also see
   * would be editable through this notebook's route.
   */
  private async require(notebookId: string, noteId: string): Promise<Note> {
    const note = await this.notes.findById(notebookId, noteId);
    if (!note) throw new NotFoundError('note', noteId);
    return note;
  }
}

/** First non-empty line, trimmed to a sensible title length. */
const deriveTitle = (content: string): string => {
  const line = content
    .split('\n')
    .map((entry) => entry.replace(/^#+\s*/, '').trim())
    .find((entry) => entry.length > 0);

  return line ? line.slice(0, 80) : 'Untitled note';
};
