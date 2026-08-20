import { Inject, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { APP_CONFIG } from '../../config/app-config.module';
import type { Env } from '../../config/env.schema';

/**
 * One shared SDK client. The SDK already retries 408/409/429/5xx twice with
 * backoff, so adapters do not implement their own retry loop on top.
 */
@Injectable()
export class AnthropicClient {
  readonly sdk: Anthropic;
  readonly primaryModel: string;
  readonly utilityModel: string;

  constructor(@Inject(APP_CONFIG) config: Env) {
    this.sdk = new Anthropic({
      apiKey: config.ANTHROPIC_API_KEY,
      maxRetries: 3,
      timeout: 120_000,
    });
    this.primaryModel = config.ANTHROPIC_MODEL;
    this.utilityModel = config.ANTHROPIC_UTILITY_MODEL;
  }

  modelFor(tier: 'primary' | 'utility' = 'primary'): string {
    return tier === 'utility' ? this.utilityModel : this.primaryModel;
  }
}

/**
 * Whether a model accepts `thinking: {type: 'adaptive'}`.
 *
 * Sending it to a model that does not returns
 * `400 adaptive thinking is not supported on this model`. That matters here
 * because the utility tier runs a cheaper, older model than the primary tier —
 * so a single hardcoded `thinking` block works for chat and breaks every
 * summary and conversation title, which are best-effort and swallow the error.
 *
 * Adaptive thinking arrived with the 4.6 generation. Haiku 4.5 and anything
 * older predate it.
 */
export const supportsAdaptiveThinking = (model: string): boolean =>
  /^claude-(fable|mythos)-\d/.test(model) ||
  /^claude-opus-(4-[6-9]|[5-9])/.test(model) ||
  /^claude-sonnet-(4-[6-9]|[5-9])/.test(model);
