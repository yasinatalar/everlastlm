import { z } from 'zod';
import {
  audioOverviewContentSchema,
  briefingDocContentSchema,
  faqContentSchema,
  studyGuideContentSchema,
  timelineContentSchema,
  type StudioKind,
} from '@everlast/contracts';
import { SOURCE_TRUST_BOUNDARY } from '../../../infrastructure/llm/prompt-safety';

const GROUNDING = `
Work only from the supplied <document> material. Do not add facts from outside
knowledge. Where the sources are silent, leave the section short rather than
inventing content. Write in the dominant language of the sources.

${SOURCE_TRUST_BOUNDARY}
`.trim();

/**
 * Each studio kind pairs a schema with a prompt. Keeping them side by side
 * means the prompt and the shape it must produce can never drift apart, and
 * adding a kind is one entry here plus one renderer in the web app.
 */
export interface StudioRecipe {
  schema: z.ZodType;
  system: string;
  defaultTitle: { en: string; de: string };
  maxTokens: number;
}

export const STUDIO_RECIPES: Record<StudioKind, StudioRecipe> = {
  study_guide: {
    schema: studyGuideContentSchema,
    maxTokens: 16_000,
    defaultTitle: { en: 'Study guide', de: 'Lernleitfaden' },
    system: `
You produce a study guide from a set of sources.

Include: a short orienting summary; the key concepts with precise definitions;
short-answer questions with model answers that a reader could actually check
themselves against; a few essay prompts that require synthesis across sources;
and a glossary of terms the sources use in a specific way.

Favour precision over breadth — ten concepts explained exactly beat thirty
listed. ${GROUNDING}
`.trim(),
  },

  briefing_doc: {
    schema: briefingDocContentSchema,
    maxTokens: 16_000,
    defaultTitle: { en: 'Briefing document', de: 'Briefing-Dokument' },
    system: `
You produce an executive briefing from a set of sources.

Include: an executive summary a decision-maker could act on; the major themes
with enough detail to be useful; notable verbatim quotes with attribution; and
the open questions the sources raise but do not answer.

Write for someone who has not read the sources and will not have time to. Be
direct about what is uncertain. ${GROUNDING}
`.trim(),
  },

  faq: {
    schema: faqContentSchema,
    maxTokens: 12_000,
    defaultTitle: { en: 'Frequently asked questions', de: 'Häufige Fragen' },
    system: `
You produce an FAQ from a set of sources.

Write the questions a real reader of this material would actually ask — the
points of confusion, the practical "how do I", the "what happens if". Avoid
questions that merely restate a heading. Each answer should be complete on its
own in two to five sentences. ${GROUNDING}
`.trim(),
  },

  timeline: {
    schema: timelineContentSchema,
    maxTokens: 12_000,
    defaultTitle: { en: 'Timeline', de: 'Zeitstrahl' },
    system: `
You extract a chronology from a set of sources.

List the events in the order they happened, with whatever time reference the
sources give — an exact date, "early 2019", or "after the merger" are all fine;
do not invent precision the sources lack. Then list the people and organisations
that recur, with their role.

If the material has no meaningful chronology, return few events rather than
manufacturing a sequence. ${GROUNDING}
`.trim(),
  },

  audio_overview: {
    schema: audioOverviewContentSchema,
    maxTokens: 20_000,
    defaultTitle: { en: 'Audio overview', de: 'Audio-Überblick' },
    system: `
You write a two-host conversation about a set of sources, to be read aloud.

host_a hosts: they frame each topic, ask the questions a curious newcomer would
ask, and keep the thread moving. host_b explains: they have read the material
closely and give concrete, specific answers.

Requirements:
- Open by saying what the sources are and why they are interesting. Do not open
  with a greeting to an audience.
- 12-20 turns. Each turn is one or two spoken sentences — this is dialogue, not
  a lecture split across two names.
- Write for the ear: contractions, plain words, no bullet points, no headings,
  no markdown, no citation markers, no stage directions.
- Spell out numbers and abbreviations the way they would be said aloud.
- Cover the substance, including anything surprising or contested.
- Close with what the material leaves unresolved.

${GROUNDING}
`.trim(),
  },
};
