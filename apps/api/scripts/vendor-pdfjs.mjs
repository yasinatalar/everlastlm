/**
 * Copies the pdf.js build into `dist/vendor/pdfjs/` after `nest build`.
 *
 * Getting pdf.js onto a serverless function has failed three different ways
 * here, and every one of them was a *packaging* failure rather than a code one:
 * `@napi-rs/canvas` required through a runtime-built specifier the tracer could
 * not follow, an ESM-only package reached through a `require()` the compiler
 * generated, and pdf.js's own worker loaded with a dynamic specifier that no
 * bundler can see.
 *
 * `apps/api/vercel.json` already declares `includeFiles: "dist/**"`, so anything
 * placed here ships verbatim. Copying the two files we need trades a clever
 * dependency on @vercel/nft's analysis — and on pnpm's symlink farm surviving
 * the trip into the Lambda — for a plain file that is either present or not.
 *
 * The adapter falls back to normal package resolution when this directory is
 * absent, which is what `nest start --watch` and the unit tests use.
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(apiRoot, 'dist', 'vendor', 'pdfjs');

// The worker is not optional. On Node, pdf.js runs it on the main thread and
// imports it by path the first time a document is opened.
const files = ['pdf.mjs', 'pdf.worker.mjs'];

mkdirSync(target, { recursive: true });

for (const file of files) {
  const source = require.resolve(`pdfjs-dist/legacy/build/${file}`);
  copyFileSync(source, join(target, file));
  console.log(`  vendored ${file}`);
}
