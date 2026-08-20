/**
 * Domain errors are raised by the domain and application layers and know
 * nothing about HTTP. `DomainExceptionFilter` maps them onto status codes at
 * the edge, which keeps the domain framework-free and testable.
 *
 * `code` is a stable, machine-readable identifier (`notebook.not_found`). The
 * frontend translates it; `message` is only a developer-facing fallback.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  /** Safe to expose verbatim to the caller. Never put internals in here. */
  readonly details?: Record<string, unknown>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** The requested aggregate does not exist, or the caller may not know it does. */
export class NotFoundError extends DomainError {
  readonly code: string;

  constructor(resource: string, id?: string) {
    super(`${resource} not found`, id ? { id } : undefined);
    this.code = `${resource}.not_found`;
  }
}

/** The caller is authenticated but lacks the required role. */
export class ForbiddenError extends DomainError {
  readonly code: string;

  constructor(resource: string, reason = 'insufficient permissions') {
    super(reason);
    this.code = `${resource}.forbidden`;
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = 'auth.unauthorized';

  constructor(reason = 'authentication required') {
    super(reason);
  }
}

/** A domain invariant was violated by the caller's input. */
export class InvariantViolationError extends DomainError {
  readonly code: string;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.code = code;
  }
}

/** The operation conflicts with current state (duplicate, wrong status, ...). */
export class ConflictError extends DomainError {
  readonly code: string;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.code = code;
  }
}

/** A quota or plan limit was reached. */
export class QuotaExceededError extends DomainError {
  readonly code: string;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.code = code;
  }
}

/** An upstream dependency (Supabase, Claude, Voyage) failed transiently. */
export class DependencyFailureError extends DomainError {
  readonly code: string;

  constructor(dependency: string, message: string) {
    super(message);
    this.code = `dependency.${dependency}_failed`;
  }
}

/**
 * An upstream dependency rejected our credentials.
 *
 * Deliberately distinct from `DependencyFailureError`: that one means "it
 * broke, try again", this one means "it will never work until an operator
 * fixes the configuration". Collapsing the two produces the worst kind of
 * error message — one that tells a user to retry something that cannot
 * succeed, which is exactly how a missing API key gets mistaken for a bug in
 * the document they uploaded.
 */
export class DependencyNotConfiguredError extends DomainError {
  readonly code: string;

  constructor(readonly dependency: string) {
    super(`${dependency} rejected the configured credentials`);
    this.code = `dependency.${dependency}_unconfigured`;
  }
}
