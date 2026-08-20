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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = join(repo, 'apps/api/src');
// Resolve through the API package's own node_modules, not the global store:
// pnpm keeps many versions of a package side by side, and picking the first
// match in .pnpm can report a transitive copy rather than the one the API
// actually loads. That mistake let jose@6 (ESM-only) through while the checker
// reported jose@5 as fine.
const apiModules = join(repo, 'apps/api/node_modules');

const imported = new Set(
  execSync(`grep -rhoE "from '[a-z@][^']*'" ${apiSrc}`, { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.replace(/from '|'$/g, '').trim())
    .filter(Boolean)
    .filter((d) => !d.startsWith('.') && !d.startsWith('node:') && !d.startsWith('@everlast'))
    .map((d) => (d.startsWith('@') ? d.split('/').slice(0, 2).join('/') : d.split('/')[0])),
);

const offenders = [];
const unresolved = [];

for (const pkg of [...imported].sort()) {
  const manifest = join(apiModules, pkg, 'package.json');

  if (!existsSync(manifest)) {
    unresolved.push(pkg);
    continue;
  }

  const pj = JSON.parse(readFileSync(manifest, 'utf8'));
  const exportsBlob = JSON.stringify(pj.exports ?? '');

  // A package is requireable only if it offers a CommonJS entry point: either a
  // `require` condition in `exports`, or a `.cjs` main. Declaring `main` alone
  // proves nothing — jose@6 sets `"type": "module"` *and* points `main` at an
  // ESM file, which an earlier version of this check read as safe.
  //
  // Do not "verify" by calling require() here either: Node 22.12+ permits
  // requiring an ES module, so it succeeds locally for exactly the packages
  // that fail in production.
  const hasCjsEntry =
    exportsBlob.includes('"require"') || Boolean(pj.main && pj.main.endsWith('.cjs'));
  const esmOnly = pj.type === 'module' && !hasCjsEntry;

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
