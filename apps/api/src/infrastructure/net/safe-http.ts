import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'undici';
import { InvariantViolationError } from '../../shared/kernel/domain-error';

/**
 * Server-side request forgery guard for the "import from URL" feature.
 *
 * An attacker who can make the API fetch a URL of their choosing can reach the
 * cloud metadata endpoint (169.254.169.254), internal admin panels, and the
 * Supabase instance itself. Blocking by hostname string is not enough: DNS can
 * resolve an innocuous name to a private address, and a public URL can redirect
 * to one. So the address is checked after resolution, and again after every
 * redirect hop.
 *
 * This still leaves a DNS-rebinding window between our check and undici's own
 * connect. Closing it fully needs a custom connector pinned to the verified IP;
 * that is the right next step if this ever fetches on behalf of untrusted
 * tenants at scale.
 */

const MAX_REDIRECTS = 3;
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

const BLOCKED_V4 = [
  { cidr: '0.0.0.0/8' },
  { cidr: '10.0.0.0/8' },
  { cidr: '100.64.0.0/10' }, // carrier-grade NAT
  { cidr: '127.0.0.0/8' },
  { cidr: '169.254.0.0/16' }, // link-local, incl. cloud metadata
  { cidr: '172.16.0.0/12' },
  { cidr: '192.0.0.0/24' },
  { cidr: '192.168.0.0/16' },
  { cidr: '198.18.0.0/15' },
  { cidr: '224.0.0.0/4' }, // multicast
  { cidr: '240.0.0.0/4' }, // reserved
];

const ipv4ToInt = (ip: string): number =>
  ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;

const inCidr = (ip: string, cidr: string): boolean => {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  if (!range) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
};

export const isPrivateAddress = (address: string): boolean => {
  const family = isIP(address);

  if (family === 4) return BLOCKED_V4.some((entry) => inCidr(address, entry.cidr));

  if (family === 6) {
    const normalised = address.toLowerCase();
    if (normalised === '::' || normalised === '::1') return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(normalised)) return true;
    if (/^fe[89ab]/.test(normalised)) return true;
    // IPv4-mapped (::ffff:a.b.c.d) inherits the v4 verdict.
    const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return false;
  }

  return true; // not an IP literal — treat as unsafe
};

export const assertPublicUrl = async (
  rawUrl: string,
  allowPrivate: boolean,
): Promise<URL> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvariantViolationError('url.invalid', 'not a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvariantViolationError('url.scheme', 'only http and https are supported');
  }
  // Credentials in a URL are a classic way to confuse downstream parsers.
  if (url.username || url.password) {
    throw new InvariantViolationError('url.credentials', 'URLs must not contain credentials');
  }
  if (allowPrivate) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => {
        throw new InvariantViolationError('url.unresolvable', 'host could not be resolved');
      });

  if (addresses.length === 0) {
    throw new InvariantViolationError('url.unresolvable', 'host could not be resolved');
  }
  // Every resolved address must be public — one private answer is enough for a
  // rebinding attack to succeed.
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new InvariantViolationError(
        'url.private_address',
        'that address is not reachable from Everlast',
      );
    }
  }

  return url;
};

export interface SafeFetchResult {
  url: string;
  contentType: string;
  body: Buffer;
}

/**
 * Throws away a response body we are not going to read.
 *
 * `body.destroy()` alone is not safe: undici emits an `'error'` event on the
 * aborted stream, and an `'error'` with no listener is a hard process exit. A
 * redirect or a 404 on an imported URL would take the whole API down with it.
 */
const discardBody = async (body: {
  on: (event: string, listener: () => void) => unknown;
  dump: () => Promise<void>;
}): Promise<void> => {
  body.on('error', () => undefined);
  try {
    await body.dump();
  } catch {
    // Already consumed or aborted — nothing left to release.
  }
};

export const safeFetch = async (
  rawUrl: string,
  options: { allowPrivate: boolean },
): Promise<SafeFetchResult> => {
  let current = await assertPublicUrl(rawUrl, options.allowPrivate);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // undici does not follow redirects unless a redirect interceptor is
    // installed, so each hop surfaces here and gets re-validated before we
    // follow it.
    const response = await request(current, {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'user-agent': 'EverlastBot/1.0 (+https://everlastlm.com/bot)',
        'accept-language': 'en,de;q=0.9',
      },
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
    });

    const status = response.statusCode;

    if (status >= 300 && status < 400) {
      const location = response.headers.location;
      const target = Array.isArray(location) ? location[0] : location;
      await discardBody(response.body);

      if (!target) {
        throw new InvariantViolationError('url.bad_redirect', 'redirect without a target');
      }
      current = await assertPublicUrl(new URL(target, current).toString(), options.allowPrivate);
      continue;
    }

    if (status >= 400) {
      await discardBody(response.body);
      throw new InvariantViolationError(
        'url.unreachable',
        `the page responded with status ${status}`,
      );
    }

    const declared = Number(response.headers['content-length'] ?? 0);
    if (declared > MAX_BYTES) {
      await discardBody(response.body);
      throw new InvariantViolationError('url.too_large', 'that page is too large to import');
    }

    // Stream with a hard ceiling — Content-Length can lie or be absent.
    response.body.on('error', () => undefined);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_BYTES) {
        await discardBody(response.body);
        throw new InvariantViolationError('url.too_large', 'that page is too large to import');
      }
      chunks.push(buffer);
    }

    const contentTypeHeader = response.headers['content-type'];
    const contentType = (
      Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
    )?.split(';')[0]?.trim();

    return {
      url: current.toString(),
      contentType: contentType ?? 'application/octet-stream',
      body: Buffer.concat(chunks),
    };
  }

  throw new InvariantViolationError('url.too_many_redirects', 'too many redirects');
};
