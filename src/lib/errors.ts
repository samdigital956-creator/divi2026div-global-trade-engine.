/**
 * Errors whose `message` is safe to show to the user. Anything else is
 * logged server-side and replaced with a generic message.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(message, 401, "unauthorized");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, 403, "forbidden");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super(message, 404, "not_found");
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message, 422, "validation_error", fieldErrors);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "conflict");
  }
}

export class LimitExceededError extends AppError {
  constructor(message: string) {
    super(message, 402, "limit_exceeded");
  }
}

export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many attempts. Please wait ${retryAfterSeconds < 90 ? `${retryAfterSeconds} seconds` : `${Math.ceil(retryAfterSeconds / 60)} minutes`} and try again.`, 429, "rate_limited");
  }
}

export function publicError(err: unknown): { message: string; status: number; code: string; fieldErrors?: Record<string, string> } {
  if (err instanceof AppError) {
    return { message: err.message, status: err.status, code: err.code, fieldErrors: err.fieldErrors };
  }
  const ref = Math.random().toString(36).slice(2, 10);
  console.error(`[error ${ref}]`, err);
  return { message: `Something went wrong. Reference: ${ref}`, status: 500, code: "internal_error" };
}
