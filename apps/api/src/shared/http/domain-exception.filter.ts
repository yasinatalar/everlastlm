import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { ApiError } from '@everlast/contracts';
import type { Response } from 'express';
import { RequestContextService } from '../context/request-context';
import {
  ConflictError,
  DependencyFailureError,
  DomainError,
  ForbiddenError,
  InvariantViolationError,
  NotFoundError,
  QuotaExceededError,
  UnauthorizedError,
} from '../kernel/domain-error';

/**
 * The single exit point for errors. Two rules:
 *
 *  1. Only `DomainError` subclasses and `HttpException` produce a described
 *     response. Anything else is a bug and is reported as a bare 500 — stack
 *     traces, driver messages and upstream payloads never reach the client.
 *  2. Every response carries the request id so a user-reported failure can be
 *     correlated with the server log that has the detail.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  constructor(private readonly context: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = this.context.requestId;
    const body = this.toBody(exception, requestId);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ err: exception, requestId }, 'unhandled request failure');
    } else {
      this.logger.warn({ requestId, code: body.code }, body.message);
    }

    if (response.headersSent) {
      // A streaming response already committed its status; the SSE writer emits
      // its own terminal `error` event, so just close the socket.
      response.end();
      return;
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, requestId: string): ApiError {
    if (exception instanceof DomainError) {
      return {
        statusCode: statusFor(exception),
        code: exception.code,
        message: exception.message,
        requestId,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'rate_limit.exceeded',
        message: 'Too many requests',
        requestId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        statusCode: status,
        code: `http.${status}`,
        message: status >= 500 ? 'Internal server error' : exception.message,
        requestId,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal.error',
      message: 'Internal server error',
      requestId,
    };
  }
}

const statusFor = (error: DomainError): number => {
  if (error instanceof UnauthorizedError) return HttpStatus.UNAUTHORIZED;
  if (error instanceof ForbiddenError) return HttpStatus.FORBIDDEN;
  if (error instanceof NotFoundError) return HttpStatus.NOT_FOUND;
  if (error instanceof ConflictError) return HttpStatus.CONFLICT;
  if (error instanceof QuotaExceededError) return HttpStatus.UNPROCESSABLE_ENTITY;
  if (error instanceof InvariantViolationError) return HttpStatus.BAD_REQUEST;
  if (error instanceof DependencyFailureError) return HttpStatus.BAD_GATEWAY;
  return HttpStatus.INTERNAL_SERVER_ERROR;
};
