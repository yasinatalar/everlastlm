import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContextService, type AuthenticatedUser } from '../context/request-context';
import { ForbiddenError, UnauthorizedError } from '../kernel/domain-error';
import { IS_PUBLIC_KEY, REQUIRE_MFA_KEY } from './auth.decorators';
import { SupabaseTokenVerifier } from './supabase-token.verifier';

/**
 * Registered globally, so authentication is deny-by-default: a new controller
 * is protected the moment it is mounted, and opting out is an explicit,
 * greppable `@Public()`.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: SupabaseTokenVerifier,
    private readonly context: RequestContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearerToken(request.header('authorization'));
    if (!token) throw new UnauthorizedError('missing bearer token');

    const user = await this.verifier.verify(token);

    const requiresMfa = this.reflector.getAllAndOverride<boolean>(REQUIRE_MFA_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (requiresMfa && user.assuranceLevel !== 'aal2') {
      throw new ForbiddenError('auth', 'multi-factor authentication required');
    }

    this.context.setUser(user);
    // Also attached to the request so `@CurrentUser()` works without ALS.
    request.user = user;
    return true;
  }
}

export const extractBearerToken = (header: string | undefined): string | null => {
  if (!header) return null;
  const [scheme, value, ...rest] = header.split(' ');
  if (rest.length > 0) return null;
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;
  const token = value?.trim();
  // A JWT is three base64url segments; reject anything else before parsing.
  if (!token || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  return token;
};
