import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import express, { type Express } from 'express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

/**
 * Serverless entry point.
 *
 * Nest is expensive to construct — it builds the whole DI graph — so the app is
 * bootstrapped once per instance and reused for every subsequent invocation.
 * The promise itself is cached rather than the result: two requests arriving
 * during a cold start would otherwise each start their own bootstrap, and the
 * loser's Express instance would be silently discarded mid-request.
 *
 * No `listen()` and no shutdown hooks: the platform owns the socket and the
 * lifecycle. See `bootstrap.ts` for why process guards are not installed here.
 */
let cached: Promise<Express> | null = null;

const create = async (): Promise<Express> => {
  const server = express();

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(server),
    { bufferLogs: true, bodyParser: true },
  );

  configureApp(app);
  await app.init();

  return server;
};

export const getServer = (): Promise<Express> => {
  cached ??= create().catch((error: unknown) => {
    // Clear the cache so a failed cold start (a bad env var, an unreachable
    // dependency) is retried on the next invocation instead of poisoning the
    // instance for its whole lifetime.
    cached = null;
    throw error;
  });

  return cached;
};

export default getServer;
