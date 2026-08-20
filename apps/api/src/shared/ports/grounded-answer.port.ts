import type { Citation } from '@everlast/contracts';

/** A retrieved chunk, already authorised, ready to be shown to the model. */
export interface RetrievedChunk {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceKind: 'pdf' | 'docx' | 'text' | 'markdown' | 'url';
  chunkIndex: number;
  pageNumber: number | null;
  headingPath: string[];
  content: string;
}

export interface GroundedAnswerRequest {
  question: string;
  chunks: RetrievedChunk[];
  /** Prior turns, oldest first, already trimmed to a sane window. */
  history: { role: 'user' | 'assistant'; content: string }[];
  /** Answer in the user's UI language unless the sources force otherwise. */
  locale: 'en' | 'de';
}

export type GroundedAnswerEvent =
  | { type: 'text'; text: string }
  | { type: 'citation'; citation: Citation }
  | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } };

/**
 * Produces an answer that is grounded in the supplied chunks and nothing else.
 *
 * Citations are not post-hoc string matching: the adapter passes the chunks as
 * citable document blocks and streams back the model's own citation records, so
 * a marker in the answer always points at the passage the model actually used.
 */
export abstract class GroundedAnswerPort {
  abstract stream(request: GroundedAnswerRequest): AsyncGenerator<GroundedAnswerEvent>;
}
