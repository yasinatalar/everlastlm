import type { SourceKind } from '@everlast/contracts';

export interface ExtractedSection {
  text: string;
  /** 1-based; only PDFs carry meaningful page numbers. */
  pageNumber: number | null;
  /** Document outline down to this section, e.g. ["Chapter 2", "Methods"]. */
  headingPath: string[];
}

export interface ExtractedDocument {
  title: string | null;
  sections: ExtractedSection[];
}

export interface ExtractionInput {
  kind: SourceKind;
  bytes?: Buffer;
  url?: string;
  rawText?: string;
  filename?: string;
}

export abstract class TextExtractionPort {
  abstract extract(input: ExtractionInput): Promise<ExtractedDocument>;
}
