import { Injectable } from '@nestjs/common';
import type { Notebook as NotebookDto, NotebookRole, Page } from '@everlast/contracts';
import type { NotebookRow } from '../../../infrastructure/supabase/database.types';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { RequestContextService } from '../../../shared/context/request-context';
import { ConflictError } from '../../../shared/kernel/domain-error';
import { Notebook } from '../domain/notebook.entity';
import {
  NotebookReadModel,
  NotebookRepository,
  type NotebookListQuery,
} from '../domain/notebook.repository';

/**
 * The generated `Database` type declares no foreign-key relationships, so
 * PostgREST's embedded-select inference cannot resolve `notebook_members(...)`
 * on its own. `overrideTypes` states the shape the query actually returns.
 */
type NotebookWithRole = NotebookRow & {
  notebook_members: { role: NotebookRole; user_id: string }[];
};

const toAggregate = (row: NotebookRow): Notebook =>
  Notebook.rehydrate(row.id, {
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    emoji: row.emoji,
    sourceCount: row.source_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
  });

@Injectable()
export class SupabaseNotebookRepository extends NotebookRepository {
  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  async findById(id: string): Promise<Notebook | null> {
    const { data, error } = await this.supabase
      .forUser()
      .from('notebooks')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) this.supabase.fail('notebooks.findById', error);
    return data ? toAggregate(data) : null;
  }

  async insert(notebook: Notebook): Promise<void> {
    const state = notebook.snapshot;
    const { error } = await this.supabase.forUser().from('notebooks').insert({
      id: notebook.id,
      owner_id: state.ownerId,
      title: state.title,
      description: state.description,
      emoji: state.emoji,
    });

    if (error) {
      if (error.code === '23505') {
        throw new ConflictError('notebook.duplicate', 'notebook already exists');
      }
      this.supabase.fail('notebooks.insert', error);
    }
  }

  /**
   * Mutable attributes only. `deleted_at` is deliberately absent — see
   * `archive` below.
   */
  async update(notebook: Notebook): Promise<void> {
    const state = notebook.snapshot;
    const { error } = await this.supabase
      .forUser()
      .from('notebooks')
      .update({
        title: state.title,
        description: state.description,
        emoji: state.emoji,
      })
      .eq('id', notebook.id);

    if (error) this.supabase.fail('notebooks.update', error);
  }

  /**
   * Soft delete goes through an RPC because the archived row cannot satisfy the
   * SELECT policy, which Postgres also applies to the new row of an UPDATE.
   * The function re-checks ownership before writing.
   */
  async archive(notebookId: string): Promise<void> {
    const { error } = await this.supabase
      .forUser()
      .rpc('archive_notebook', { p_notebook_id: notebookId });

    if (error) this.supabase.fail('notebooks.archive', error);
  }
}

@Injectable()
export class SupabaseNotebookReadModel extends NotebookReadModel {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly context: RequestContextService,
  ) {
    super();
  }

  /**
   * Keyset pagination on `updated_at`. Offset pagination would let a notebook
   * shift pages between requests as other members edit it; a cursor on the sort
   * key is stable under concurrent writes.
   */
  async list(query: NotebookListQuery): Promise<Page<NotebookDto>> {
    const userId = this.context.requireUser().id;

    let builder = this.supabase
      .forUser()
      .from('notebooks')
      .select('*, notebook_members!inner(role, user_id)')
      .eq('notebook_members.user_id', userId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(query.limit + 1);

    if (query.cursor) builder = builder.lt('updated_at', query.cursor);
    if (query.search) {
      // `ilike` on a user-supplied string: escape the wildcards so a search for
      // "100%" cannot turn into a full-table scan pattern.
      const escaped = query.search.replace(/[%_\\]/g, (char) => `\\${char}`);
      builder = builder.ilike('title', `%${escaped}%`);
    }

    const { data, error } = await builder.overrideTypes<NotebookWithRole[]>();
    if (error) this.supabase.fail('notebooks.list', error);

    const rows = data ?? [];
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map((row) => this.toDto(row)),
      nextCursor: hasMore ? (page[page.length - 1]?.updated_at ?? null) : null,
    };
  }

  async findOne(id: string): Promise<NotebookDto | null> {
    const userId = this.context.requireUser().id;

    const { data, error } = await this.supabase
      .forUser()
      .from('notebooks')
      .select('*, notebook_members!inner(role, user_id)')
      .eq('id', id)
      .eq('notebook_members.user_id', userId)
      .is('deleted_at', null)
      .maybeSingle()
      .overrideTypes<NotebookWithRole>();

    if (error) this.supabase.fail('notebooks.findOne', error);
    return data ? this.toDto(data) : null;
  }

  async roleOf(notebookId: string, userId: string): Promise<NotebookRole | null> {
    const { data, error } = await this.supabase
      .forUser()
      .from('notebook_members')
      .select('role')
      .eq('notebook_id', notebookId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) this.supabase.fail('notebook_members.roleOf', error);
    return data?.role ?? null;
  }

  private toDto(row: NotebookWithRole): NotebookDto {
    return {
      id: row.id,
      ownerId: row.owner_id,
      title: row.title,
      description: row.description,
      emoji: row.emoji,
      sourceCount: row.source_count,
      role: row.notebook_members?.[0]?.role ?? 'viewer',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
