import { Injectable, Logger } from '@nestjs/common';
import { BackgroundTasksPort } from '../../shared/ports/background-tasks.port';

/**
 * For a long-running process (local dev, Railway, Fly, a container).
 * `setImmediate` defers past the current tick so the response flushes first.
 */
@Injectable()
export class ImmediateBackgroundTasks extends BackgroundTasksPort {
  private readonly logger = new Logger(ImmediateBackgroundTasks.name);

  run(name: string, task: () => Promise<void>): void {
    setImmediate(() => {
      void task().catch((error: unknown) => {
        this.logger.error({ err: error, task: name }, 'background task failed');
      });
    });
  }
}

/**
 * For Vercel and other platforms that freeze the instance after the response.
 *
 * `waitUntil` registers the promise with the platform so the instance is kept
 * alive until it settles, instead of being frozen mid-work.
 *
 * The ceiling is the function's `maxDuration` — 60s on Vercel's Hobby plan.
 * A task that exceeds it is killed with no callback, which is why ingestion
 * writes its progress to the database at each stage rather than only at the
 * end: a source that dies mid-run is left in a visible non-terminal state that
 * the user can retry, not a silent failure.
 */
@Injectable()
export class DeferredBackgroundTasks extends BackgroundTasksPort {
  private readonly logger = new Logger(DeferredBackgroundTasks.name);

  constructor(private readonly waitUntil: (promise: Promise<unknown>) => void) {
    super();
  }

  run(name: string, task: () => Promise<void>): void {
    const settled = task().catch((error: unknown) => {
      this.logger.error({ err: error, task: name }, 'background task failed');
    });

    try {
      this.waitUntil(settled);
    } catch (error) {
      // `waitUntil` throws when called outside a request context. The work is
      // already running; it just loses its keep-alive guarantee.
      this.logger.warn(
        { err: error, task: name },
        'waitUntil unavailable — task may be cut short',
      );
    }
  }
}
