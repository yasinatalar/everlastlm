import { Injectable, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../context/request-context';

export const AI_RATE_LIMIT_KEY = 'everlast:ai-rate-limited';

/**
 * Marks a route as costly work — model calls, embeddings, speech synthesis, or
 * outbound email — so the stricter `ai` limiter applies to it. Every named
 * throttler otherwise applies to every route, which would impose the
 * expensive-endpoint budget on ordinary reads.
 */
export const AiRateLimited = () => SetMetadata(AI_RATE_LIMIT_KEY, true);

export const skipUnlessAiRoute = (context: ExecutionContext): boolean => {
  if (context.getType() !== 'http') return true;
  return !(
    Reflect.getMetadata(AI_RATE_LIMIT_KEY, context.getHandler()) ||
    Reflect.getMetadata(AI_RATE_LIMIT_KEY, context.getClass())
  );
};

/**
 * Rate limits per authenticated user rather than per IP.
 *
 * IP-based limiting is both too strict and too loose here: colleagues behind
 * one corporate NAT share a budget, while an attacker with a pool of addresses
 * gets a fresh budget per address. The user id is the resource being protected,
 * so it is the right key. Unauthenticated requests still fall back to IP.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Request & { user?: AuthenticatedUser },
  ): Promise<string> {
    return req.user?.id ?? req.ip ?? 'anonymous';
  }
}
