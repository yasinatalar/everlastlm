import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { NotebookRole } from '@everlast/contracts';
import type { AuthenticatedUser } from '../context/request-context';

export const IS_PUBLIC_KEY = 'everlast:public';
export const REQUIRED_ROLE_KEY = 'everlast:required-role';
export const REQUIRE_MFA_KEY = 'everlast:require-mfa';

/** Opt a route out of authentication. Deny-by-default is the norm. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Declares the minimum notebook role a route needs. `NotebookAccessGuard`
 * reads the `notebookId` route parameter and enforces it, so a controller can
 * never forget the check — an unannotated route under `/notebooks/:notebookId`
 * is rejected outright.
 */
export const RequiresNotebookRole = (role: NotebookRole) =>
  SetMetadata(REQUIRED_ROLE_KEY, role);

/** Requires the session to have completed a second factor (AAL2). */
export const RequiresMfa = () => SetMetadata(REQUIRE_MFA_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new Error('CurrentUser used on a route without SupabaseAuthGuard');
    }
    return request.user;
  },
);
