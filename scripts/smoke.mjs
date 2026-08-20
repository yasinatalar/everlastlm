/**
 * End-to-end smoke test against the running API + local Supabase.
 * Verifies auth, tenant isolation via RLS, role enforcement and the SSRF guard.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Keys are read from the environment, falling back to `apps/api/.env` — which
 * is gitignored. Nothing that looks like a credential is hardcoded here: even
 * though a local Supabase stack ships the same well-known demo keys for
 * everyone, a `service_role` key committed to a repository trips secret
 * scanners and teaches the wrong habit.
 */
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/api/.env');

const fromEnvFile = (() => {
  try {
    return Object.fromEntries(
      readFileSync(envFile, 'utf8')
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
})();

const need = (key) => {
  const value = process.env[key] ?? fromEnvFile[key];
  if (!value) {
    console.error(
      `Missing ${key}. Run \`pnpm db:start\` and fill apps/api/.env, or export it.`,
    );
    process.exit(1);
  }
  return value;
};

const SUPABASE = process.env.SUPABASE_URL ?? fromEnvFile.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const API = `${process.env.API_URL ?? 'http://localhost:3001'}/api`;
const ANON = need('SUPABASE_ANON_KEY');
const SERVICE = need('SUPABASE_SERVICE_ROLE_KEY');

let passed = 0;
let failed = 0;

const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

const createUser = async (email) => {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple', email_confirm: true }),
  });
  if (!res.ok) throw new Error(`createUser ${email}: ${res.status} ${await res.text()}`);
  return res.json();
};

const signIn = async (email) => {
  const res = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
  });
  if (!res.ok) throw new Error(`signIn ${email}: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
};

const api = async (token, path, options = {}) => {
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json, raw: text };
};

const stamp = Date.now();
const emailA = `alice.${stamp}@example.com`;
const emailB = `bob.${stamp}@example.com`;

console.log('\n== setup ==');
await createUser(emailA);
await createUser(emailB);
const tokenA = await signIn(emailA);
const tokenB = await signIn(emailB);
console.log('  two users created and signed in');

console.log('\n== authentication ==');
check('rejects a request with no token', (await api(null, '/notebooks')).status === 401);
check('rejects a malformed token', (await api('not.a.jwt', '/notebooks')).status === 401);
check(
  'rejects a token signed with the wrong key',
  (await api('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0.wrongsignature', '/notebooks')).status === 401,
);
check('accepts a valid token', (await api(tokenA, '/notebooks')).status === 200);

console.log('\n== profile ==');
const me = await api(tokenA, '/me');
check('profile row was auto-created by the auth trigger', me.status === 200 && me.body?.email === emailA, JSON.stringify(me.body));

console.log('\n== notebooks ==');
const created = await api(tokenA, '/notebooks', {
  method: 'POST',
  body: { title: 'Alice research', description: 'Private notebook' },
});
check('creates a notebook', created.status === 201, JSON.stringify(created.body));
const notebookId = created.body?.id;
check('creator is owner', created.body?.role === 'owner');

const listA = await api(tokenA, '/notebooks');
check('owner sees it in their list', listA.body?.items?.some((n) => n.id === notebookId));

console.log('\n== tenant isolation (RLS) ==');
const listB = await api(tokenB, '/notebooks');
check('other user does not see it in their list', !listB.body?.items?.some((n) => n.id === notebookId));

const directB = await api(tokenB, `/notebooks/${notebookId}`);
check('other user gets 404 (not 403) on direct access', directB.status === 404, `got ${directB.status}`);

const sourcesB = await api(tokenB, `/notebooks/${notebookId}/sources`);
check('other user cannot list its sources', sourcesB.status === 404, `got ${sourcesB.status}`);

const chatB = await api(tokenB, `/notebooks/${notebookId}/chat/conversations`);
check('other user cannot list its conversations', chatB.status === 404, `got ${chatB.status}`);

console.log('\n== validation ==');
check(
  'rejects a non-uuid notebook id',
  (await api(tokenA, '/notebooks/not-a-uuid')).status === 400,
);
check(
  'rejects an empty title',
  (await api(tokenA, '/notebooks', { method: 'POST', body: { title: '' } })).status === 400,
);
const massAssign = await api(tokenA, '/notebooks', {
  method: 'POST',
  body: { title: 'Mass assignment', ownerId: '00000000-0000-0000-0000-000000000000', role: 'owner' },
});
check(
  'strips unknown fields instead of trusting them',
  massAssign.status === 201 && massAssign.body?.ownerId !== '00000000-0000-0000-0000-000000000000',
);

console.log('\n== SSRF guard ==');
for (const [label, url] of [
  ['cloud metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
  ['loopback', 'http://127.0.0.1:54321/rest/v1/notebooks'],
  ['private range', 'http://10.0.0.1/internal'],
  ['file scheme', 'file:///etc/passwd'],
]) {
  const res = await api(tokenA, `/notebooks/${notebookId}/sources/url`, {
    method: 'POST',
    body: { url },
  });
  check(`blocks ${label}`, res.status === 400, `got ${res.status} ${res.raw?.slice(0, 120)}`);
}

console.log('\n== sources ==');
const textSource = await api(tokenA, `/notebooks/${notebookId}/sources/text`, {
  method: 'POST',
  body: { title: 'Field notes', content: 'The badger population rose by twelve percent in 2024.\n\nHabitat loss remains the primary risk.' },
});
check('adds a pasted-text source', textSource.status === 201, JSON.stringify(textSource.body));

const dup = await api(tokenA, `/notebooks/${notebookId}/sources/text`, {
  method: 'POST',
  body: { title: 'Field notes again', content: 'The badger population rose by twelve percent in 2024.\n\nHabitat loss remains the primary risk.' },
});
check('rejects a duplicate by checksum', dup.status === 409, `got ${dup.status}`);

console.log('\n== sharing and roles ==');
const invite = await api(tokenA, `/notebooks/${notebookId}/members`, {
  method: 'POST',
  body: { email: emailB, role: 'viewer' },
});
check('owner can invite as viewer', invite.status === 201, JSON.stringify(invite.body));

const listB2 = await api(tokenB, '/notebooks');
check('invitee now sees the notebook', listB2.body?.items?.some((n) => n.id === notebookId));

const viewerRead = await api(tokenB, `/notebooks/${notebookId}/sources`);
check('viewer can read sources', viewerRead.status === 200, `got ${viewerRead.status}`);

const viewerWrite = await api(tokenB, `/notebooks/${notebookId}/sources/text`, {
  method: 'POST',
  body: { title: 'Sneaky', content: 'viewer should not be able to write this' },
});
check('viewer cannot add a source', viewerWrite.status === 403, `got ${viewerWrite.status}`);

const viewerDelete = await api(tokenB, `/notebooks/${notebookId}`, { method: 'DELETE' });
check('viewer cannot delete the notebook', viewerDelete.status === 403, `got ${viewerDelete.status}`);

const viewerInvite = await api(tokenB, `/notebooks/${notebookId}/members`, {
  method: 'POST',
  body: { email: 'someone@example.com', role: 'editor' },
});
check('viewer cannot invite others', viewerInvite.status === 403, `got ${viewerInvite.status}`);

const promote = await api(tokenA, `/notebooks/${notebookId}/members/${(await api(tokenA, `/notebooks/${notebookId}/members`)).body.find((m) => m.email === emailB).userId}`, {
  method: 'PATCH',
  body: { role: 'editor' },
});
check('owner can promote a viewer to editor', promote.status === 204, `got ${promote.status}`);

const editorWrite = await api(tokenB, `/notebooks/${notebookId}/sources/text`, {
  method: 'POST',
  body: { title: 'Editor note', content: 'Now the write should succeed because the role changed.' },
});
check('promoted editor can add a source', editorWrite.status === 201, `got ${editorWrite.status}`);

console.log('\n== ingestion pipeline ==');
// The Voyage key is a placeholder, so embedding must fail *gracefully* — the
// source should reach a terminal `failed` state rather than hang in `pending`.
/**
 * Polls rather than sleeping a fixed interval: embedding requests are paced to
 * VOYAGE_MAX_RPM (3 by default, i.e. one every 20s), so a fixed short wait
 * reports "stuck" for a pipeline that is merely being polite to a rate limit.
 */
let after = await api(tokenA, `/notebooks/${notebookId}/sources`);
for (let attempt = 0; attempt < 30; attempt += 1) {
  const pending = (after.body ?? []).filter(
    (s) => s.status !== 'ready' && s.status !== 'failed',
  );
  if (pending.length === 0) break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
  after = await api(tokenA, `/notebooks/${notebookId}/sources`);
}
const statuses = (after.body ?? []).map((s) => s.status);
check(
  'ingestion reaches a terminal state (no stuck sources)',
  statuses.length > 0 && statuses.every((s) => s === 'ready' || s === 'failed'),
  `statuses: ${statuses.join(', ')}`,
);
/**
 * Checks for actual leakage, not for keywords. "an administrator needs to add a
 * valid API key" is the correct message for a rejected credential — what must
 * never appear is the vendor, the transport detail, or any part of the secret.
 */
const LEAKS = /voyage|anthropic|elevenlabs|supabase|sk-ant|\bpa-|\b[45]\d{2}\b|https?:\/\//i;

check(
  'failure reason names no vendor, status code or credential',
  (after.body ?? []).every((s) => !s.failureReason || !LEAKS.test(s.failureReason)),
  JSON.stringify((after.body ?? []).map((s) => s.failureReason)),
);

console.log('\n== notes ==');
const note = await api(tokenA, `/notebooks/${notebookId}/notes`, {
  method: 'POST',
  body: { content: '# Heading\nSome note body', origin: 'manual', citations: [] },
});
check('creates a note and derives its title', note.status === 201 && note.body?.title === 'Heading', JSON.stringify(note.body));

console.log('\n== cleanup / ownership invariants ==');
const ownerId = (await api(tokenA, `/notebooks/${notebookId}/members`)).body.find((m) => m.role === 'owner').userId;
const removeOwner = await api(tokenA, `/notebooks/${notebookId}/members/${ownerId}`, { method: 'DELETE' });
check('the last owner cannot be removed', removeOwner.status === 400, `got ${removeOwner.status}`);

const del = await api(tokenA, `/notebooks/${notebookId}`, { method: 'DELETE' });
check('owner can archive the notebook', del.status === 204, `got ${del.status}`);
const afterDelete = await api(tokenA, `/notebooks/${notebookId}`);
check('archived notebook is no longer readable', afterDelete.status === 404, `got ${afterDelete.status}`);

/**
 * The auth callback is a Route Handler outside the `[locale]` segment, so it
 * exists at exactly one path. If it ever gets pulled back into next-intl's
 * matcher, a German-locale browser is redirected to `/de/auth/callback`, which
 * does not exist, and every signup confirmation link 404s. Checked here because
 * it spans the proxy and the routing config, which no unit test sees.
 */
console.log('\n== web: auth callback routing ==');
const WEB = 'http://localhost:3000';
try {
  const res = await fetch(`${WEB}/auth/callback?code=smoke-test-bogus`, {
    headers: { 'Accept-Language': 'de-DE,de;q=0.9' },
    redirect: 'manual',
  });
  const location = res.headers.get('location') ?? '';

  check(
    'callback is not locale-redirected',
    !/\/(en|de)\/auth\/callback/.test(location),
    `location: ${location}`,
  );
  check(
    'callback reaches the handler and rejects a bad code',
    location.includes('/login') && location.includes('error='),
    `location: ${location}`,
  );
} catch {
  console.log('  SKIP  web server not running on :3000');
}

console.log(`\n${'='.repeat(46)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(46));
process.exit(failed > 0 ? 1 : 0);
