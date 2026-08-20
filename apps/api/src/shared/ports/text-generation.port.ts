import type { z } from 'zod';

export interface GenerationOptions {
  /** Prefer the cheaper utility model for mechanical work. */
  tier?: 'primary' | 'utility';
  maxTokens?: number;
  /** Marks the system prompt as a cache breakpoint when it is large + stable. */
  cacheSystemPrompt?: boolean;
  /**
   * How much thinking the model spends. Lower is materially faster — measured
   * roughly 2x between `high` and `low` — at a cost in depth. Set it where a
   * wall-clock ceiling matters more than the last increment of quality.
   */
  effort?: 'low' | 'medium' | 'high';
}

export abstract class TextGenerationPort {
  abstract generateText(
    system: string,
    userContent: string,
    options?: GenerationOptions,
  ): Promise<string>;

  /**
   * Generates a value conforming to `schema`. The adapter is responsible for
   * constraining the model's output format and for validating before returning,
   * so callers never hand-parse model output.
   */
  abstract generateObject<T extends z.ZodType>(
    system: string,
    userContent: string,
    schema: T,
    options?: GenerationOptions,
  ): Promise<z.infer<T>>;
}
