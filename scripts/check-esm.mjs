/**
 * Fails if the API statically imports an ESM-only package.
 *
 * The API compiles to CommonJS, so `import x from 'pkg'` becomes
 * `require('pkg')`. Node 22.12+ permits requiring an ESM module, which means an
 * ESM-only dependency works perfectly in local development and on `pnpm build`
 * — and then throws `ERR_REQUIRE_ESM` at runtime on a platform whose loader
 * does not allow it. `p-limit@7` shipped exactly that way and crashed every
 * request on the first Vercel deploy.
 *
 * Dynamic `await import()` is fine and is not flagged; only static imports are.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = join(repo, 'apps/api/src');
const store = join(repo, 'node_modules/.pnpm');

const imported = new Set(
  execSync(`grep -rhoE "from '[a-z@][^']*'" ${apiSrc}`, { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.replace(/from '|'$/g, '').trim())
    .filter(Boolean)
    .filter((d) => !d.startsWith('.') && !d.startsWith('node:') && !d.startsWith('@everlast'))
    .map((d) => (d.startsWith('@') ? d.split('/').slice(0, 2).join('/') : d.split('/')[0])),
);

const dirs = readdirSync(store);
const offenders = [];
const unresolved = [];

for (const pkg of [...imported].sort()) {
  const hit = dirs.find((d) => d.startsWith(`${pkg.replace('/', '+')}@`));
  const manifest = hit && join(store, hit, 'node_modules', pkg, 'package.json');

  if (!manifest || !existsSync(manifest)) {
    unresolved.push(pkg);
    continue;
  }

  const pj = JSON.parse(readFileSync(manifest, 'utf8'));
  const exportsBlob = JSON.stringify(pj.exports ?? '');
  const esmOnly = pj.type === 'module' && !exportsBlob.includes('require') && !pj.main;

  if (esmOnly) offenders.push(`${pkg}@${pj.version}`);
}

if (unresolved.length > 0) {
  console.log(`  note: could not resolve ${unresolved.join(', ')} — install first?`);
}

if (offenders.length === 0) {
  console.log(`  ${imported.size} imported packages checked, none ESM-only.`);
  process.exit(0);
}

console.error('\n  ESM-only packages imported from CommonJS output:\n');
for (const o of offenders) console.error(`    ${o}`);
console.error(
  '\n  These work locally (Node 22.12+ allows require of ESM) but throw\n' +
    '  ERR_REQUIRE_ESM on Vercel. Replace them, pin a CJS version, or load\n' +
    '  them with a dynamic await import().\n',
);
process.exit(1);
