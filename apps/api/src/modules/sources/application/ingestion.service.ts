import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { SOURCE_TRUST_BOUNDARY } from '../../../infrastructure/llm/prompt-safety';
import {
  DependencyNotConfiguredError,
  InvariantViolationError,
} from '../../../shared/kernel/domain-error';
import { BackgroundTasksPort } from '../../../shared/ports/background-tasks.port';
import { EmbeddingPort } from '../../../shared/ports/embedding.port';
import { TextGenerationPort } from '../../../shared/ports/text-generation.port';
import type { Source } from '../domain/source.entity';
import { SourceRepository, SourceStoragePort } from '../domain/source.repository';
import { TextExtractionPort, type ExtractedDocument } from '../domain/text-extraction.port';
import { chunkDocument } from '../infrastructure/text-chunker';

const summarySchema = z.object({
  summary: z.string().max(2000),
  keyTopics: z.array(z.string().max(60)).max(8),
});

const SUMMARY_SYSTEM = `
You summarise a single source document for a research notebook.

Write 2-4 sentences describing what the document is and what it covers, in the
document's own language. Then list up to 8 key topics as short noun phrases.
Be concrete and specific — "Q3 2024 revenue breakdown by region" beats "business
information". Describe only what is present; never speculate about the author's
intent or the document's reliability.

${SOURCE_TRUST_BOUNDARY}
`.trim();

/**
 * Turns a stored source into retrievable, embedded chunks.
 *
 * Runs after the HTTP response so an upload feels instant; the client polls the
 * source's status. That makes this a fire-and-forget task in-process, which is
 * the right shape for a single-instance deployment but is the first thing to
 * move to a durable queue when the API scales out — a restart mid-ingest
 * currently leaves the source stuck in a non-terminal state until retried.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly sources: SourceRepository,
    private readonly storage: SourceStoragePort,
    private readonly extraction: TextExtractionPort,
    private readonly embeddings: EmbeddingPort,
    private readonly generation: TextGenerationPort,
    private readonly background: BackgroundTasksPort,
  ) {}

  /** Schedules ingestion without blocking the caller. Never throws. */
  enqueue(source: Source, rawText?: string): void {
    this.background.run(`ingest:${source.id}`, () => this.run(source, rawText));
  }

  async run(source: Source, rawText?: string): Promise<void> {
    try {
      source.beginExtraction();
      await this.sources.update(source);

      const document = await this.extractDocument(source, rawText);

      source.beginChunking();
      await this.sources.update(source);

      const chunks = chunkDocument(document.sections);
      if (chunks.length === 0) {
        source.markFailed('no text could be extracted from this source');
        await this.sources.update(source);
        return;
      }

      const tokenCount = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
      source.beginEmbedding(chunks.length, tokenCount);
      await this.sources.update(source);

      const vectors = await this.embeddings.embedDocuments(
        chunks.map((chunk) => chunk.content),
      );

      await this.sources.replaceChunks(
        source,
        chunks.map((chunk, index) => ({
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          headingPath: chunk.headingPath,
          pageNumber: chunk.pageNumber,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          tokenCount: chunk.tokenCount,
          embedding: vectors[index] ?? [],
        })),
      );

      const overview = await this.summarise(chunks.map((chunk) => chunk.content));
      source.markReady(overview.summary, overview.keyTopics);
      await this.sources.update(source);

      this.logger.log(
        { sourceId: source.id, chunks: chunks.length },
        'source ingested successfully',
      );
    } catch (error) {
      // Three cases, and conflating them is what makes an unfixable failure
      // look like a transient one:
      //
      //  - an invariant violation carries a message written for a user
      //    ("this PDF could not be read"), so it passes through;
      //  - a rejected credential will never succeed on retry, so say so
      //    without quoting the vendor or leaking any part of the key;
      //  - anything else may genuinely be transient.
      const reason =
        error instanceof InvariantViolationError
          ? error.message
          : error instanceof DependencyNotConfiguredError
            ? 'the AI service is not configured on this server — an administrator needs to add a valid API key'
            : 'this source could not be processed — please try again';
      this.logger.error({ err: error, sourceId: source.id }, 'ingestion failed');

      source.markFailed(reason);
      await this.sources.update(source).catch((updateError: unknown) => {
        this.logger.error({ err: updateError }, 'could not record ingestion failure');
      });
    }
  }

  private async extractDocument(
    source: Source,
    rawText?: string,
  ): Promise<ExtractedDocument> {
    if (source.kind === 'url') {
      return this.extraction.extract({ kind: 'url', url: source.originUri ?? '' });
    }
    if (rawText !== undefined) {
      return this.extraction.extract({ kind: source.kind, rawText });
    }

    const storagePath = source.storagePath;
    if (!storagePath) {
      throw new Error(`source ${source.id} has neither raw text nor a stored object`);
    }
    const bytes = await this.storage.download(storagePath);
    return this.extraction.extract({ kind: source.kind, bytes });
  }

  /**
   * Summaries are best-effort: a source with working chunks is useful even if
   * the overview call fails, so a failure here must not fail the ingest.
   */
  private async summarise(
    contents: string[],
  ): Promise<{ summary: string | null; keyTopics: string[] }> {
    try {
      const excerpt = contents.slice(0, 12).join('\n\n---\n\n').slice(0, 24_000);
      const result = await this.generation.generateObject(
        SUMMARY_SYSTEM,
        `<document>\n${excerpt}\n</document>`,
        summarySchema,
        { tier: 'utility', maxTokens: 2000, cacheSystemPrompt: true },
      );
      return { summary: result.summary, keyTopics: result.keyTopics };
    } catch (error) {
      this.logger.warn({ err: error }, 'source summary generation failed');
      return { summary: null, keyTopics: [] };
    }
  }
}
