import type { ExtractedSection } from '../domain/text-extraction.port';

export interface Chunk {
  chunkIndex: number;
  content: string;
  headingPath: string[];
  pageNumber: number | null;
  charStart: number;
  charEnd: number;
  tokenCount: number;
}

export interface ChunkOptions {
  /** Target chunk size in tokens. */
  targetTokens?: number;
  /** Overlap carried into the next chunk, in tokens. */
  overlapTokens?: number;
  /** Chunks smaller than this are merged forward rather than kept. */
  minTokens?: number;
}

/**
 * Rough token estimate. A real tokenizer would be more accurate but adds a
 * heavyweight dependency and a per-chunk cost, and chunk sizing only needs to
 * be approximately right — retrieval quality is far more sensitive to *where*
 * we split than to being within a few percent of a token target.
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const DEFAULTS = { targetTokens: 900, overlapTokens: 140, minTokens: 60 } as const;

/**
 * Splits a document into retrievable chunks.
 *
 * Two properties matter for citation quality:
 *
 *  - Splits land on paragraph boundaries wherever possible, so a chunk is a
 *    coherent passage. Splitting mid-sentence produces citations that read as
 *    broken quotes.
 *  - Consecutive chunks overlap. Without overlap, a fact stated across a
 *    paragraph boundary is in neither chunk in full and is retrieved by
 *    neither.
 *
 * Heading context is prepended to the chunk's stored text so the embedding
 * captures where in the document the passage sits — "Revenue fell 4%" means
 * something different under "Q3 2024" than under "Risks".
 */
export const chunkDocument = (
  sections: ExtractedSection[],
  options: ChunkOptions = {},
): Chunk[] => {
  const { targetTokens, overlapTokens, minTokens } = { ...DEFAULTS, ...options };
  const chunks: Chunk[] = [];

  let cursor = 0; // running char offset across the whole document

  for (const section of sections) {
    // Where this section's chunks begin, so a trailing fragment is only ever
    // merged into a chunk from the *same* section. Merging across sections
    // would attach page-2 text to a chunk labelled page 1, and the citation
    // would then point a reader at the wrong page.
    const sectionStart = chunks.length;

    const paragraphs = section.text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    let buffer: string[] = [];
    let bufferTokens = 0;
    let bufferStart = cursor;

    const emit = () => {
      const body = buffer.join('\n\n').trim();
      if (!body) return;

      const prefix =
        section.headingPath.length > 0 ? `${section.headingPath.join(' › ')}\n\n` : '';
      const content = `${prefix}${body}`;

      chunks.push({
        chunkIndex: chunks.length,
        content,
        headingPath: section.headingPath,
        pageNumber: section.pageNumber,
        charStart: bufferStart,
        charEnd: bufferStart + body.length,
        tokenCount: estimateTokens(content),
      });
    };

    for (const paragraph of paragraphs) {
      const paragraphTokens = estimateTokens(paragraph);

      // A single oversized paragraph (a wall-of-text PDF page) is split on
      // sentence boundaries rather than dropped or truncated.
      if (paragraphTokens > targetTokens) {
        if (buffer.length > 0) {
          emit();
          buffer = [];
          bufferTokens = 0;
        }
        for (const piece of splitLongParagraph(paragraph, targetTokens)) {
          bufferStart = cursor;
          buffer = [piece];
          bufferTokens = estimateTokens(piece);
          emit();
          cursor += piece.length + 2;
          buffer = [];
          bufferTokens = 0;
        }
        continue;
      }

      if (bufferTokens + paragraphTokens > targetTokens && buffer.length > 0) {
        emit();
        const carried = carryOverlap(buffer, overlapTokens);
        buffer = carried;
        bufferTokens = carried.reduce((sum, part) => sum + estimateTokens(part), 0);
        bufferStart = cursor;
      }

      if (buffer.length === 0) bufferStart = cursor;
      buffer.push(paragraph);
      bufferTokens += paragraphTokens;
      cursor += paragraph.length + 2;
    }

    if (buffer.length === 0) continue;

    const previous = chunks.length > sectionStart ? chunks[chunks.length - 1] : undefined;

    if (bufferTokens >= minTokens || !previous) {
      // Either large enough to stand alone, or the only content this section
      // produced — a short page still deserves its own chunk so its page
      // number survives.
      emit();
    } else {
      // Too small to retrieve well on its own, and there is a same-section
      // chunk to fold it into.
      const tail = buffer.join('\n\n').trim();
      if (tail) {
        previous.content = `${previous.content}\n\n${tail}`;
        previous.charEnd += tail.length;
        previous.tokenCount = estimateTokens(previous.content);
      }
    }
  }

  return chunks.map((chunk, index) => ({ ...chunk, chunkIndex: index }));
};

/** Takes whole trailing paragraphs until the overlap budget is spent. */
const carryOverlap = (buffer: string[], overlapTokens: number): string[] => {
  const carried: string[] = [];
  let tokens = 0;

  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    const paragraph = buffer[index]!;
    const paragraphTokens = estimateTokens(paragraph);
    if (tokens + paragraphTokens > overlapTokens && carried.length > 0) break;
    carried.unshift(paragraph);
    tokens += paragraphTokens;
    if (tokens >= overlapTokens) break;
  }
  return carried;
};

const splitLongParagraph = (paragraph: string, targetTokens: number): string[] => {
  const sentences = paragraph.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [paragraph];
  const pieces: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    if (estimateTokens(buffer + sentence) > targetTokens && buffer) {
      pieces.push(buffer.trim());
      buffer = '';
    }
    buffer += sentence;
  }
  if (buffer.trim()) pieces.push(buffer.trim());
  return pieces;
};
