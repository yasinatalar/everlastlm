import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NotebookRole } from '@everlast/contracts';
import type { Request } from 'express';
import { ForbiddenError, InvariantViolationError } from '../kernel/domain-error';
import { IS_PUBLIC_KEY, REQUIRED_ROLE_KEY } from './auth.decorators';
import { NotebookAccessService } from './notebook-access.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Fail-closed notebook authorisation.
 *
 * Any route carrying a `:notebookId` parameter must declare the role it needs
 * with `@RequiresNotebookRole(...)`. If the annotation is missing the request
 * is refused rather than allowed — forgetting to annotate a new endpoint is
 * then an immediate, loud failure in development instead of a silent hole in
 * production.
 */
@Injectable()
export class NotebookAccessGuard implements CanActivate {
  private readonly logger = new Logger(NotebookAccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly access: NotebookAccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const request = ctx
      .switchToHttp()
      .getRequest<Request & { notebookRole?: NotebookRole }>();
    const notebookId = (request.params as Record<string, string | undefined>)?.notebookId;
    if (!notebookId) return true;

    // Guards run before pipes, so the controller's `zodPipe(uuidSchema)` has
    // not validated this yet. Passing a malformed id straight to Postgres
    // raises 22P02 and surfaces as a 502 instead of a 400.
    if (!UUID.test(notebookId)) {
      throw new InvariantViolationError('request.invalid', 'notebookId must be a UUID');
    }

    const required = this.reflector.getAllAndOverride<NotebookRole>(REQUIRED_ROLE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!required) {
      this.logger.error(
        `${ctx.getClass().name}.${ctx.getHandler().name} takes :notebookId but declares no @RequiresNotebookRole`,
      );
      throw new ForbiddenError('notebook', 'route is missing an authorisation policy');
    }

    request.notebookRole = await this.access.require(notebookId, required);
    return true;
  }
}
