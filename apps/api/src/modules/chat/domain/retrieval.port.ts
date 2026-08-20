import type { RetrievedChunk } from '../../../shared/ports/grounded-answer.port';

export interface RetrievalQuery {
  notebookId: string;
  question: string;
  /** Empty or omitted searches the whole notebook. */
  sourceIds?: string[];
  limit?: number;
}

export abstract class ChunkRetrievalPort {
  abstract search(query: RetrievalQuery): Promise<RetrievedChunk[]>;
}
