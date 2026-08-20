/**
 * Validates the configured AI provider credentials before you rely on them.
 *
 * Without this, a bad or missing key is only discovered when a user uploads a
 * document: ingestion runs, fails at the embedding step, and reports a generic
 * failure on the source. This asks each provider directly and says exactly
 * what is wrong and where to fix it.
 *
 * Never prints a key — only its prefix and length.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/api/.env');

const fromFile = (() => {
  try {
    return Object.fromEntries(
      readFileSync(envFile, 'utf8')
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .map((line) => {
          const i = line.indexOf('=');
          return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
})();

const get = (key) => process.env[key] || fromFile[key] || '';

const mask = (value) =>
  value ? `${value.slice(0, 3)}…${value.slice(-4)} (${value.length} chars)` : '(not set)';

const looksLikePlaceholder = (value) =>
  !value || /placeholder|not-a-real|changeme|your[-_]?key|xxx/i.test(value);

const results = [];
const report = (name, ok, detail, fix) => results.push({ name, ok, detail, fix });

// ---------------------------------------------------------------------------
// Voyage / Atlas embeddings
// ---------------------------------------------------------------------------
const voyageKey = get('VOYAGE_API_KEY');
const voyageModel = get('VOYAGE_MODEL') || 'voyage-4';
const override = get('VOYAGE_BASE_URL');

// Same rule as the adapter: MongoDB owns Voyage and issues `al-` keys for the
// same models on a different host.
const voyageBase =
  override?.replace(/\/+$/, '') ||
  (voyageKey.startsWith('al-') ? 'https://ai.mongodb.com/v1' : 'https://api.voyageai.com/v1');

if (looksLikePlaceholder(voyageKey)) {
  report(
    'Voyage embeddings',
    false,
    `key is a placeholder: ${mask(voyageKey)}`,
    'Put a real key in apps/api/.env as VOYAGE_API_KEY=…\n' +
      '     al-… from MongoDB Atlas → AI Model APIs → Model API Keys\n' +
      '     pa-… from voyageai.com → API Keys',
  );
} else {
  try {
    const res = await fetch(`${voyageBase}/embeddings`, {
      method: 'POST',
      headers: { authorization: `Bearer ${voyageKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: voyageModel, input: ['ping'], input_type: 'document' }),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.ok) {
      const json = await res.json();
      const width = json?.data?.[0]?.embedding?.length ?? 0;
      const expected = Number(get('VOYAGE_DIMENSIONS') || 1024);

      report(
        'Voyage embeddings',
        width === expected,
        `${mask(voyageKey)} → ${voyageBase} · model ${voyageModel} · ${width} dimensions`,
        width === expected
          ? null
          : `The migration stores vector(${expected}) but this model returned ${width}.\n` +
            `     Set VOYAGE_DIMENSIONS=${width} and update the vector width in\n` +
            '     supabase/migrations/20260101000100_core_schema.sql, or pick another model.',
      );
    } else if (res.status === 401 || res.status === 403) {
      const otherHost = voyageBase.includes('mongodb')
        ? 'https://api.voyageai.com/v1'
        : 'https://ai.mongodb.com/v1';
      report(
        'Voyage embeddings',
        false,
        `${mask(voyageKey)} → ${voyageBase} rejected it (HTTP ${res.status})`,
        `Check the key matches the host. A key from MongoDB Atlas starts with al-\n` +
          `     and must go to ai.mongodb.com; one from voyageai.com starts with pa-.\n` +
          `     To force the other host: VOYAGE_BASE_URL=${otherHost}`,
      );
    } else {
      report(
        'Voyage embeddings',
        false,
        `${voyageBase} responded HTTP ${res.status}`,
        `Body: ${(await res.text()).slice(0, 200)}`,
      );
    }
  } catch (error) {
    report('Voyage embeddings', false, `could not reach ${voyageBase}`, String(error));
  }
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------
const anthropicKey = get('ANTHROPIC_API_KEY');
const anthropicModel = get('ANTHROPIC_MODEL') || 'claude-opus-5';

if (looksLikePlaceholder(anthropicKey)) {
  report(
    'Anthropic (chat, studio)',
    false,
    `key is a placeholder: ${mask(anthropicKey)}`,
    'Put a real key in apps/api/.env as ANTHROPIC_API_KEY=…\n' +
      '     from console.anthropic.com → API keys',
  );
} else {
  try {
    // Listing models validates the key without spending any tokens.
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(30_000),
    });

    if (res.ok) {
      const check = await fetch(
        `https://api.anthropic.com/v1/models/${encodeURIComponent(anthropicModel)}`,
        {
          headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(30_000),
        },
      );
      report(
        'Anthropic (chat, studio)',
        check.ok,
        `${mask(anthropicKey)} · model ${anthropicModel} ${check.ok ? 'available' : 'NOT available'}`,
        check.ok
          ? null
          : `This key cannot use ${anthropicModel}. Set ANTHROPIC_MODEL to one your\n` +
            '     account has access to.',
      );
    } else {
      report(
        'Anthropic (chat, studio)',
        false,
        `rejected the key (HTTP ${res.status})`,
        'Check ANTHROPIC_API_KEY at console.anthropic.com → API keys',
      );
    }
  } catch (error) {
    report('Anthropic (chat, studio)', false, 'could not reach api.anthropic.com', String(error));
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
console.log(`\nReading ${envFile}\n`);

for (const { name, ok, detail, fix } of results) {
  console.log(`${ok ? '  OK  ' : '  FAIL'}  ${name}`);
  console.log(`        ${detail}`);
  if (fix) console.log(`   fix: ${fix}`);
  console.log();
}

const failed = results.filter((r) => !r.ok).length;
console.log(
  failed === 0
    ? 'All providers reachable. Restart the API so it picks up the configuration.\n'
    : `${failed} of ${results.length} providers need attention.\n`,
);

process.exit(failed > 0 ? 1 : 0);
