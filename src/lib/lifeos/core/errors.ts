// LIFEOS-API-001 section 6. One error shape for every refusal, so a client handles one thing.

export type LifeosErrorCode =
  | "unauthenticated" | "forbidden" | "not_found" | "method_not_allowed"
  | "version_conflict" | "idempotency_key_reused" | "conflict"
  | "validation_failed" | "invalid_transition" | "rate_limited" | "unavailable";

const STATUS: Record<LifeosErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  version_conflict: 409,
  idempotency_key_reused: 409,
  conflict: 409,
  validation_failed: 422,
  invalid_transition: 422,
  rate_limited: 429,
  unavailable: 503,
};

export class LifeosError extends Error {
  readonly code: LifeosErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly retryAfter?: number;

  constructor(code: LifeosErrorCode, message: string, opts: { details?: unknown; retryAfter?: number } = {}) {
    super(message);
    this.name = "LifeosError";
    this.code = code;
    this.status = STATUS[code];
    this.details = opts.details;
    this.retryAfter = opts.retryAfter;
  }
}

export const notFound = () => new LifeosError("not_found", "That was not found.");

/**
 * Maps a database error to a contract error. Anything unrecognised becomes `unavailable`, and its message
 * is never passed on: database text can name tables, constraints and values.
 */
export function fromDatabaseError(error: { code?: string; message?: string }): LifeosError {
  switch (error.code) {
    case "LO400": return new LifeosError("validation_failed", "That change is not allowed.");
    case "LO404": return notFound();
    case "LO409": return new LifeosError("version_conflict", "This record has changed since it was read. Read it again and retry.");
    case "LO410": return new LifeosError("idempotency_key_reused", "This Idempotency-Key was already used for a different request.");
    case "23505": return new LifeosError("conflict", "A record like this already exists.");
    case "23503": return new LifeosError("validation_failed", "That refers to something that is not in this workspace.");
    case "23514":
    case "22P02":
    case "22007":
    case "22008": return new LifeosError("validation_failed", "Those values are not valid for this record.");
    default: return new LifeosError("unavailable", "LifeOS could not complete that just now.");
  }
}
