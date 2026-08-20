import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, installProcessGuards } from './bootstrap';

/** Standalone server: local development and any long-running host. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: true,
  });

  const config = configureApp(app);
  const logger = app.get(Logger);

  installProcessGuards((message, error) => logger.error({ err: error }, message));
  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');
  logger.log(`Everlast API listening on port ${config.PORT}`);
}

void bootstrap();
