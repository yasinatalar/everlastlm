import { Inject, Injectable, Logger } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../../config/app-config.module';
import type { Env } from '../../config/env.schema';
import { RequestContextService } from '../../shared/context/request-context';
import { DependencyFailureError } from '../../shared/kernel/domain-error';
import type { Database } from './database.types';

export type Db = SupabaseClient<Database, 'public'>;

const USER_CLIENT_CACHE_KEY = 'supabase:user-client';

/**
 * Two clients, two very different trust levels.
 *
 * `forUser()` binds the caller's access token, so **every** statement is
 * evaluated against that user's RLS policies. This is the default and is what
 * all request-driven repositories use.
 *
 * `admin` uses the service-role key and **bypasses RLS entirely**. It exists
 * only for work with no authenticated caller — the ingestion pipeline writing
 * chunks, the audit log, and looking a user up by e-mail during an invite.
 * Every call site is expected to have already performed its own authorisation
 * check; grep for `.admin` to review them all in one pass.
 */
@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly adminClient: Db;

  constructor(
    @Inject(APP_CONFIG) private readonly config: Env,
    private readonly context: RequestContextService,
  ) {
    this.adminClient = createClient<Database>(
      config.SUPABASE_URL,
      config.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { 'x-everlast-client': 'api-service-role' } },
      },
    );
  }

  /** Service-role client. Bypasses row level security — see class docs. */
  get admin(): Db {
    return this.adminClient;
  }

  /**
   * Client scoped to the current request's user. Memoised per request so a
   * handler touching several repositories reuses one client.
   */
  forUser(): Db {
    const user = this.context.requireUser();
    return this.context.memo(USER_CLIENT_CACHE_KEY, () =>
      createClient<Database>(this.config.SUPABASE_URL, this.config.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: {
          headers: {
            Authorization: `Bearer ${user.accessToken}`,
            'x-everlast-client': 'api-user',
          },
        },
      }),
    );
  }

  /**
   * Object storage, via the service role.
   *
   * Uploads happen after the authorisation check but partly after the HTTP
   * response has been sent (the ingestion pipeline re-reads the object), where
   * no user token is in scope. The bucket's RLS policies still apply to any
   * client that talks to storage directly, so they remain the boundary for
   * browser access; this path is the API acting on an already-authorised
   * request.
   */
  storage(): Db['storage'] {
    return this.adminClient.storage;
  }

  /**
   * Normalises a PostgREST failure into a domain error. RLS denials surface as
   * empty result sets or 42501; either way the caller must not learn whether
   * the row exists, so repositories translate them to `NotFoundError`.
   */
  fail(operation: string, error: { message: string; code?: string }): never {
    this.logger.error(
      { operation, code: error.code, requestId: this.context.requestId },
      `Supabase operation failed: ${error.message}`,
    );
    throw new DependencyFailureError('supabase', `${operation} failed`);
  }
}
