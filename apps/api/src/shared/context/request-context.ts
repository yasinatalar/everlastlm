import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { UnauthorizedError } from '../kernel/domain-error';

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string | null;
  /**
   * The caller's Supabase access token. Repositories forward it so every query
   * executes under that user's RLS policies rather than as service role.
   */
  readonly accessToken: string;
  readonly assuranceLevel: 'aal1' | 'aal2';
}

export interface RequestContext {
  readonly requestId: string;
  readonly ip?: string;
  readonly userAgent?: string;
  user?: AuthenticatedUser;
  /** Per-request memo (e.g. the Supabase client bound to this token). */
  readonly cache: Map<string, unknown>;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Ambient per-request state, so singleton services can resolve "who is asking"
 * without every provider becoming request-scoped. Request-scoped DI in Nest is
 * contagious — it forces every consumer up the graph to be re-instantiated per
 * request — which is a heavy price for what is really one string.
 */
@Injectable()
export class RequestContextService {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  get(): RequestContext | undefined {
    return storage.getStore();
  }

  get requestId(): string {
    return storage.getStore()?.requestId ?? 'unknown';
  }

  get user(): AuthenticatedUser | undefined {
    return storage.getStore()?.user;
  }

  /**
   * Every authenticated code path goes through `SupabaseAuthGuard`, so a missing
   * user here means a route was mounted without the guard — fail loudly.
   */
  requireUser(): AuthenticatedUser {
    const user = this.user;
    if (!user) throw new UnauthorizedError();
    return user;
  }

  setUser(user: AuthenticatedUser): void {
    const store = storage.getStore();
    if (store) store.user = user;
  }

  memo<T>(key: string, factory: () => T): T {
    const store = storage.getStore();
    if (!store) return factory();
    if (!store.cache.has(key)) store.cache.set(key, factory());
    return store.cache.get(key) as T;
  }
}

export const createRequestContext = (init: {
  requestId: string;
  ip?: string;
  userAgent?: string;
}): RequestContext => ({ ...init, cache: new Map() });
