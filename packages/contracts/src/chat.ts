import { z } from 'zod';
import { safeText, uuidSchema } from './common.js';
import { sourceKindSchema } from './source.js';

/**
 * A citation resolves a span of the assistant's answer back to the exact chunk
 * it came from. `marker` is the 1-based number rendered inline in the answer
 * (`[1]`, `[2]`, ...) and is assigned by the answering service, so the client
 * never has to guess at ordering.
 */
export const citationSchema = z.object({
  marker: z.number().int().positive(),
  chunkId: uuidSchema,
  sourceId: uuidSchema,
  sourceTitle: z.string(),
  sourceKind: sourceKindSchema,
  chunkIndex: z.number().int().nonnegative(),
  pageNumber: z.number().int().positive().nullable(),
  headingPath: z.array(z.string()),
  /** Verbatim passage returned by the model's citation block. */
  quotedText: z.string(),
});
export type Citation = z.infer<typeof citationSchema>;

export const conversationSchema = z.object({
  id: uuidSchema,
  notebookId: uuidSchema,
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const chatMessageSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(citationSchema),
  createdAt: z.iso.datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const askQuestionSchema = z.object({
  question: safeText(4000),
  /** Restrict retrieval to a subset of sources; empty/omitted means all. */
  sourceIds: z.array(uuidSchema).max(300).optional(),
});
export type AskQuestionInput = z.infer<typeof askQuestionSchema>;

/**
 * Server-sent event payloads for a streamed answer. `citations` arrives before
 * the first token so the UI can render the source rail while text streams in.
 */
export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message_start'),
    messageId: uuidSchema,
    conversationId: uuidSchema,
  }),
  z.object({ type: z.literal('citations'), citations: z.array(citationSchema) }),
  z.object({ type: z.literal('text_delta'), text: z.string() }),
  z.object({
    type: z.literal('message_end'),
    messageId: uuidSchema,
    citations: z.array(citationSchema),
    usage: z
      .object({ inputTokens: z.number().int(), outputTokens: z.number().int() })
      .optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
