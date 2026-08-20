import type { Citation, Note, NoteOrigin } from '@everlast/contracts';

export interface CreateNoteData {
  notebookId: string;
  title: string;
  content: string;
  origin: NoteOrigin;
  citations: Citation[];
}

/**
 * Notes are a small aggregate with no behaviour beyond CRUD, so they get a
 * repository and no entity class. Introducing one would add a layer that only
 * forwards — the domain rule that matters (who may write) lives in RLS and the
 * access guard.
 */
export abstract class NoteRepository {
  abstract listByNotebook(notebookId: string): Promise<Note[]>;
  abstract findById(notebookId: string, noteId: string): Promise<Note | null>;
  abstract create(data: CreateNoteData): Promise<Note>;
  abstract update(
    noteId: string,
    patch: { title?: string; content?: string },
  ): Promise<Note>;
  abstract delete(noteId: string): Promise<void>;
}
