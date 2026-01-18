/**
 * Result Pattern for Standardized Error Handling
 *
 * This module provides a type-safe way to handle operations that can fail
 * without using exceptions for control flow.
 */

/**
 * Error codes for browser/desktop automation operations
 */
export enum AutomationErrorCode {
  // Session errors
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  SESSION_LIMIT_EXCEEDED = "SESSION_LIMIT_EXCEEDED",
  SESSION_CREATION_FAILED = "SESSION_CREATION_FAILED",
  SESSION_ALREADY_CLOSED = "SESSION_ALREADY_CLOSED",

  // Rate limiting
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED",

  // Security
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  INVALID_URL = "INVALID_URL",
  BLOCKED_URL = "BLOCKED_URL",
  INVALID_INPUT = "INVALID_INPUT",

  // Provider errors
  PROVIDER_ERROR = "PROVIDER_ERROR",
  PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT",
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE",

  // Operation errors
  NAVIGATION_FAILED = "NAVIGATION_FAILED",
  ACTION_FAILED = "ACTION_FAILED",
  SCREENSHOT_FAILED = "SCREENSHOT_FAILED",
  EXTRACTION_FAILED = "EXTRACTION_FAILED",

  // Resource errors
  STORAGE_ERROR = "STORAGE_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",

  // General
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
  NOT_CONFIGURED = "NOT_CONFIGURED",
}

/**
 * Structured error with code, message, and optional details
 */
export interface AutomationError {
  code: AutomationErrorCode;
  message: string;
  details?: Record<string, unknown>;
  cause?: Error;
  retryable?: boolean;
}

/**
 * Success result
 */
export interface Success<T> {
  ok: true;
  value: T;
}

/**
 * Failure result
 */
export interface Failure {
  ok: false;
  error: AutomationError;
}

/**
 * Result type - either success with value or failure with error
 */
export type Result<T> = Success<T> | Failure;

/**
 * Create a success result
 */
export function ok<T>(value: T): Success<T> {
  return { ok: true, value };
}

/**
 * Create a failure result
 */
export function err(
  code: AutomationErrorCode,
  message: string,
  options?: {
    details?: Record<string, unknown>;
    cause?: Error;
    retryable?: boolean;
  },
): Failure {
  return {
    ok: false,
    error: {
      code,
      message,
      details: options?.details,
      cause: options?.cause,
      retryable: options?.retryable ?? false,
    },
  };
}

/**
 * Create error from unknown caught value
 */
export function errFromUnknown(
  caught: unknown,
  code: AutomationErrorCode = AutomationErrorCode.UNKNOWN_ERROR,
  defaultMessage: string = "An unexpected error occurred",
): Failure {
  if (caught instanceof Error) {
    return err(code, caught.message, { cause: caught });
  }
  if (typeof caught === "string") {
    return err(code, caught);
  }
  return err(code, defaultMessage, {
    details: { caught: String(caught) },
  });
}

/**
 * Check if result is success
 */
export function isOk<T>(result: Result<T>): result is Success<T> {
  return result.ok === true;
}

/**
 * Check if result is failure
 */
export function isErr<T>(result: Result<T>): result is Failure {
  return result.ok === false;
}

/**
 * Unwrap result or throw
 */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`Unwrap failed: ${result.error.message}`);
}

/**
 * Unwrap result or return default value
 */
export function unwrapOr<T>(result: Result<T>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * Map success value
 */
export function map<T, U>(result: Result<T>, fn: (value: T) => U): Result<U> {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
}

/**
 * Chain results (flatMap)
 */
export function andThen<T, U>(
  result: Result<T>,
  fn: (value: T) => Result<U>,
): Result<U> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

/**
 * Convert Result to API response format
 */
export function toApiResponse<T>(result: Result<T>): {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  };
} {
  if (result.ok) {
    return { success: true, data: result.value };
  }
  return {
    success: false,
    error: {
      code: result.error.code,
      message: result.error.message,
      details: result.error.details,
      retryable: result.error.retryable,
    },
  };
}

/**
 * Convert Result to HTTP status code
 */
export function toHttpStatus(result: Result<unknown>): number {
  if (result.ok) {
    return 200;
  }

  switch (result.error.code) {
    case AutomationErrorCode.SESSION_NOT_FOUND:
      return 404;
    case AutomationErrorCode.UNAUTHORIZED:
      return 401;
    case AutomationErrorCode.FORBIDDEN:
    case AutomationErrorCode.BLOCKED_URL:
      return 403;
    case AutomationErrorCode.RATE_LIMIT_EXCEEDED:
    case AutomationErrorCode.QUOTA_EXCEEDED:
      return 429;
    case AutomationErrorCode.INVALID_INPUT:
    case AutomationErrorCode.INVALID_URL:
      return 400;
    case AutomationErrorCode.SESSION_LIMIT_EXCEEDED:
      return 409;
    case AutomationErrorCode.PROVIDER_UNAVAILABLE:
    case AutomationErrorCode.NOT_CONFIGURED:
      return 503;
    case AutomationErrorCode.PROVIDER_TIMEOUT:
      return 504;
    default:
      return 500;
  }
}

/**
 * Wrap an async function to return Result
 */
export async function tryCatch<T>(
  fn: () => Promise<T>,
  errorCode: AutomationErrorCode = AutomationErrorCode.UNKNOWN_ERROR,
): Promise<Result<T>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (error) {
    return errFromUnknown(error, errorCode);
  }
}

/**
 * Wrap a sync function to return Result
 */
export function tryCatchSync<T>(
  fn: () => T,
  errorCode: AutomationErrorCode = AutomationErrorCode.UNKNOWN_ERROR,
): Result<T> {
  try {
    const value = fn();
    return ok(value);
  } catch (error) {
    return errFromUnknown(error, errorCode);
  }
}

/**
 * Combine multiple results - returns first failure or all successes
 */
export function all<T extends readonly Result<unknown>[]>(
  results: T,
): Result<{ [K in keyof T]: T[K] extends Result<infer U> ? U : never }> {
  const values: unknown[] = [];

  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }

  return ok(
    values as { [K in keyof T]: T[K] extends Result<infer U> ? U : never },
  );
}
