/**
 * Vercel serverless entry.
 *
 * Deliberately plain CommonJS requiring the **compiled** output rather than the
 * TypeScript sources. Vercel builds functions with esbuild, and esbuild does not
 * implement `emitDecoratorMetadata`. Letting it compile Nest's sources strips
 * the design-time type metadata that constructor injection depends on, and the
 * app dies at runtime with "Nest can't resolve dependencies" — a failure that
 * appears only after deploy.
 *
 * `dist/` is produced by `nest build` (tsc) during the build step, so the
 * decorators are already lowered to `__decorate`/`__metadata` calls here.
 */
const { getServer } = require('../dist/serverless');

module.exports = async function handler(req, res) {
  const server = await getServer();
  return server(req, res);
};
