import { InvariantViolationError } from './domain-error';

/**
 * Invariant helpers used inside entity constructors and behaviour methods.
 * A violated invariant is a bug in the caller, never a user-facing validation
 * message — request payloads are validated by Zod at the edge long before the
 * domain sees them. These exist so an aggregate can never be constructed in an
 * illegal state, including from a corrupted database row.
 */
export const invariant: (
  condition: unknown,
  code: string,
  message: string,
) => asserts condition = (condition, code, message) => {
  if (!condition) {
    throw new InvariantViolationError(code, message);
  }
};

export const requireNonEmpty = (value: string | null | undefined, code: string): string => {
  const trimmed = value?.trim() ?? '';
  invariant(trimmed.length > 0, code, `${code} must not be empty`);
  return trimmed;
};

export const requireRange = (
  value: number,
  min: number,
  max: number,
  code: string,
): number => {
  invariant(
    Number.isFinite(value) && value >= min && value <= max,
    code,
    `${code} must be between ${min} and ${max}`,
  );
  return value;
};
