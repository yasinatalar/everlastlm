import { beforeEach, describe, expect, it, vi } from 'vitest';

// An ES module namespace is frozen, so `vi.spyOn(undici, 'request')` cannot
// work; the module has to be replaced before it is imported.
const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));
vi.mock('undici', () => ({ request: mockRequest }));

import { assertPublicUrl, isPrivateAddress, safeFetch } from './safe-http';

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'RFC1918 class A'],
    ['172.16.0.1', 'RFC1918 class B lower bound'],
    ['172.31.255.254', 'RFC1918 class B upper bound'],
    ['192.168.1.1', 'RFC1918 class C'],
    ['169.254.169.254', 'cloud metadata endpoint'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['fd00::1', 'IPv6 unique-local'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
  ])('blocks %s (%s)', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['172.32.0.1'], // just outside RFC1918 class B
    ['172.15.255.255'],
    ['2606:4700::1111'],
  ])('allows public address %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it('treats a non-address as unsafe', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('assertPublicUrl', () => {
  it('rejects non-http schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd', false)).rejects.toMatchObject({
      code: 'url.scheme',
    });
    await expect(assertPublicUrl('gopher://example.com', false)).rejects.toMatchObject({
      code: 'url.scheme',
    });
  });

  it('rejects embedded credentials', async () => {
    await expect(
      assertPublicUrl('https://user:pass@example.com/doc', false),
    ).rejects.toMatchObject({ code: 'url.credentials' });
  });

  it('rejects a literal private address without touching DNS', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data', false)).rejects
      .toMatchObject({ code: 'url.private_address' });
  });

  it('rejects a bracketed IPv6 loopback', async () => {
    await expect(assertPublicUrl('http://[::1]:8080/admin', false)).rejects.toMatchObject({
      code: 'url.private_address',
    });
  });

  it('allows private addresses when explicitly configured for local dev', async () => {
    await expect(assertPublicUrl('http://127.0.0.1:3000/page', true)).resolves.toBeInstanceOf(
      URL,
    );
  });

  it('rejects malformed input', async () => {
    await expect(assertPublicUrl('http://', false)).rejects.toMatchObject({
      code: 'url.invalid',
    });
  });
});

describe('safeFetch error handling', () => {
  beforeEach(() => mockRequest.mockReset());

  /**
   * Regression: discarding an undici body with `destroy()` emits an `'error'`
   * event, and an unhandled `'error'` event terminates the Node process. A URL
   * source that 404s must produce a domain error, not take the API down.
   */
  it('rejects a 404 without emitting an unhandled stream error', async () => {
    const listeners = new Map<string, () => void>();

    mockRequest.mockResolvedValue({
      statusCode: 404,
      headers: {},
      body: {
        on: (event: string, listener: () => void) => listeners.set(event, listener),
        dump: async () => undefined,
      },
    });

    await expect(
      safeFetch('https://example.com/missing', { allowPrivate: true }),
    ).rejects.toMatchObject({ code: 'url.unreachable' });

    // An error listener must be attached before the body is discarded.
    expect(listeners.has('error')).toBe(true);
  });

  it('surfaces an over-large declared body as a domain error', async () => {
    mockRequest.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-length': String(999 * 1024 * 1024), 'content-type': 'text/html' },
      body: { on: () => undefined, dump: async () => undefined },
    });

    await expect(
      safeFetch('https://example.com/huge', { allowPrivate: true }),
    ).rejects.toMatchObject({ code: 'url.too_large' });
  });

  it('re-validates the target of every redirect hop', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      body: { on: () => undefined, dump: async () => undefined },
    });

    // A public URL that redirects into link-local space must be refused at the
    // hop, not followed.
    await expect(
      safeFetch('https://example.com/redirect', { allowPrivate: false }),
    ).rejects.toMatchObject({ code: 'url.private_address' });
  });
});
