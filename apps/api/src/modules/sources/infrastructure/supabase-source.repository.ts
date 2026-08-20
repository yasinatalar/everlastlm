import { Injectable } from '@nestjs/common';
import type { Source as SourceDto } from '@everlast/contracts';
import type { SourceRow } from '../../../infrastructure/supabase/database.types';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { ConflictError } from '../../../shared/kernel/domain-error';
import { Source } from '../domain/source.entity';
import { SourceRepository, type ChunkToPersist } from '../domain/source.repository';

const CHUNK_INSERT_BATCH = 200;

export const toSourceDto = (row: SourceRow): SourceDto => ({
  id: row.id,
  notebookId: row.notebook_id,
  kind: row.kind,
  title: row.title,
  originUri: row.origin_uri,
  byteSize: row.byte_size,
  status: row.status,
  failureReason: row.failure_reason,
  summary: row.summary,
  keyTopics: row.key_topics,
  chunkCount: row.chunk_count,
  tokenCount: row.token_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAggregate = (row: SourceRow): Source =>
  Source.rehydrate(row.id, {
    notebookId: row.notebook_id,
    createdBy: row.created_by,
    kind: row.kind,
    title: row.title,
    originUri: row.origin_uri,
    storagePath: row.storage_path,
    byteSize: row.byte_size,
    checksum: row.checksum,
    status: row.status,
    failureReason: row.failure_reason,
    summary: row.summary,
    keyTopics: row.key_topics,
    tokenCount: row.token_count,
    chunkCount: row.chunk_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });

@Injectable()
export class SupabaseSourceRepository extends SourceRepository {
  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  async findById(id: string): Promise<Source | null> {
    const { data, error } = await this.supabase
      .forUser()
      .from('sources')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) this.supabase.fail('sources.findById', error);
    return data ? toAggregate(data) : null;
  }

  async findByChecksum(notebookId: string, checksum: string): Promise<Source | null> {
    const { data, error } = await this.supabase
      .forUser()
      .from('sources')
      .select('*')
      .eq('notebook_id', notebookId)
      .eq('checksum', checksum)
      .maybeSingle();

    if (error) this.supabase.fail('sources.findByChecksum', error);
    return data ? toAggregate(data) : null;
  }

  async listByNotebook(notebookId: string): Promise<SourceDto[]> {
    const { data, error } = await this.supabase
      .forUser()
      .from('sources')
      .select('*')
      .eq('notebook_id', notebookId)
      .order('created_at', { ascending: false });

    if (error) this.supabase.fail('sources.listByNotebook', error);
    return (data ?? []).map(toSourceDto);
  }

  async countByNotebook(notebookId: string): Promise<number> {
    const { count, error } = await this.supabase
      .forUser()
      .from('sources')
      .select('id', { count: 'exact', head: true })
      .eq('notebook_id', notebookId);

    if (error) this.supabase.fail('sources.countByNotebook', error);
    return count ?? 0;
  }

  async insert(source: Source): Promise<void> {
    const state = source.snapshot;
    const { error } = await this.supabase.forUser().from('sources').insert({
      id: source.id,
      notebook_id: state.notebookId,
      created_by: state.createdBy,
      kind: state.kind,
      title: state.title,
      origin_uri: state.originUri,
      storage_path: state.storagePath,
      byte_size: state.byteSize,
      checksum: state.checksum,
      status: state.status,
    });

    if (error) {
      if (error.code === '23505') {
        throw new ConflictError(
          'source.duplicate',
          'this document is already in the notebook',
        );
      }
      this.supabase.fail('sources.insert', error);
    }
  }

  /**
   * Uses the service-role client: status updates happen inside the ingestion
   * pipeline, which runs after the HTTP response has been sent and therefore
   * has no user token to act under. Authorisation was established when the
   * source was created.
   */
  async update(source: Source): Promise<void> {
    const state = source.snapshot;
    const { error } = await this.supabase
      .admin
      .from('sources')
      .update({
        title: state.title,
        status: state.status,
        failure_reason: state.failureReason,
        summary: state.summary,
        key_topics: state.keyTopics,
        token_count: state.tokenCount,
        chunk_count: state.chunkCount,
        storage_path: state.storagePath,
        checksum: state.checksum,
        byte_size: state.byteSize,
      })
      .eq('id', source.id);

    if (error) this.supabase.fail('sources.update', error);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.forUser().from('sources').delete().eq('id', id);
    if (error) this.supabase.fail('sources.delete', error);
  }

  /**
   * Service-role again, and for a second reason: `source_chunks` grants no
   * insert to `authenticated` at all, so embeddings can only ever be written by
   * this pipeline and never forged through the public API.
   */
  async replaceChunks(source: Source, chunks: ChunkToPersist[]): Promise<void> {
    const admin = this.supabase.admin;

    const { error: deleteError } = await admin
      .from('source_chunks')
      .delete()
      .eq('source_id', source.id);
    if (deleteError) this.supabase.fail('source_chunks.delete', deleteError);

    for (let offset = 0; offset < chunks.length; offset += CHUNK_INSERT_BATCH) {
      const batch = chunks.slice(offset, offset + CHUNK_INSERT_BATCH);
      const { error } = await admin.from('source_chunks').insert(
        batch.map((chunk) => ({
          source_id: source.id,
          notebook_id: source.notebookId,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          heading_path: chunk.headingPath,
          page_number: chunk.pageNumber,
          char_start: chunk.charStart,
          char_end: chunk.charEnd,
          token_count: chunk.tokenCount,
          // pgvector accepts its text form; a JSON number array is exactly that.
          embedding: JSON.stringify(chunk.embedding),
        })),
      );
      if (error) this.supabase.fail('source_chunks.insert', error);
    }
  }

  async leadingChunks(sourceId: string, limit: number): Promise<string[]> {
    const { data, error } = await this.supabase
      .admin
      .from('source_chunks')
      .select('content')
      .eq('source_id', sourceId)
      .order('chunk_index', { ascending: true })
      .limit(limit);

    if (error) this.supabase.fail('source_chunks.leading', error);
    return (data ?? []).map((row) => row.content);
  }
}
