import { Inject, Injectable, Logger } from '@nestjs/common';
import { request } from 'undici';
import { APP_CONFIG } from '../../config/app-config.module';
import type { Env } from '../../config/env.schema';
import {
  DependencyFailureError,
  DependencyNotConfiguredError,
  DependencyRateLimitedError,
} from '../../shared/kernel/domain-error';
import { EmbeddingPort } from '../../shared/ports/embedding.port';

/** Voyage caps a single request at 1000 inputs; stay well under it. */
const MAX_BATCH = 96;

const VOYAGE_HOST = 'https://api.voyageai.com/v1';
const ATLAS_HOST = 'https://ai.mongodb.com/v1';

/**
 * Picks the host from the key prefix, as the official Voyage client does.
 *
 * The same models are reachable from two places with identical request and
 * response shapes, but each only accepts its own credential:
 *
 *   `pa-…`  voyageai.com          (Voyage platform key)
 *   `al-…`  ai.mongodb.com        (Atlas "Model API Key" — MongoDB owns Voyage)
 *
 * Sending an Atlas key to voyageai.com returns a bare 401, which reads exactly
 * like a wrong or expired key and sends you to regenerate a perfectly good one.
 */
export const resolveVoyageBaseUrl = (apiKey: string, override?: string): string => {
  if (override) return override.replace(/\/+$/, '');
  return apiKey.startsWith('al-') ? ATLAS_HOST : VOYAGE_HOST;
};

interface VoyageResponse {
  data?: { embedding: number[]; index: number }[];
  total_tokens?: number;
  detail?: string;
}

@Injectable()
export class VoyageEmbeddingAdapter extends EmbeddingPort {
  private readonly logger = new Logger(VoyageEmbeddingAdapter.name);
  private readonly endpoint: string;
  private readonly minIntervalMs: number;
  readonly dimensions: number;

  constructor(@Inject(APP_CONFIG) private readonly config: Env) {
    super();
    this.dimensions = config.VOYAGE_DIMENSIONS;

    const baseUrl = resolveVoyageBaseUrl(config.VOYAGE_API_KEY, config.VOYAGE_BASE_URL);
    this.endpoint = `${baseUrl}/embeddings`;
    // 60s / requests-per-minute. Defaults to the free-tier ceiling of 3 RPM,
    // because that is the setting people hit without knowing they have it.
    this.minIntervalMs = Math.ceil(60_000 / Math.max(config.VOYAGE_MAX_RPM, 1));

    // Logged at startup so a credential/host mismatch is visible before the
    // first upload fails, rather than as a 401 buried in an ingestion run.
    this.logger.log(`embeddings: ${config.VOYAGE_MODEL} via ${baseUrl}`);
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

    // Self-pacing. A Voyage account without a payment method is capped at
    // 3 requests/minute; firing batches back to back guarantees a 429 that no
    // amount of retrying fixes. Spacing our own calls keeps a multi-chunk
    // document under the ceiling instead of racing into it.
    await this.pace();

    const response = await this.withRetry(async () => {
      const res = await request(this.endpoint, {
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

      if (res.statusCode === 429) {
        const header = res.headers['retry-after'];
        const retryAfter = Number(Array.isArray(header) ? header[0] : header);
        throw new EmbeddingHttpError(
          `voyage responded 429: ${payload.detail ?? 'rate limited'}`,
          true,
          Number.isFinite(retryAfter) ? retryAfter : undefined,
        );
      }

      if (res.statusCode >= 400) {
        throw new EmbeddingHttpError(
          `voyage responded ${res.statusCode}: ${payload.detail ?? 'unknown error'}`,
          res.statusCode >= 500,
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

  /**
   * Ensures a minimum gap between our own requests.
   *
   * Serialised through a promise chain rather than a timestamp check so that
   * concurrent ingestions queue behind one another instead of all seeing the
   * same "last call" and firing together.
   */
  private gate: Promise<void> = Promise.resolve();
  private lastCallAt = 0;

  private pace(): Promise<void> {
    this.gate = this.gate.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.lastCallAt);
      if (wait > 0) await sleep(wait);
      this.lastCallAt = Date.now();
    });
    return this.gate;
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        // Never retried, and never rewrapped — it must reach the caller intact
        // so the failure is reported as configuration rather than a fault.
        if (error instanceof DependencyNotConfiguredError) throw error;

        lastError = error;
        const http = error instanceof EmbeddingHttpError ? error : null;
        const retryable = !http || http.retryable;
        if (!retryable || attempt === attempts) break;

        /**
         * A 429 from a per-minute quota needs to be waited out in seconds, not
         * milliseconds. The previous 0.5s/1s/2s ladder guaranteed that all
         * three attempts landed inside the same rate-limit window and the
         * request failed anyway.
         */
        const backoffMs = http?.retryAfterSeconds
          ? http.retryAfterSeconds * 1000
          : http?.rateLimited
            ? Math.min(this.minIntervalMs * attempt, 60_000)
            : 2 ** attempt * 250;

        const jittered = backoffMs + Math.floor(Math.random() * 250);
        this.logger.warn(
          `voyage attempt ${attempt}/${attempts} failed, retrying in ${Math.round(jittered / 1000)}s`,
        );
        await sleep(jittered);
      }
    }

    if (lastError instanceof EmbeddingHttpError && lastError.rateLimited) {
      // Distinct from a generic failure: retrying already happened and the
      // quota did not clear, so this needs an operator, not another attempt.
      throw new DependencyRateLimitedError('voyage', lastError.retryAfterSeconds);
    }

    throw new DependencyFailureError(
      'voyage',
      lastError instanceof Error ? lastError.message : 'embedding request failed',
    );
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

class EmbeddingHttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** Present when the service told us how long to wait. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }

  /** A 429 needs a different backoff shape from a 5xx. */
  get rateLimited(): boolean {
    return this.message.includes('429');
  }
}
