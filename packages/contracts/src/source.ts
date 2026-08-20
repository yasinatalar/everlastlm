import { z } from 'zod';
import { safeText, uuidSchema } from './common.js';

export const sourceKindSchema = z.enum(['pdf', 'docx', 'text', 'markdown', 'url']);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const sourceStatusSchema = z.enum([
  'pending',
  'extracting',
  'chunking',
  'embedding',
  'ready',
  'failed',
]);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

/** Terminal states — the UI stops polling once a source reaches one. */
export const TERMINAL_SOURCE_STATUSES: readonly SourceStatus[] = ['ready', 'failed'];

export const sourceSchema = z.object({
  id: uuidSchema,
  notebookId: uuidSchema,
  kind: sourceKindSchema,
  title: z.string(),
  originUri: z.string().nullable(),
  byteSize: z.number().int().nonnegative().nullable(),
  status: sourceStatusSchema,
  failureReason: z.string().nullable(),
  summary: z.string().nullable(),
  keyTopics: z.array(z.string()),
  chunkCount: z.number().int().nonnegative(),
  tokenCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Source = z.infer<typeof sourceSchema>;

/**
 * Upload limits. Enforced in three places: the browser (fail fast), the API
 * (authoritative) and the storage bucket definition (last line of defence).
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_SOURCES_PER_NOTEBOOK = 300;

export const ACCEPTED_UPLOAD_MIME_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'markdown',
} as const satisfies Record<string, SourceKind>;

export type AcceptedUploadMimeType = keyof typeof ACCEPTED_UPLOAD_MIME_TYPES;

export const addUrlSourceSchema = z.object({
  url: z
    .url()
    .max(2048)
    .refine((value) => /^https?:\/\//i.test(value), {
      message: 'only http(s) URLs are supported',
    }),
  title: safeText(300).optional(),
});
export type AddUrlSourceInput = z.infer<typeof addUrlSourceSchema>;

export const addTextSourceSchema = z.object({
  title: safeText(300),
  content: z.string().min(1).max(1_000_000),
  kind: z.enum(['text', 'markdown']).default('text'),
});
export type AddTextSourceInput = z.infer<typeof addTextSourceSchema>;

export const renameSourceSchema = z.object({ title: safeText(300) });
export type RenameSourceInput = z.infer<typeof renameSourceSchema>;
