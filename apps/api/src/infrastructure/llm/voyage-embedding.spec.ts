import { describe, expect, it } from 'vitest';
import { resolveVoyageBaseUrl } from './voyage-embedding.adapter';

/**
 * Voyage models are reachable from two hosts with identical request shapes,
 * and each rejects the other's credential with a bare 401 — which is
 * indistinguishable from an expired key unless you already know the two hosts
 * exist. Routing by key prefix is what keeps that from happening.
 */
describe('resolveVoyageBaseUrl', () => {
  it('routes an Atlas model API key to ai.mongodb.com', () => {
    expect(resolveVoyageBaseUrl('al-abc123def456')).toBe('https://ai.mongodb.com/v1');
  });

  it('routes a Voyage platform key to api.voyageai.com', () => {
    expect(resolveVoyageBaseUrl('pa-abc123def456')).toBe('https://api.voyageai.com/v1');
  });

  it('defaults an unrecognised prefix to the Voyage platform', () => {
    expect(resolveVoyageBaseUrl('something-else')).toBe('https://api.voyageai.com/v1');
  });

  it('lets an explicit override win over the prefix', () => {
    expect(resolveVoyageBaseUrl('al-abc123', 'https://proxy.internal/v1')).toBe(
      'https://proxy.internal/v1',
    );
  });

  it('strips a trailing slash so the path is not doubled', () => {
    expect(resolveVoyageBaseUrl('pa-abc123', 'https://proxy.internal/v1///')).toBe(
      'https://proxy.internal/v1',
    );
  });
});
