import { describe, expect, it } from 'vitest';
import { extractBearerToken } from './supabase-auth.guard';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';

describe('extractBearerToken', () => {
  it('extracts a well-formed bearer token', () => {
    expect(extractBearerToken(`Bearer ${JWT}`)).toBe(JWT);
  });

  it('accepts any capitalisation of the scheme', () => {
    expect(extractBearerToken(`bearer ${JWT}`)).toBe(JWT);
    expect(extractBearerToken(`BEARER ${JWT}`)).toBe(JWT);
  });

  it.each([
    [undefined, 'missing header'],
    ['', 'empty header'],
    [JWT, 'no scheme'],
    [`Basic ${JWT}`, 'wrong scheme'],
    ['Bearer', 'no token'],
    ['Bearer   ', 'blank token'],
    ['Bearer not-a-jwt', 'not three segments'],
    ['Bearer a.b', 'two segments'],
    ['Bearer a.b.c.d', 'four segments'],
    [`Bearer ${JWT} extra`, 'trailing junk'],
  ])('rejects %s (%s)', (header: string | undefined, _reason: string) => {
    expect(extractBearerToken(header)).toBeNull();
  });
});
