/**
 * Runs work that must outlive the HTTP response.
 *
 * This exists because the two deployment shapes disagree about what happens
 * after `res.end()`:
 *
 *  - On a long-running server, the process stays alive and a `setImmediate`
 *    callback simply runs.
 *  - On a serverless platform, the instance is frozen the moment the response
 *    is sent. A `setImmediate` callback is silently dropped — no error, no log,
 *    the work just never happens. Source ingestion would sit at `pending`
 *    forever.
 *
 * The platform adapter decides; callers only say "this continues after the
 * response".
 */
export abstract class BackgroundTasksPort {
  /**
   * Schedules `task` and returns immediately.
   *
   * Implementations must never let a rejection escape — there is no request
   * left to fail, and an unhandled rejection in a background task is how a
   * whole process gets torn down.
   */
  abstract run(name: string, task: () => Promise<void>): void;
}
