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
