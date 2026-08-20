import { describe, expect, it } from 'vitest';
import type { Env } from '../../../config/env.schema';
import { TextExtractionAdapter } from './text-extraction.adapter';

/**
 * Builds a small but genuinely valid PDF, with correct xref offsets, so the
 * test exercises real pdf.js parsing rather than a fixture that happens to be
 * checked in. Keeping the generator here means the test has no binary asset and
 * still fails if extraction regresses.
 */
const buildPdf = (line: string): Buffer => {
  const content = `BT /F1 24 Tf 72 700 Td (${line}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
};

const adapter = new TextExtractionAdapter({
  ALLOW_PRIVATE_NETWORK_FETCH: false,
} as Env);

describe('TextExtractionAdapter — PDF', () => {
  /**
   * Regression: `getInfo()` and `getText()` were called with `Promise.all`.
   * pdf.js transfers the source buffer to its worker, so the second concurrent
   * call found it detached and threw `DOMException: Cannot transfer object of
   * unsupported type` — for every PDF, which the adapter then reported as
   * "encrypted or image-only".
   */
  it('extracts text from a valid PDF', async () => {
    const document = await adapter.extract({
      kind: 'pdf',
      bytes: buildPdf('The badger population rose by twelve percent in 2024.'),
    });

    expect(document.sections).toHaveLength(1);
    expect(document.sections[0]?.text).toContain('badger population');
    expect(document.sections[0]?.pageNumber).toBe(1);
  });

  it('reports a damaged PDF as unreadable rather than crashing', async () => {
    await expect(
      adapter.extract({ kind: 'pdf', bytes: Buffer.from('%PDF-1.4\nnot really a pdf') }),
    ).rejects.toMatchObject({ code: 'source.unreadable_pdf' });
  });

  it('rejects an empty upload before touching the parser', async () => {
    await expect(
      adapter.extract({ kind: 'pdf', bytes: Buffer.alloc(0) }),
    ).rejects.toMatchObject({ code: 'source.empty' });
  });

  /**
   * Regression: pdf.js polyfills `DOMMatrix` from the optional `@napi-rs/canvas`
   * and, when that is missing, warns and then evaluates `new DOMMatrix()` at
   * module scope anyway. The import threw `ReferenceError` before any PDF was
   * touched, which reached the user as the generic "could not be processed".
   *
   * The package resolves from pnpm's store locally and is absent from the
   * deployed bundle, so this asserts on the globals rather than the parse: they
   * are what stands between a laptop that works and a deployment that does not.
   */
  it('defines the browser globals pdf.js needs to evaluate without canvas', async () => {
    await adapter.extract({ kind: 'pdf', bytes: buildPdf('Anything at all.') });

    expect(typeof (globalThis as Record<string, unknown>).DOMMatrix).toBe('function');
    expect(typeof (globalThis as Record<string, unknown>).ImageData).toBe('function');
    expect(typeof (globalThis as Record<string, unknown>).Path2D).toBe('function');
  });
});

describe('TextExtractionAdapter — text and markdown', () => {
  it('keeps the heading path as an outline', async () => {
    const document = await adapter.extract({
      kind: 'markdown',
      rawText: '# Title\n\nIntro paragraph.\n\n## Methods\n\nWe counted badgers.',
    });

    const methods = document.sections.find((section) => section.text.includes('counted'));
    expect(document.title).toBe('Title');
    expect(methods?.headingPath).toEqual(['Title', 'Methods']);
  });

  it('rejects whitespace-only text', async () => {
    await expect(
      adapter.extract({ kind: 'text', rawText: '   \n\n  ' }),
    ).rejects.toMatchObject({ code: 'source.empty' });
  });
});
