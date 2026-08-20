import { Inject, Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import mammoth from 'mammoth';
import { stripControlChars } from '@everlast/contracts';
import { APP_CONFIG } from '../../../config/app-config.module';
import type { Env } from '../../../config/env.schema';
import { safeFetch } from '../../../infrastructure/net/safe-http';
import { InvariantViolationError } from '../../../shared/kernel/domain-error';
import {
  TextExtractionPort,
  type ExtractedDocument,
  type ExtractedSection,
  type ExtractionInput,
} from '../domain/text-extraction.port';

/** Markdown/HTML headings become the `headingPath` carried by every chunk. */
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+)$/;

@Injectable()
export class TextExtractionAdapter extends TextExtractionPort {
  private readonly logger = new Logger(TextExtractionAdapter.name);

  constructor(@Inject(APP_CONFIG) private readonly config: Env) {
    super();
  }

  async extract(input: ExtractionInput): Promise<ExtractedDocument> {
    switch (input.kind) {
      case 'pdf':
        return this.extractPdf(this.requireBytes(input));
      case 'docx':
        return this.extractDocx(this.requireBytes(input));
      case 'markdown':
        return this.extractMarkdown(this.requireText(input));
      case 'text':
        return this.extractPlainText(this.requireText(input));
      case 'url':
        return this.extractUrl(input.url ?? '');
    }
  }

  private requireBytes(input: ExtractionInput): Buffer {
    if (!input.bytes?.length) {
      throw new InvariantViolationError('source.empty', 'the uploaded file is empty');
    }
    return input.bytes;
  }

  private requireText(input: ExtractionInput): string {
    const text = input.rawText ?? input.bytes?.toString('utf8') ?? '';
    if (!text.trim()) {
      throw new InvariantViolationError('source.empty', 'the document contains no text');
    }
    return text;
  }

  /**
   * Page numbers are preserved so a citation can say "page 14" rather than
   * "chunk 37", which is the difference between a user trusting a citation and
   * having to hunt for it.
   */
  private async extractPdf(bytes: Buffer): Promise<ExtractedDocument> {
    // Loaded lazily: pdf-parse pulls in the whole pdf.js bundle, which most
    // requests never need.
    const { PDFParse } = await import('pdf-parse');

    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    let sections: ExtractedSection[];
    let title: string | null = null;

    try {
      /**
       * Sequential, deliberately — NOT `Promise.all`.
       *
       * pdf.js hands the source buffer to its worker with a structured-clone
       * *transfer*, which detaches it from this thread. Two operations started
       * concurrently both try to transfer the same buffer and the second dies
       * with `DOMException: Cannot transfer object of unsupported type`. It
       * fails for every PDF, not just malformed ones.
       */
      const text = await parser.getText();
      const info = await parser.getInfo().catch(() => null);

      const rawTitle = (info?.info as { Title?: unknown } | undefined)?.Title;
      if (typeof rawTitle === 'string' && rawTitle.trim()) title = rawTitle.trim();

      sections = text.pages
        .map((page) => ({
          text: normalise(page.text),
          pageNumber: page.num,
          headingPath: [] as string[],
        }))
        .filter((section) => section.text.length > 0);
    } catch (error) {
      // Logged at error, with the cause: this branch means the parser threw,
      // which is as likely to be a bug here as a bad file. A PDF that parses
      // but yields nothing is handled separately below as `no_text_layer`.
      this.logger.error({ err: error }, 'pdf parse threw');
      throw new InvariantViolationError(
        'source.unreadable_pdf',
        'this PDF could not be read — it may be password-protected or damaged',
      );
    } finally {
      // pdf.js holds a worker per document; leaking one leaks a thread.
      await parser.destroy().catch(() => undefined);
    }

    if (sections.length === 0) {
      throw new InvariantViolationError(
        'source.no_text_layer',
        'no selectable text found — scanned PDFs need OCR before import',
      );
    }

    return { title, sections };
  }

  private async extractDocx(bytes: Buffer): Promise<ExtractedDocument> {
    // Convert to HTML rather than raw text so heading structure survives.
    const { value } = await mammoth.convertToHtml({ buffer: bytes });
    return { title: null, sections: sectionsFromHtml(value) };
  }

  private extractMarkdown(raw: string): ExtractedDocument {
    const lines = normalise(raw).split('\n');
    const sections: ExtractedSection[] = [];
    const headingStack: string[] = [];
    let buffer: string[] = [];
    let title: string | null = null;

    const flush = () => {
      const text = buffer.join('\n').trim();
      if (text) sections.push({ text, pageNumber: null, headingPath: [...headingStack] });
      buffer = [];
    };

    for (const line of lines) {
      const match = MARKDOWN_HEADING.exec(line);
      if (match?.[1] && match[2]) {
        flush();
        const depth = match[1].length;
        const heading = match[2].trim();
        if (depth === 1 && !title) title = heading;
        headingStack.length = Math.min(headingStack.length, depth - 1);
        headingStack[depth - 1] = heading;
        continue;
      }
      buffer.push(line);
    }
    flush();

    return { title, sections: sections.length > 0 ? sections : [fallbackSection(raw)] };
  }

  private extractPlainText(raw: string): ExtractedDocument {
    return { title: null, sections: [fallbackSection(raw)] };
  }

  private async extractUrl(rawUrl: string): Promise<ExtractedDocument> {
    const fetched = await safeFetch(rawUrl, {
      allowPrivate: this.config.ALLOW_PRIVATE_NETWORK_FETCH,
    });

    if (fetched.contentType === 'application/pdf') {
      return this.extractPdf(fetched.body);
    }
    if (!fetched.contentType.startsWith('text/')) {
      throw new InvariantViolationError(
        'source.unsupported_content_type',
        `that URL returned ${fetched.contentType}, which cannot be imported`,
      );
    }

    const html = fetched.body.toString('utf8');
    if (fetched.contentType === 'text/plain') {
      return { title: null, sections: [fallbackSection(html)] };
    }

    const $ = cheerio.load(html);
    const title = $('title').first().text().trim() || null;
    // Strip everything that is chrome rather than content — and, importantly,
    // every <script>, so page JavaScript never becomes "source text".
    $('script, style, noscript, nav, footer, header, aside, iframe, svg, form').remove();

    const root = $('article').first().length ? $('article').first() : $('body');
    const sections = sectionsFromHtml(root.html() ?? '');

    if (sections.length === 0) {
      throw new InvariantViolationError(
        'source.no_readable_content',
        'no readable content was found at that URL',
      );
    }
    return { title, sections };
  }
}

const normalise = (text: string): string =>
  stripControlChars(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const fallbackSection = (raw: string): ExtractedSection => ({
  text: normalise(raw),
  pageNumber: null,
  headingPath: [],
});

/** Walks block-level HTML, tracking heading depth to build a section outline. */
const sectionsFromHtml = (html: string): ExtractedSection[] => {
  const $ = cheerio.load(html);
  const sections: ExtractedSection[] = [];
  const headingStack: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const text = normalise(buffer.join('\n'));
    if (text) sections.push({ text, pageNumber: null, headingPath: [...headingStack] });
    buffer = [];
  };

  $('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td').each((_, element) => {
    const tag = (element as { tagName?: string }).tagName?.toLowerCase() ?? '';
    const text = $(element).text().trim();
    if (!text) return;

    const headingMatch = /^h([1-6])$/.exec(tag);
    if (headingMatch?.[1]) {
      flush();
      const depth = Number(headingMatch[1]);
      headingStack.length = Math.min(headingStack.length, depth - 1);
      headingStack[depth - 1] = text;
      return;
    }

    buffer.push(tag === 'li' ? `- ${text}` : text);
  });

  flush();
  return sections;
};
