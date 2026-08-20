import { Inject, Injectable, Logger } from '@nestjs/common';
import { request } from 'undici';
import { APP_CONFIG } from '../../config/app-config.module';
import type { Env } from '../../config/env.schema';
import {
  DependencyFailureError,
  DependencyNotConfiguredError,
} from '../../shared/kernel/domain-error';
import { EmbeddingPort } from '../../shared/ports/embedding.port';

/** Voyage caps a single request at 1000 inputs; stay well under it. */
const MAX_BATCH = 96;
const ENDPOINT = 'https://api.voyageai.com/v1/embeddings';

interface VoyageResponse {
  data?: { embedding: number[]; index: number }[];
  total_tokens?: number;
  detail?: string;
}

@Injectable()
export class VoyageEmbeddingAdapter extends EmbeddingPort {
  private readonly logger = new Logger(VoyageEmbeddingAdapter.name);
  readonly dimensions: number;

  constructor(@Inject(APP_CONFIG) private readonly config: Env) {
    super();
    this.dimensions = config.VOYAGE_DIMENSIONS;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += MAX_BATCH) {
      const batch = texts.slice(offset, offset + MAX_BATCH);
      results.push(...(await this.embed(batch, 'document')));
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([text], 'query');
    if (!vector) throw new DependencyFailureError('voyage', 'no embedding returned');
    return vector;
  }

  /**
   * `input_type` matters: Voyage's models are asymmetric, so a passage embedded
   * as a `document` and a question embedded as a `query` land closer together
   * than if both used the same prompt. Getting this backwards silently degrades
   * retrieval without ever erroring.
   */
  private async embed(inputs: string[], inputType: 'document' | 'query'): Promise<number[][]> {
    const body = JSON.stringify({
      model: this.config.VOYAGE_MODEL,
      input: inputs,
      input_type: inputType,
      output_dimension: this.dimensions,
      truncation: true,
    });

    const response = await this.withRetry(async () => {
      const res = await request(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.VOYAGE_API_KEY}`,
          'content-type': 'application/json',
        },
        body,
        headersTimeout: 30_000,
        bodyTimeout: 60_000,
      });

      const payload = (await res.body.json()) as VoyageResponse;

      // A rejected key is a configuration problem, not a transient one.
      // Retrying it burns the backoff budget and then reports a misleading
      // "try again" to someone who cannot fix it by trying again.
      if (res.statusCode === 401 || res.statusCode === 403) {
        throw new DependencyNotConfiguredError('voyage');
      }

      if (res.statusCode >= 400) {
        const retryable = res.statusCode === 429 || res.statusCode >= 500;
        throw new EmbeddingHttpError(
          `voyage responded ${res.statusCode}: ${payload.detail ?? 'unknown error'}`,
          retryable,
        );
      }
      return payload;
    });

    const data = response.data ?? [];
    if (data.length !== inputs.length) {
      throw new DependencyFailureError(
        'voyage',
        `expected ${inputs.length} embeddings, received ${data.length}`,
      );
    }

    // The API documents index ordering but does not guarantee array order.
    const ordered: number[][] = new Array(inputs.length);
    for (const entry of data) ordered[entry.index] = entry.embedding;

    for (const [index, vector] of ordered.entries()) {
      if (!vector || vector.length !== this.dimensions) {
        throw new DependencyFailureError(
          'voyage',
          `embedding ${index} has width ${vector?.length ?? 0}, expected ${this.dimensions}`,
        );
      }
    }
    return ordered;
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        // Never retried, and never rewrapped — it must reach the caller intact
        // so the failure is reported as configuration rather than a fault.
        if (error instanceof DependencyNotConfiguredError) throw error;

        lastError = error;
        const retryable = !(error instanceof EmbeddingHttpError) || error.retryable;
        if (!retryable || attempt === attempts) break;

        const backoffMs = 2 ** attempt * 250 + Math.floor(Math.random() * 200);
        this.logger.warn(`voyage attempt ${attempt} failed, retrying in ${backoffMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw new DependencyFailureError(
      'voyage',
      lastError instanceof Error ? lastError.message : 'embedding request failed',
    );
  }
}

class EmbeddingHttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}
