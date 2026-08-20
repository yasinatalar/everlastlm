import { z } from 'zod';
import { uuidSchema } from './common.js';

export const studioKindSchema = z.enum([
  'study_guide',
  'briefing_doc',
  'faq',
  'timeline',
  'audio_overview',
]);
export type StudioKind = z.infer<typeof studioKindSchema>;

export const studioStatusSchema = z.enum(['pending', 'generating', 'ready', 'failed']);
export type StudioStatus = z.infer<typeof studioStatusSchema>;

/**
 * Each studio kind produces a differently shaped document. Modelling them as a
 * discriminated union keeps the renderer exhaustive: adding a kind without
 * adding a renderer is a compile error.
 */
export const studyGuideContentSchema = z.object({
  kind: z.literal('study_guide'),
  summary: z.string(),
  keyConcepts: z.array(z.object({ term: z.string(), definition: z.string() })),
  shortAnswerQuestions: z.array(z.object({ question: z.string(), answer: z.string() })),
  essayPrompts: z.array(z.string()),
  glossary: z.array(z.object({ term: z.string(), definition: z.string() })),
});

export const briefingDocContentSchema = z.object({
  kind: z.literal('briefing_doc'),
  executiveSummary: z.string(),
  themes: z.array(z.object({ title: z.string(), detail: z.string() })),
  notableQuotes: z.array(z.object({ quote: z.string(), attribution: z.string() })),
  openQuestions: z.array(z.string()),
});

export const faqContentSchema = z.object({
  kind: z.literal('faq'),
  entries: z.array(z.object({ question: z.string(), answer: z.string() })),
});

export const timelineContentSchema = z.object({
  kind: z.literal('timeline'),
  events: z.array(
    z.object({
      label: z.string(),
      /** Free-form: sources rarely give machine-parsable dates. */
      when: z.string(),
      detail: z.string(),
    }),
  ),
  cast: z.array(z.object({ name: z.string(), role: z.string() })),
});

export const audioOverviewContentSchema = z.object({
  kind: z.literal('audio_overview'),
  title: z.string(),
  turns: z.array(
    z.object({
      speaker: z.enum(['host_a', 'host_b']),
      text: z.string(),
    }),
  ),
});

export const studioContentSchema = z.discriminatedUnion('kind', [
  studyGuideContentSchema,
  briefingDocContentSchema,
  faqContentSchema,
  timelineContentSchema,
  audioOverviewContentSchema,
]);
export type StudioContent = z.infer<typeof studioContentSchema>;

export const studioArtifactSchema = z.object({
  id: uuidSchema,
  notebookId: uuidSchema,
  kind: studioKindSchema,
  status: studioStatusSchema,
  title: z.string(),
  content: studioContentSchema.nullable(),
  sourceIds: z.array(uuidSchema),
  /** Signed, short-lived URL; only present for a ready audio overview. */
  audioUrl: z.string().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StudioArtifact = z.infer<typeof studioArtifactSchema>;

export const generateStudioArtifactSchema = z.object({
  kind: studioKindSchema,
  sourceIds: z.array(uuidSchema).max(300).optional(),
  /** Steers the generation, e.g. "focus on the regulatory chapters". */
  focus: z.string().max(1000).optional(),
});
export type GenerateStudioArtifactInput = z.infer<typeof generateStudioArtifactSchema>;
