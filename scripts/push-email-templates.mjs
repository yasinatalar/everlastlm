/**
 * Uploads the auth email templates to a hosted Supabase project.
 *
 * `content_path` in config.toml is read by the local CLI and by nothing else —
 * a deployed project has never seen this repository, so the templates have to
 * be sent to it. The dashboard's Authentication → Emails screen is the manual
 * way; this is the same thing over the Management API, so it is repeatable and
 * cannot be half-done.
 *
 * **Why not `supabase config push`.** That command exists and would also work,
 * but it applies the *whole* `[auth]` block, and ours is written for local
 * development — `site_url = "http://localhost:3000"` and localhost redirect
 * URLs. Pushing it at production would point every confirmation link on the
 * live site at the developer's laptop. This script sends twelve fields and
 * touches nothing else.
 *
 *   export SUPABASE_ACCESS_TOKEN=sbp_...     # supabase.com/dashboard/account/tokens
 *   pnpm email:push --ref <project-ref>      # shows a diff, changes nothing
 *   pnpm email:push --ref <project-ref> --yes
 *
 * The token is a personal access token with full control of every project on
 * the account. Keep it out of the repository and out of shell history — prefer
 * a password manager or `read -s`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

const ref = arg('--ref') ?? process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const apply = process.argv.includes('--yes');

/** Say which thing is missing, not just that something is. */
if (!token) {
  console.error(
    'SUPABASE_ACCESS_TOKEN is not set.\n' +
      'Create one at https://supabase.com/dashboard/account/tokens, then:\n' +
      '  export SUPABASE_ACCESS_TOKEN=sbp_...',
  );
  process.exit(1);
}
if (!ref) {
  console.error(
    'No project ref.\n' +
      'Pass --ref <ref>, or set SUPABASE_PROJECT_REF. The ref is in the\n' +
      'dashboard URL: supabase.com/dashboard/project/<ref>',
  );
  process.exit(1);
}
if (!/^[a-z]{20}$/.test(ref)) {
  console.error(`"${ref}" does not look like a project ref (20 lowercase letters).`);
  process.exit(1);
}

/**
 * config.toml is the source of truth for subjects and for which file backs
 * which template — `pnpm email:build` already fails if it has drifted from the
 * generator, so there is no third place to keep in step.
 */
const toml = readFileSync(join(repo, 'supabase/config.toml'), 'utf8');
const templates = [...toml.matchAll(/\[auth\.email\.template\.(\w+)\]([^[]*)/g)].map(
  ([, key, section]) => ({
    key,
    subject: section.match(/subject\s*=\s*"([^"]*)"/)?.[1],
    path: section.match(/content_path\s*=\s*"([^"]*)"/)?.[1],
  }),
);

if (!templates.length) {
  console.error('config.toml declares no [auth.email.template.*] sections.');
  process.exit(1);
}

/**
 * The API field names happen to be derivable from the template key for all six
 * (`mailer_subjects_recovery`, `mailer_templates_recovery_content`, …). That is
 * a convenience, not a guarantee, so anything unrecognised stops the run rather
 * than being sent under a guessed name.
 */
const KNOWN = new Set([
  'confirmation',
  'invite',
  'magic_link',
  'recovery',
  'email_change',
  'reauthentication',
]);

const payload = {};
for (const { key, subject, path } of templates) {
  if (!KNOWN.has(key)) {
    console.error(`Unknown template key "${key}" — refusing to guess its API field.`);
    process.exit(1);
  }
  if (!subject || !path) {
    console.error(`[auth.email.template.${key}] is missing a subject or content_path.`);
    process.exit(1);
  }
  payload[`mailer_subjects_${key}`] = subject;
  payload[`mailer_templates_${key}_content`] = readFileSync(
    join(repo, path.replace(/^\.\//, '')),
    'utf8',
  );
}

const api = async (method, body) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text();
    // 401 here is nearly always the token; 404 is nearly always the ref. Saying
    // which saves a round of guessing.
    const hint =
      res.status === 401
        ? ' — check SUPABASE_ACCESS_TOKEN'
        : res.status === 404
          ? ` — no project "${ref}" on this account`
          : '';
    throw new Error(`${method} auth config: ${res.status}${hint}\n${detail}`);
  }
  return res.json();
};

async function main() {
  const current = await api('GET');

  const changes = Object.entries(payload).filter(([field, value]) => current[field] !== value);

  if (!changes.length) {
    console.log(`${ref} is already up to date — all ${templates.length} templates match.`);
    return;
  }

  console.log(`${ref}: ${changes.length} field(s) differ\n`);
  for (const [field, value] of changes) {
    const before = current[field] ?? '';
    const summary = field.endsWith('_content')
      ? `${before.length} → ${value.length} bytes`
      : `"${before}" → "${value}"`;
    console.log(`  ${field.padEnd(46)} ${summary}`);
  }

  if (!apply) {
    console.log('\nNothing sent. Re-run with --yes to apply.');
    return;
  }

  await api('PATCH', Object.fromEntries(changes));

  // Read back rather than trusting the response: a silently ignored field would
  // otherwise look like a successful push.
  const after = await api('GET');
  const stuck = changes.filter(([field, value]) => after[field] !== value);

  if (stuck.length) {
    console.error(`\nApplied, but ${stuck.length} field(s) did not take:`);
    for (const [field] of stuck) console.error(`  ${field}`);
    process.exit(1);
  }

  console.log(`\nPushed. ${templates.length} templates live on ${ref}.`);
}

// A failed API call is an ordinary outcome here, not a crash — print what went
// wrong without a stack trace pointing at fetch.
main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
