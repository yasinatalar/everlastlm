import { describe, expect, it } from 'vitest';
import type { ExtractedSection } from '../domain/text-extraction.port';
import { chunkDocument, estimateTokens } from './text-chunker';

const section = (text: string, overrides: Partial<ExtractedSection> = {}): ExtractedSection => ({
  text,
  pageNumber: null,
  headingPath: [],
  ...overrides,
});

const paragraph = (marker: string, words = 60): string =>
  `${marker} ${Array.from({ length: words }, (_, i) => `word${i}`).join(' ')}.`;

describe('chunkDocument', () => {
  it('returns nothing for empty input', () => {
    expect(chunkDocument([])).toEqual([]);
    expect(chunkDocument([section('   ')])).toEqual([]);
  });

  it('keeps a short document as a single chunk', () => {
    const chunks = chunkDocument([section('A short note about badgers.')]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain('badgers');
    expect(chunks[0]?.chunkIndex).toBe(0);
  });

  it('prefixes the heading path so the embedding carries document context', () => {
    const chunks = chunkDocument([
      section('Revenue fell four percent.', { headingPath: ['Q3 2024', 'Risks'] }),
    ]);

    expect(chunks[0]?.content).toBe('Q3 2024 › Risks\n\nRevenue fell four percent.');
    expect(chunks[0]?.headingPath).toEqual(['Q3 2024', 'Risks']);
  });

  it('splits a long document into several chunks with sequential indices', () => {
    const body = Array.from({ length: 30 }, (_, i) => paragraph(`P${i}`)).join('\n\n');
    const chunks = chunkDocument([section(body)]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      chunks.map((_, index) => index),
    );
  });

  it('overlaps consecutive chunks so facts spanning a boundary survive', () => {
    const body = Array.from({ length: 30 }, (_, i) => paragraph(`MARKER${i}`)).join('\n\n');
    const chunks = chunkDocument([section(body)]);

    const [first, second] = chunks;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    // The tail of chunk N must reappear at the head of chunk N+1.
    const firstMarkers = [...first!.content.matchAll(/MARKER(\d+)/g)].map((m) => m[1]);
    const secondMarkers = [...second!.content.matchAll(/MARKER(\d+)/g)].map((m) => m[1]);
    const shared = firstMarkers.filter((marker) => secondMarkers.includes(marker));

    expect(shared.length).toBeGreaterThan(0);
  });

  it('respects the target size', () => {
    const body = Array.from({ length: 40 }, (_, i) => paragraph(`P${i}`)).join('\n\n');
    const chunks = chunkDocument([section(body)], { targetTokens: 300, overlapTokens: 50 });

    // Allow headroom for the heading prefix and the final paragraph that tips
    // the buffer over the target.
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThan(600);
    }
  });

  it('splits an oversized single paragraph on sentence boundaries', () => {
    const monolith = Array.from({ length: 200 }, (_, i) => `Sentence number ${i}.`).join(' ');
    const chunks = chunkDocument([section(monolith)], { targetTokens: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('carries the page number through for PDF sections', () => {
    const chunks = chunkDocument([
      section('Page one content.', { pageNumber: 1 }),
      section('Page two content.', { pageNumber: 2 }),
    ]);

    expect(chunks.map((chunk) => chunk.pageNumber)).toEqual([1, 2]);
  });

  it('merges a trailing fragment into the previous chunk', () => {
    const body = `${Array.from({ length: 20 }, (_, i) => paragraph(`P${i}`)).join('\n\n')}\n\nok.`;
    const chunks = chunkDocument([section(body)]);

    expect(chunks.at(-1)?.content).toContain('ok.');
  });
});

describe('estimateTokens', () => {
  it('scales with length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
