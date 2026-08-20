import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseEnv, type Env } from './env.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Config is parsed exactly once and injected as a frozen, fully-typed object.
 * Consumers get `Env` rather than `ConfigService.get<string>('X')`, so a typo
 * in a key name is a compile error instead of an `undefined` at runtime.
 */
@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, ignoreEnvFile: false })],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): Env => Object.freeze(parseEnv(process.env)),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
