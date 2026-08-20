import { Global, Logger, Module } from '@nestjs/common';
import { BackgroundTasksPort } from '../../shared/ports/background-tasks.port';
import { DeferredBackgroundTasks, ImmediateBackgroundTasks } from './background-tasks.adapter';

/**
 * Detects the host platform once, at boot.
 *
 * `VERCEL` is set by Vercel in every build and runtime environment. Selecting
 * on it rather than on `NODE_ENV` matters: a container running
 * `NODE_ENV=production` is still a long-running process and must keep the
 * `setImmediate` behaviour.
 */
const isServerless = (): boolean => process.env.VERCEL === '1' || Boolean(process.env.VERCEL_URL);

@Global()
@Module({
  providers: [
    {
      provide: BackgroundTasksPort,
      useFactory: async (): Promise<BackgroundTasksPort> => {
        if (!isServerless()) return new ImmediateBackgroundTasks();

        try {
          // Imported lazily so a non-Vercel deployment does not need the
          // package installed or loaded.
          const { waitUntil } = await import('@vercel/functions');
          return new DeferredBackgroundTasks(waitUntil);
        } catch (error) {
          new Logger('RuntimeModule').error(
            { err: error },
            '@vercel/functions unavailable; background work may be cut off after the response',
          );
          return new ImmediateBackgroundTasks();
        }
      },
    },
  ],
  exports: [BackgroundTasksPort],
})
export class RuntimeModule {}
