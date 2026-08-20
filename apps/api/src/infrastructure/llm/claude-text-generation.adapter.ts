import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  DependencyFailureError,
  DependencyNotConfiguredError,
} from '../../shared/kernel/domain-error';
import {
  TextGenerationPort,
  type GenerationOptions,
} from '../../shared/ports/text-generation.port';
import { AnthropicClient, supportsAdaptiveThinking } from './anthropic.client';

/**
 * Constraint keywords the structured-output schema validator rejects.
 *
 * `z.array(x).max(8)` emits `maxItems`, and the API answers
 * "For 'array' type, property 'maxItems' is not supported" — a 400 that, in a
 * best-effort code path, silently disables the feature instead of failing
 * loudly. Every source summary was being skipped this way.
 *
 * Stripping them costs nothing: the response is parsed with the original Zod
 * schema afterwards, so the constraints are still enforced — just by us rather
 * than by the model's decoder.
 */
const UNSUPPORTED_SCHEMA_KEYWORDS = [
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
] as const;

export const stripUnsupportedKeywords = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(stripUnsupportedKeywords);
  if (!schema || typeof schema !== 'object') return schema;

  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([key]) => !UNSUPPORTED_SCHEMA_KEYWORDS.includes(key as never))
      .map(([key, value]) => [key, stripUnsupportedKeywords(value)]),
  );
};

@Injectable()
export class ClaudeTextGenerationAdapter extends TextGenerationPort {
  private readonly logger = new Logger(ClaudeTextGenerationAdapter.name);

  constructor(private readonly anthropic: AnthropicClient) {
    super();
  }

  async generateText(
    system: string,
    userContent: string,
    options: GenerationOptions = {},
  ): Promise<string> {
    const message = await this.send(system, userContent, options);
    return message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
  }

  /**
   * Uses `output_config.format` so the model is *constrained* to the schema
   * rather than merely asked for JSON. The local Zod parse afterwards is not
   * redundant: it converts a schema the API accepted but that our types
   * disagree with into a clean dependency failure instead of a type lie.
   */
  async generateObject<T extends z.ZodType>(
    system: string,
    userContent: string,
    schema: T,
    options: GenerationOptions = {},
  ): Promise<z.infer<T>> {
    const message = await this.send(system, userContent, options, {
      type: 'json_schema',
      schema: stripUnsupportedKeywords(
        z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }),
      ) as Record<string, unknown>,
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new DependencyFailureError('anthropic', 'model returned malformed JSON');
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      this.logger.error(
        { issues: result.error.issues.slice(0, 5) },
        'structured output did not match schema',
      );
      throw new DependencyFailureError('anthropic', 'model output failed schema validation');
    }
    return result.data;
  }

  private async send(
    system: string,
    userContent: string,
    options: GenerationOptions,
    format?: { type: 'json_schema'; schema: Record<string, unknown> },
  ): Promise<Anthropic.Message> {
    const maxTokens = options.maxTokens ?? 16_000;
    const model = this.anthropic.modelFor(options.tier);

    try {
      // Streaming avoids HTTP timeouts on the long studio generations; the
      // helper still hands back one complete message.
      const stream = this.anthropic.sdk.messages.stream({
        model,
        max_tokens: maxTokens,
        // Omitted entirely on models that predate adaptive thinking — sending
        // it there is a hard 400, not a silently ignored parameter.
        ...(supportsAdaptiveThinking(model) ? { thinking: { type: 'adaptive' as const } } : {}),
        // One object, deliberately. Spreading `output_config` twice silently
        // drops the first — and `effort` is only ever set alongside `format`,
        // so the speed setting would be lost in exactly the case it exists for.
        ...(options.effort || format
          ? {
              output_config: {
                ...(options.effort ? { effort: options.effort } : {}),
                ...(format ? { format } : {}),
              },
            }
          : {}),
        system: options.cacheSystemPrompt
          ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
          : system,
        messages: [{ role: 'user', content: userContent }],
      });

      const message = await stream.finalMessage();

      if (message.stop_reason === 'refusal') {
        throw new DependencyFailureError(
          'anthropic',
          `generation declined (${message.stop_details?.category ?? 'unspecified'})`,
        );
      }
      if (message.stop_reason === 'max_tokens') {
        this.logger.warn(`generation truncated at ${maxTokens} tokens`);
      }
      return message;
    } catch (error) {
      if (error instanceof DependencyFailureError) throw error;
      if (error instanceof Anthropic.AuthenticationError) {
        throw new DependencyNotConfiguredError('anthropic');
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new DependencyFailureError('anthropic', 'rate limited, please retry shortly');
      }
      if (error instanceof Anthropic.APIError) {
        this.logger.error({ status: error.status }, `anthropic error: ${error.message}`);
        throw new DependencyFailureError('anthropic', 'generation failed');
      }
      throw error;
    }
  }
}
