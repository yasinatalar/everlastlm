import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createRequestContext, RequestContextService } from './request-context';

const HEADER = 'x-request-id';
/** Only accept a caller-supplied id if it cannot poison logs. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(HEADER);
    const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

    res.setHeader(HEADER, requestId);

    this.context.run(
      createRequestContext({
        requestId,
        ip: req.ip,
        userAgent: req.header('user-agent')?.slice(0, 256),
      }),
      () => next(),
    );
  }
}
