/**
 * Ports are declared as abstract classes rather than interfaces so they can act
 * as Nest injection tokens while still being pure abstractions. The domain and
 * application layers depend on these; only `infrastructure/llm` knows a vendor
 * name.
 */
export abstract class EmbeddingPort {
  /** Vector width the `source_chunks.embedding` column expects. */
  abstract readonly dimensions: number;

  /** Embeds passages for storage. Asymmetric models use a `document` prompt. */
  abstract embedDocuments(texts: string[]): Promise<number[][]>;

  /** Embeds a user question. Uses the matching `query` prompt. */
  abstract embedQuery(text: string): Promise<number[]>;
}
