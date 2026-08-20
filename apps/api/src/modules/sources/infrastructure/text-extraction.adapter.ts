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
    /**
     * pdf.js directly, rather than through `pdf-parse`.
     *
     * pdf-parse hard-depends on `@napi-rs/canvas` and loads it through a
     * require it builds at runtime from `document.baseURI`. Vercel's file
     * tracer cannot follow that, so the module is never bundled — the
     * deployed function warns `Cannot find module '@napi-rs/canvas'`, fails to
     * polyfill `DOMMatrix`, and every PDF then either fails outright or hangs
     * in extraction. Installing or declaring the package does not help,
     * because nothing statically references it.
     *
     * Canvas exists for *rendering*. Pulling text needs none of it, so going
     * straight to pdf.js removes the dependency rather than fighting the
     * bundler for it.
     *
     * Loaded lazily: pdf.js is a large bundle most requests never touch.
     */
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    let sections: ExtractedSection[];
    let title: string | null = null;
    let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']> | null = null;

    try {
      doc = await pdfjs.getDocument({
        // pdf.js transfers the buffer to its worker, detaching it from this
        // thread. A copy keeps the caller's Buffer usable afterwards.
        data: new Uint8Array(bytes),
        // No eval, no remote font fetches, no system font probing — this runs
        // on untrusted uploads in a serverless sandbox.
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: false,
      }).promise;

      const metadata = await doc.getMetadata().catch(() => null);
      const rawTitle = (metadata?.info as { Title?: unknown } | undefined)?.Title;
      if (typeof rawTitle === 'string' && rawTitle.trim()) title = rawTitle.trim();

      const pages: ExtractedSection[] = [];

      // Sequential, deliberately — NOT `Promise.all`. Page tasks share one
      // worker, and resolving thirty at once on a 1 GB function is how a large
      // report turns into an out-of-memory kill.
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          let text = '';
          for (const item of content.items) {
            if (!('str' in item)) continue;
            text += item.str;
            // pdf.js reports line ends per item; without this the whole page
            // collapses into one line and paragraph chunking has nothing to
            // split on.
            if (item.hasEOL) text += '\n';
          }
          const normalised = normalise(text);
          if (normalised.length > 0) {
            pages.push({ text: normalised, pageNumber, headingPath: [] });
          }
        } finally {
          page.cleanup();
        }
      }

      sections = pages;
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
      await doc?.destroy().catch(() => undefined);
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
