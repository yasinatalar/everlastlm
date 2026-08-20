import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { EmbeddingPort } from '../../../shared/ports/embedding.port';
import type { RetrievedChunk } from '../../../shared/ports/grounded-answer.port';
import { ChunkRetrievalPort, type RetrievalQuery } from '../domain/retrieval.port';

const DEFAULT_LIMIT = 14;

@Injectable()
export class SupabaseRetrievalAdapter extends ChunkRetrievalPort {
  private readonly logger = new Logger(SupabaseRetrievalAdapter.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly embeddings: EmbeddingPort,
  ) {
    super();
  }

  /**
   * Hybrid retrieval. The dense side finds passages that mean the same thing as
   * the question; the sparse side reliably finds exact tokens — product names,
   * error codes, section numbers — that embeddings routinely miss. The fusion
   * happens in `match_source_chunks`.
   *
   * The RPC runs as SECURITY INVOKER through the user's client, so a caller who
   * passes someone else's notebook id gets an empty result rather than data.
   */
  async search(query: RetrievalQuery): Promise<RetrievedChunk[]> {
    const embedding = await this.embeddings.embedQuery(query.question);

    const { data, error } = await this.supabase.forUser().rpc('match_source_chunks', {
      p_notebook_id: query.notebookId,
      // pgvector parses its own text representation, which a JSON array is.
      p_query_embedding: JSON.stringify(embedding),
      p_query_text: query.question,
      p_source_ids: query.sourceIds?.length ? query.sourceIds : null,
      p_match_count: query.limit ?? DEFAULT_LIMIT,
    });

    if (error) this.supabase.fail('match_source_chunks', error);

    const rows = data ?? [];
    this.logger.debug(
      { notebookId: query.notebookId, hits: rows.length },
      'retrieval complete',
    );

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      sourceKind: row.source_kind,
      chunkIndex: row.chunk_index,
      pageNumber: row.page_number,
      headingPath: row.heading_path,
      content: row.content,
    }));
  }
}
