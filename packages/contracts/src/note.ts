import { z } from 'zod';
import { safeText, uuidSchema } from './common.js';
import { citationSchema } from './chat.js';

export const noteOriginSchema = z.enum(['manual', 'chat', 'studio']);
export type NoteOrigin = z.infer<typeof noteOriginSchema>;

export const noteSchema = z.object({
  id: uuidSchema,
  notebookId: uuidSchema,
  title: z.string(),
  content: z.string(),
  origin: noteOriginSchema,
  citations: z.array(citationSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Note = z.infer<typeof noteSchema>;

export const createNoteSchema = z.object({
  title: safeText(200).optional(),
  content: z.string().max(100_000).default(''),
  origin: noteOriginSchema.default('manual'),
  citations: z.array(citationSchema).max(100).default([]),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z
  .object({
    title: safeText(200).optional(),
    content: z.string().max(100_000).optional(),
  })
  .refine((value) => value.title !== undefined || value.content !== undefined, {
    message: 'at least one field must be provided',
  });
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
