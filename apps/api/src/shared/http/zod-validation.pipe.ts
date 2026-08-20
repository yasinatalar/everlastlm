import { Injectable, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { InvariantViolationError } from '../kernel/domain-error';

/**
 * Every inbound payload is parsed by an explicit schema from `@everlast/contracts`.
 * Zod strips unknown keys by default, so mass-assignment (`{"role":"owner"}`
 * smuggled into a profile update) cannot reach a repository.
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new InvariantViolationError('request.invalid', 'Request payload failed validation', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    });
  }
}

export const zodPipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);
