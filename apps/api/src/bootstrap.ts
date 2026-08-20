import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { APP_CONFIG } from './config/app-config.module';
import type { Env } from './config/env.schema';

/**
 * Everything that configures the app but does not start a listener.
 *
 * Shared by the standalone server (`main.ts`) and the serverless handler
 * (`serverless.ts`). Keeping it in one place is what stops the two deployment
 * targets from drifting — a CORS allowlist or a security header that exists on
 * only one of them is exactly the bug this prevents.
 */
export const configureApp = (app: NestExpressApplication): Env => {
  const config = app.get<Env>(APP_CONFIG);
  app.useLogger(app.get(Logger));

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

  return config;
};

/**
 * Background work runs detached from any request, so a rejection there has no
 * HTTP handler to catch it. Without these, one failed import takes the API down.
 *
 * The asymmetry is deliberate: a rejected promise is logged and the process
 * continues, while an uncaught exception means the process may be in an unknown
 * state, so it is logged and the process exits for the supervisor to restart.
 *
 * Only installed for the standalone server. On a serverless platform the
 * runtime owns the process, `process.exit` would kill an instance that may be
 * serving other requests, and repeated cold starts would re-register listeners.
 */
export const installProcessGuards = (
  log: (message: string, error: unknown) => void,
): void => {
  process.on('unhandledRejection', (reason) => {
    log('unhandled promise rejection in background work', reason);
  });

  process.on('uncaughtException', (error) => {
    log('uncaught exception — shutting down', error);
    process.exit(1);
  });
};

export { Logger };
