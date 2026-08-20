import { z } from 'zod';

/**
 * Primitive building blocks shared by every bounded context.
 *
 * These schemas are the contract between the Next.js client and the NestJS API.
 * The API validates *inbound* payloads with them; the client uses the inferred
 * types. Keeping them in one package means a breaking change to a payload is a
 * compile error on both sides rather than a runtime surprise.
 */

export const uuidSchema = z.uuid({ message: 'must be a UUID' });

export const localeSchema = z.enum(['en', 'de']);
export type Locale = z.infer<typeof localeSchema>;

export const themeSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof themeSchema>;

export const SUPPORTED_LOCALES = ['en', 'de'] as const satisfies readonly Locale[];
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * C0/C1 control characters except tab, LF and CR, plus the Unicode bidi and
 * zero-width format overrides. Those invisibles can hide instructions from a
 * human reviewer while remaining fully visible to the model, so they are
 * stripped from every free-text field before it is stored or prompted with.
 */
export const CONTROL_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F' +
    '\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g',
);

export const stripControlChars = (value: string): string => value.replace(CONTROL_CHARS, '');

export const safeText = (max: number) =>
  z
    .string()
    .transform(stripControlChars)
    .pipe(z.string().trim().min(1).max(max));

export const optionalSafeText = (max: number) =>
  z
    .string()
    .transform(stripControlChars)
    .pipe(z.string().trim().max(max))
    .optional();

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Shape of every error body the API returns. */
export const apiErrorSchema = z.object({
  statusCode: z.number(),
  /** Stable machine-readable identifier, e.g. `notebook.not_found`. */
  code: z.string(),
  /** Human readable fallback; clients prefer to localise from `code`. */
  message: z.string(),
  requestId: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
