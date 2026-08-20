import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, AppConfigModule } from './config/app-config.module';
import type { Env } from './config/env.schema';
import { LlmModule } from './infrastructure/llm/llm.module';
import { RuntimeModule } from './infrastructure/runtime/runtime.module';
import { SupabaseModule } from './infrastructure/supabase/supabase.module';
import { ChatModule } from './modules/chat/chat.module';
import { IamModule } from './modules/iam/iam.module';
import { NotebooksModule } from './modules/notebooks/notebooks.module';
import { NotesModule } from './modules/notes/notes.module';
import { SourcesModule } from './modules/sources/sources.module';
import { StudioModule } from './modules/studio/studio.module';
import { RequestContextMiddleware } from './shared/context/request-context.middleware';
import { HealthController } from './shared/health/health.controller';
import { DomainExceptionFilter } from './shared/http/domain-exception.filter';
import { NotebookAccessGuard } from './shared/security/notebook-access.guard';
import { SecurityModule } from './shared/security/security.module';
import { SupabaseAuthGuard } from './shared/security/supabase-auth.guard';
import { UserAwareThrottlerGuard, skipUnlessAiRoute } from './shared/security/throttling';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: Env) => ({
        pinoHttp: {
          level: config.LOG_LEVEL,
          transport:
            config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          // Credentials must never reach the log sink, even at trace level.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-api-key"]',
              'res.headers["set-cookie"]',
            ],
            remove: true,
          },
          customProps: (req) => ({ requestId: req.id }),
          autoLogging: {
            ignore: (req) => req.url === '/health' || req.url === '/health/ready',
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: Env) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.RATE_LIMIT_TTL_SECONDS * 1000,
            limit: config.RATE_LIMIT_LIMIT,
          },
          // Stricter budget for endpoints that cost real money per call. It
          // applies only to routes marked `@AiRateLimited()`.
          {
            name: 'ai',
            ttl: config.RATE_LIMIT_TTL_SECONDS * 1000,
            limit: config.RATE_LIMIT_AI_LIMIT,
            skipIf: skipUnlessAiRoute,
          },
        ],
      }),
    }),

    RuntimeModule,
    SupabaseModule,
    SecurityModule,
    LlmModule,

    IamModule,
    NotebooksModule,
    SourcesModule,
    ChatModule,
    NotesModule,
    StudioModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: throttle first (cheapest), then authenticate, then
    // authorise the notebook. All three are global, so protection is the
    // default and every exception is an explicit decorator.
    { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: NotebookAccessGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
