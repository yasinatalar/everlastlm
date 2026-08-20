import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { APP_CONFIG } from './config/app-config.module';
import type { Env } from './config/env.schema';

/**
 * Background work (ingestion, studio generation) runs detached from any
 * request, so a rejection there has no HTTP handler to catch it. Without these,
 * one failed import takes the whole API down.
 *
 * The asymmetry is deliberate: a rejected promise is logged and the process
 * continues, while an uncaught exception means the process may be in an
 * unknown state, so it is logged and the process exits for the supervisor to
 * restart cleanly.
 */
const installProcessGuards = (log: (message: string, error: unknown) => void): void => {
  process.on('unhandledRejection', (reason) => {
    log('unhandled promise rejection in background work', reason);
  });

  process.on('uncaughtException', (error) => {
    log('uncaught exception — shutting down', error);
    process.exit(1);
  });
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // The API is JSON-only and sits behind its own origin; a body parser limit
    // well under the upload limit keeps a JSON bomb from reaching the router.
    bodyParser: true,
  });

  const config = app.get<Env>(APP_CONFIG);
  const logger = app.get(Logger);
  app.useLogger(logger);

  installProcessGuards((message, error) => logger.error({ err: error }, message));

  /**
   * The API serves no HTML, so the strictest possible CSP applies: nothing may
   * be loaded or framed. Combined with `nosniff`, a response that somehow
   * echoes user content cannot be coerced into executing in a browser.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts:
        config.NODE_ENV === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
          : false,
      // The API is stateless and token-authenticated, so it never issues the
      // cross-origin isolation headers a document would need.
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Explicit allowlist. `credentials` stays off: authentication is a bearer
  // token in a header, never a cookie, which removes CSRF as a class of bug.
  app.enableCors({
    origin: config.WEB_ORIGINS,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept-Language', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api', { exclude: ['health', 'health/ready'] });

  // Trust exactly one proxy hop, so `req.ip` is the real client for rate
  // limiting. Trusting all proxies would let a client spoof X-Forwarded-For
  // and evade the limiter entirely.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');
  app.get(Logger).log(`Everlast API listening on port ${config.PORT}`);
}

void bootstrap();
