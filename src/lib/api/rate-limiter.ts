/**
 * Shared rate limiting utilities to reduce duplication across API routes
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
  failedCount?: number;
}

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  maxFailures?: number;
  lockoutThreshold?: number;
  lockoutDurationMs?: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  shouldDelay?: boolean;
}

/**
 * Generic in-memory rate limiter
 * Prevents unbounded memory growth with automatic cleanup
 */
export class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private cleanupCounter = 0;
  private readonly options: Required<RateLimitOptions>;
  private readonly CLEANUP_INTERVAL = 100;
  private readonly MAX_ENTRIES = 10_000;

  constructor(options: RateLimitOptions) {
    this.options = {
      windowMs: options.windowMs,
      maxRequests: options.maxRequests,
      maxFailures: options.maxFailures ?? Infinity,
      lockoutThreshold: options.lockoutThreshold ?? Infinity,
      lockoutDurationMs: options.lockoutDurationMs ?? 0,
    };
  }

  /**
   * Check if request is allowed under rate limit
   */
  check(userId: string): RateLimitResult {
    const now = Date.now();
    const limit = this.limits.get(userId);

    // Cleanup expired entries periodically
    this.cleanupCounter++;
    const shouldCleanup =
      this.cleanupCounter >= this.CLEANUP_INTERVAL ||
      this.limits.size >= this.MAX_ENTRIES;

    if (shouldCleanup) {
      this.cleanupCounter = 0;
      this.cleanup(now);
    }

    // No limit or expired - create new entry
    if (!limit || now > limit.resetAt) {
      this.limits.set(userId, {
        count: 1,
        resetAt: now + this.options.windowMs,
        failedCount: 0,
      });
      return { allowed: true, shouldDelay: false };
    }

    // Check lockout (if configured)
    if (
      limit.failedCount !== undefined &&
      limit.failedCount >= this.options.lockoutThreshold
    ) {
      const lockoutEnd = limit.resetAt + this.options.lockoutDurationMs;
      if (now < lockoutEnd) {
        return {
          allowed: false,
          retryAfterMs: lockoutEnd - now,
          shouldDelay: false,
        };
      }
      // Lockout expired - reset
      this.limits.set(userId, {
        count: 1,
        resetAt: now + this.options.windowMs,
        failedCount: 0,
      });
      return { allowed: true, shouldDelay: false };
    }

    // Check rate limit
    if (limit.count >= this.options.maxRequests) {
      return {
        allowed: false,
        retryAfterMs: limit.resetAt - now,
        shouldDelay: false,
      };
    }

    limit.count++;
    return {
      allowed: true,
      shouldDelay:
        limit.failedCount !== undefined &&
        limit.failedCount >= this.options.maxFailures,
    };
  }

  /**
   * Record a failed attempt (for lockout functionality)
   */
  recordFailure(userId: string): void {
    const limit = this.limits.get(userId);
    if (limit) {
      limit.failedCount = (limit.failedCount ?? 0) + 1;
    }
  }

  /**
   * Reset failure count (on success)
   */
  recordSuccess(userId: string): void {
    const limit = this.limits.get(userId);
    if (limit) {
      limit.failedCount = 0;
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(now: number): void {
    for (const [key, value] of this.limits.entries()) {
      if (now > value.resetAt + (this.options.lockoutDurationMs || 0)) {
        this.limits.delete(key);
      }
    }
  }
}

/**
 * Pre-configured rate limiter for promo code validation
 */
export const promoCodeRateLimiter = new RateLimiter({
  windowMs: 60_000, // 1 minute
  maxRequests: 10,
  maxFailures: 5,
  lockoutThreshold: 15,
  lockoutDurationMs: 5 * 60_000, // 5 minutes
});

/**
 * Pre-configured rate limiter for checkout requests
 */
export const checkoutRateLimiter = new RateLimiter({
  windowMs: 60_000, // 1 minute
  maxRequests: 5,
});
