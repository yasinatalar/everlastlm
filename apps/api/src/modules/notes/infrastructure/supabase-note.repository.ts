import { Injectable } from '@nestjs/common';
import { citationSchema, type Citation, type Note } from '@everlast/contracts';
import type { Json, NoteRow } from '../../../infrastructure/supabase/database.types';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { RequestContextService } from '../../../shared/context/request-context';
import { DependencyFailureError } from '../../../shared/kernel/domain-error';
import { NoteRepository, type CreateNoteData } from '../domain/note.repository';

const parseCitations = (value: Json): Citation[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        const parsed = citationSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

const toNote = (row: NoteRow): Note => ({
  id: row.id,
  notebookId: row.notebook_id,
  title: row.title,
  content: row.content,
  origin: row.origin,
  citations: parseCitations(row.citations),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

@Injectable()
export class SupabaseNoteRepository extends NoteRepository {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly context: RequestContextService,
  ) {
    super();
  }

  async listByNotebook(notebookId: string): Promise<Note[]> {
    const { data, error } = await this.supabase
      .forUser()
      .from('notes')
      .select('*')
      .eq('notebook_id', notebookId)
      .order('updated_at', { ascending: false });

    if (error) this.supabase.fail('notes.list', error);
    return (data ?? []).map(toNote);
  }

  async findById(notebookId: string, noteId: string): Promise<Note | null> {
    const { data, error } = await this.supabase
      .forUser()
      .from('notes')
      .select('*')
      .eq('id', noteId)
      .eq('notebook_id', notebookId)
      .maybeSingle();

    if (error) this.supabase.fail('notes.findById', error);
    return data ? toNote(data) : null;
  }

  async create(data: CreateNoteData): Promise<Note> {
    const user = this.context.requireUser();

    const { data: row, error } = await this.supabase
      .forUser()
      .from('notes')
      .insert({
        notebook_id: data.notebookId,
        created_by: user.id,
        title: data.title,
        content: data.content,
        origin: data.origin,
        citations: data.citations as unknown as Json,
      })
      .select('*')
      .single();

    if (error || !row) throw new DependencyFailureError('supabase', 'could not create the note');
    return toNote(row);
  }

  async update(noteId: string, patch: { title?: string; content?: string }): Promise<Note> {
    const { data, error } = await this.supabase
      .forUser()
      .from('notes')
      .update({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
      })
      .eq('id', noteId)
      .select('*')
      .single();

    if (error || !data) throw new DependencyFailureError('supabase', 'could not update the note');
    return toNote(data);
  }

  async delete(noteId: string): Promise<void> {
    const { error } = await this.supabase.forUser().from('notes').delete().eq('id', noteId);
    if (error) this.supabase.fail('notes.delete', error);
  }
}
