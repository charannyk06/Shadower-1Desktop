/**
 * Rate Limiting Middleware for Browser/Desktop Automation
 *
 * Implements sliding window rate limiting with Redis backing.
 * Falls back to in-memory storage if Redis is unavailable.
 */

import { SafeRedisCache } from "lib/cache/safe-redis-cache";
import { headers } from "next/headers";
import { BrowserConfig } from "../config/browser-config";
import { DesktopConfig } from "../config/desktop-config";
import { AutomationErrorCode, Result, err, ok } from "../utils/result";

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number; // seconds until reset
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

// In-memory fallback store
const memoryStore = new Map<string, { count: number; resetAt: number }>();

// Redis cache instance (lazy-loaded)
let redisCache: SafeRedisCache | null = null;

function getRedisCache(): SafeRedisCache {
  if (!redisCache) {
    redisCache = new SafeRedisCache();
  }
  return redisCache;
}

/**
 * Get client identifier for rate limiting
 */
async function getClientIdentifier(userId?: string): Promise<string> {
  if (userId) {
    return `user:${userId}`;
  }

  // Fallback to IP address
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  const realIp = headersList.get("x-real-ip");

  const ip = forwardedFor?.split(",")[0]?.trim() || realIp || "unknown";
  return `ip:${ip}`;
}

/**
 * Check rate limit using Redis
 */
async function checkRateLimitRedis(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const cache = getRedisCache();
  const now = Date.now();

  try {
    // Get current count from cache
    const cached = await cache.get<{ count: number; resetAt: number }>(key);

    if (!cached || cached.resetAt < now) {
      // Start new window
      const resetAt = now + config.windowMs;
      await cache.set(key, { count: 1, resetAt }, config.windowMs / 1000);

      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetAt: new Date(resetAt),
      };
    }

    if (cached.count >= config.maxRequests) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((cached.resetAt - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(cached.resetAt),
        retryAfter,
      };
    }

    // Increment count
    const newCount = cached.count + 1;
    await cache.set(
      key,
      { count: newCount, resetAt: cached.resetAt },
      (cached.resetAt - now) / 1000,
    );

    return {
      allowed: true,
      remaining: config.maxRequests - newCount,
      resetAt: new Date(cached.resetAt),
    };
  } catch (error) {
    // Fallback to memory on Redis error
    console.warn("Rate limit Redis error, falling back to memory:", error);
    return checkRateLimitMemory(key, config);
  }
}

/**
 * Check rate limit using in-memory store (fallback)
 */
function checkRateLimitMemory(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || entry.resetAt < now) {
    // Start new window
    const resetAt = now + config.windowMs;
    memoryStore.set(key, { count: 1, resetAt });

    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: new Date(resetAt),
    };
  }

  if (entry.count >= config.maxRequests) {
    // Rate limit exceeded
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(entry.resetAt),
      retryAfter,
    };
  }

  // Increment count
  entry.count++;

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: new Date(entry.resetAt),
  };
}

/**
 * Check rate limit
 */
export async function checkRateLimit(
  userId: string | undefined,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const clientId = await getClientIdentifier(userId);
  const key = `${config.keyPrefix}:${clientId}`;

  return checkRateLimitRedis(key, config);
}

/**
 * Rate limit for browser session creation
 */
export async function checkBrowserSessionRateLimit(
  userId?: string,
): Promise<Result<RateLimitResult>> {
  const result = await checkRateLimit(userId, {
    windowMs: BrowserConfig.rateLimit.windowMs,
    maxRequests: BrowserConfig.rateLimit.maxSessionCreations,
    keyPrefix: "ratelimit:browser:session",
  });

  if (!result.allowed) {
    return err(
      AutomationErrorCode.RATE_LIMIT_EXCEEDED,
      `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      {
        details: {
          retryAfter: result.retryAfter,
          resetAt: result.resetAt.toISOString(),
        },
        retryable: true,
      },
    );
  }

  return ok(result);
}

/**
 * Rate limit for browser screenshots
 */
export async function checkBrowserScreenshotRateLimit(
  userId?: string,
): Promise<Result<RateLimitResult>> {
  const result = await checkRateLimit(userId, {
    windowMs: BrowserConfig.rateLimit.windowMs,
    maxRequests: BrowserConfig.rateLimit.maxScreenshots,
    keyPrefix: "ratelimit:browser:screenshot",
  });

  if (!result.allowed) {
    return err(
      AutomationErrorCode.RATE_LIMIT_EXCEEDED,
      `Screenshot rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      {
        details: {
          retryAfter: result.retryAfter,
          resetAt: result.resetAt.toISOString(),
        },
        retryable: true,
      },
    );
  }

  return ok(result);
}

/**
 * Rate limit for browser actions
 */
export async function checkBrowserActionRateLimit(
  userId?: string,
): Promise<Result<RateLimitResult>> {
  const result = await checkRateLimit(userId, {
    windowMs: BrowserConfig.rateLimit.windowMs,
    maxRequests: BrowserConfig.rateLimit.maxActions,
    keyPrefix: "ratelimit:browser:action",
  });

  if (!result.allowed) {
    return err(
      AutomationErrorCode.RATE_LIMIT_EXCEEDED,
      `Action rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      {
        details: {
          retryAfter: result.retryAfter,
          resetAt: result.resetAt.toISOString(),
        },
        retryable: true,
      },
    );
  }

  return ok(result);
}

/**
 * Rate limit for desktop session creation
 */
export async function checkDesktopSessionRateLimit(
  userId?: string,
): Promise<Result<RateLimitResult>> {
  const result = await checkRateLimit(userId, {
    windowMs: DesktopConfig.rateLimit.windowMs,
    maxRequests: DesktopConfig.rateLimit.maxSessionCreations,
    keyPrefix: "ratelimit:desktop:session",
  });

  if (!result.allowed) {
    return err(
      AutomationErrorCode.RATE_LIMIT_EXCEEDED,
      `Desktop session rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      {
        details: {
          retryAfter: result.retryAfter,
          resetAt: result.resetAt.toISOString(),
        },
        retryable: true,
      },
    );
  }

  return ok(result);
}

/**
 * Rate limit for desktop screenshots
 */
export async function checkDesktopScreenshotRateLimit(
  userId?: string,
): Promise<Result<RateLimitResult>> {
  const result = await checkRateLimit(userId, {
    windowMs: DesktopConfig.rateLimit.windowMs,
    maxRequests: DesktopConfig.rateLimit.maxScreenshots,
    keyPrefix: "ratelimit:desktop:screenshot",
  });

  if (!result.allowed) {
    return err(
      AutomationErrorCode.RATE_LIMIT_EXCEEDED,
      `Desktop screenshot rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      {
        details: {
          retryAfter: result.retryAfter,
          resetAt: result.resetAt.toISOString(),
        },
        retryable: true,
      },
    );
  }

  return ok(result);
}

/**
 * Rate limit for desktop actions
 */
export async function checkDesktopActionRateLimit(
  userId?: string,
): Promise<Result<RateLimitResult>> {
  const result = await checkRateLimit(userId, {
    windowMs: DesktopConfig.rateLimit.windowMs,
    maxRequests: DesktopConfig.rateLimit.maxActions,
    keyPrefix: "ratelimit:desktop:action",
  });

  if (!result.allowed) {
    return err(
      AutomationErrorCode.RATE_LIMIT_EXCEEDED,
      `Desktop action rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      {
        details: {
          retryAfter: result.retryAfter,
          resetAt: result.resetAt.toISOString(),
        },
        retryable: true,
      },
    );
  }

  return ok(result);
}

/**
 * Add rate limit headers to response
 */
export function addRateLimitHeaders(
  headers: Headers,
  result: RateLimitResult,
  limit: number,
): void {
  headers.set("X-RateLimit-Limit", limit.toString());
  headers.set("X-RateLimit-Remaining", result.remaining.toString());
  headers.set(
    "X-RateLimit-Reset",
    Math.floor(result.resetAt.getTime() / 1000).toString(),
  );

  if (result.retryAfter) {
    headers.set("Retry-After", result.retryAfter.toString());
  }
}

/**
 * Clean up old entries from memory store
 * Called by cron job at /api/cron/cleanup
 */
export function cleanupMemoryStore(): void {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.resetAt < now) {
      memoryStore.delete(key);
    }
  }
}

// Note: Cleanup is handled by Vercel cron job at /api/cron/cleanup
// This avoids module-level setInterval which doesn't work reliably in serverless
