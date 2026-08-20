import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { supportsAdaptiveThinking } from './anthropic.client';
import { stripUnsupportedKeywords } from './claude-text-generation.adapter';

/**
 * Regression: the summary schema used `z.array(...).max(8)`, which becomes
 * `maxItems` in JSON Schema and is rejected by structured outputs with
 * "For 'array' type, property 'maxItems' is not supported". Because summaries
 * are best-effort, the 400 was swallowed and every source silently ended up
 * with no summary and no key topics.
 */
describe('stripUnsupportedKeywords', () => {
  it('removes array size constraints emitted by Zod', () => {
    const schema = z.toJSONSchema(
      z.object({ keyTopics: z.array(z.string().max(60)).max(8) }),
      { target: 'draft-7', io: 'output' },
    );

    const serialised = JSON.stringify(stripUnsupportedKeywords(schema));

    expect(JSON.stringify(schema)).toContain('maxItems');
    expect(serialised).not.toContain('maxItems');
    expect(serialised).not.toContain('maxLength');
  });

  it('keeps the parts that define the shape', () => {
    const cleaned = stripUnsupportedKeywords(
      z.toJSONSchema(
        z.object({ summary: z.string(), topics: z.array(z.string()).max(3) }),
        { target: 'draft-7', io: 'output' },
      ),
    ) as Record<string, unknown>;

    expect(cleaned['type']).toBe('object');
    expect(Object.keys(cleaned['properties'] as object)).toEqual(['summary', 'topics']);
    expect(cleaned['required']).toEqual(['summary', 'topics']);
  });

  it('recurses through nested objects and arrays', () => {
    const cleaned = JSON.stringify(
      stripUnsupportedKeywords({
        type: 'object',
        properties: {
          nested: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 10 } },
          list: [{ minimum: 1 }, { multipleOf: 2 }],
        },
      }),
    );

    for (const keyword of ['maxItems', 'maxLength', 'minimum', 'multipleOf']) {
      expect(cleaned).not.toContain(keyword);
    }
    expect(cleaned).toContain('nested');
    expect(cleaned).toContain('"type":"string"');
  });

  it('passes primitives through untouched', () => {
    expect(stripUnsupportedKeywords(null)).toBeNull();
    expect(stripUnsupportedKeywords('x')).toBe('x');
    expect(stripUnsupportedKeywords(7)).toBe(7);
  });
});

describe('supportsAdaptiveThinking', () => {
  /**
   * Regression: `thinking: {type:'adaptive'}` was sent on every call, including
   * the utility tier running claude-haiku-4-5, which answers
   * `400 adaptive thinking is not supported on this model`. Summaries and chat
   * titles are best-effort, so the 400 was swallowed and both features were
   * silently dead.
   */
  it.each(['claude-opus-5', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-fable-5'])(
    'enables it for %s',
    (model) => expect(supportsAdaptiveThinking(model)).toBe(true),
  );

  it.each(['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-3-5-haiku'])(
    'omits it for %s',
    (model) => expect(supportsAdaptiveThinking(model)).toBe(false),
  );
});
