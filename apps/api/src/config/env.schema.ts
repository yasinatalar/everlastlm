import { z } from 'zod';

/**
 * The process refuses to boot with an invalid environment. Failing at startup
 * beats discovering a missing key when the first user uploads a document, and
 * it means every downstream consumer can treat config as non-nullable.
 */
const csv = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Treats an empty value as absent.
 *
 * `.env` files and hosting dashboards both represent "not set" as an empty
 * string rather than by omitting the key, so `FOO=` reaches us as `''`. Without
 * this, an optional-but-constrained variable left blank fails validation and
 * the process refuses to boot complaining about a variable the operator
 * deliberately left empty.
 */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Comma-separated origin allowlist for CORS. No wildcards, ever. */
  WEB_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform(csv)
    .pipe(z.array(z.url()).min(1)),

  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  /**
   * Legacy HS256 projects sign with a shared secret. Newer projects sign
   * asymmetrically and publish a JWKS; leave this unset for those and the
   * verifier discovers the key set from SUPABASE_URL.
   */
  SUPABASE_JWT_SECRET: optional(z.string().min(20)),

  ANTHROPIC_API_KEY: z.string().min(10),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  /** Cheaper model for mechanical work (titles, per-source summaries). */
  ANTHROPIC_UTILITY_MODEL: z.string().default('claude-haiku-4-5'),

  VOYAGE_API_KEY: z.string().min(10),
  VOYAGE_MODEL: z.string().default('voyage-4'),
  VOYAGE_DIMENSIONS: z.coerce.number().int().default(1024),
  /**
   * Voyage models are served from two hosts with the same API but different
   * keys: voyageai.com issues `pa-` keys, and MongoDB Atlas (which owns Voyage)
   * issues `al-` keys for the same models. Leave unset and the adapter picks
   * the host from the key prefix, matching the official client. Set it only to
   * override that — a proxy, or a new prefix we do not recognise yet.
   */
  VOYAGE_BASE_URL: optional(z.url()),

  /** Audio overviews need a TTS vendor; `none` renders script-only. */
  TTS_PROVIDER: z.enum(['none', 'elevenlabs']).default('none'),
  ELEVENLABS_API_KEY: optional(z.string()),
  ELEVENLABS_VOICE_HOST_A: z.string().default('21m00Tcm4TlvDq8ikWAM'),
  ELEVENLABS_VOICE_HOST_B: z.string().default('AZnzlk1XvdvUeBnXmlld'),

  RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_LIMIT: z.coerce.number().int().min(1).default(120),
  /** Generation endpoints are far more expensive; throttled separately. */
  RATE_LIMIT_AI_LIMIT: z.coerce.number().int().min(1).default(20),

  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).default(50 * 1024 * 1024),
  /** Guards the URL importer against SSRF into private address space. */
  ALLOW_PRIVATE_NETWORK_FETCH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export const parseEnv = (raw: NodeJS.ProcessEnv): Env => {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  if (result.data.TTS_PROVIDER === 'elevenlabs' && !result.data.ELEVENLABS_API_KEY) {
    throw new Error(
      'Invalid environment configuration:\n  - ELEVENLABS_API_KEY is required when TTS_PROVIDER=elevenlabs',
    );
  }

  return result.data;
};
