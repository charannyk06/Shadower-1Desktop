/**
 * Retry utility for handling database deadlocks and transient errors
 */

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  retryableErrors?: string[];
}

/**
 * Retry a function with exponential backoff
 * Handles database deadlocks (code 40P01) and other transient errors
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 100,
    maxDelay = 2000,
    retryableErrors = ["40P01"], // PostgreSQL deadlock error code
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if error is retryable
      const isRetryable =
        retryableErrors.includes(error?.code) ||
        retryableErrors.includes(error?.errno?.toString());

      // Don't retry on last attempt or if error is not retryable
      if (attempt === maxRetries - 1 || !isRetryable) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
