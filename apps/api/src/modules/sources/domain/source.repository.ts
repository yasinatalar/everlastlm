import type { Source as SourceDto } from '@everlast/contracts';
import type { Source } from './source.entity';

export interface ChunkToPersist {
  chunkIndex: number;
  content: string;
  headingPath: string[];
  pageNumber: number | null;
  charStart: number;
  charEnd: number;
  tokenCount: number;
  embedding: number[];
}

export abstract class SourceRepository {
  abstract findById(id: string): Promise<Source | null>;
  abstract insert(source: Source): Promise<void>;
  abstract update(source: Source): Promise<void>;
  abstract delete(id: string): Promise<void>;

  abstract listByNotebook(notebookId: string): Promise<SourceDto[]>;
  abstract countByNotebook(notebookId: string): Promise<number>;
  abstract findByChecksum(notebookId: string, checksum: string): Promise<Source | null>;

  /**
   * Replaces a source's chunks wholesale. Ingestion is idempotent — a retry
   * must not leave the previous run's chunks behind to be retrieved alongside
   * the new ones.
   */
  abstract replaceChunks(
    source: Source,
    chunks: ChunkToPersist[],
  ): Promise<void>;

  /** First N chunks, used to build the per-source summary. */
  abstract leadingChunks(sourceId: string, limit: number): Promise<string[]>;
}

/** Object storage for the original uploaded bytes. */
export abstract class SourceStoragePort {
  abstract upload(
    notebookId: string,
    sourceId: string,
    filename: string,
    contentType: string,
    bytes: Buffer,
  ): Promise<string>;

  abstract download(storagePath: string): Promise<Buffer>;
  abstract remove(storagePath: string): Promise<void>;
  abstract signedUrl(storagePath: string, expiresInSeconds: number): Promise<string>;
}
