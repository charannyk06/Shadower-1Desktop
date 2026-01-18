/**
 * E2B Quota Middleware
 *
 * Enforces E2B sandbox usage quotas before operations.
 * Prevents quota exceeded errors and provides user-friendly messages.
 */

import {
  e2bCostTracker,
  QuotaExceededError,
} from "lib/billing/e2b-cost-tracker";
import logger from "logger";

/**
 * Check E2B quota before sandbox operation
 * Throws QuotaExceededError if quota exceeded
 */
export async function checkE2BQuota(userId: string): Promise<void> {
  try {
    await e2bCostTracker.enforceQuota(userId);
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      logger.warn(`[E2B_QUOTA] Quota exceeded for user ${userId}`);
      throw error;
    }
    // Re-throw unexpected errors
    throw error;
  }
}

/**
 * Get quota status for a user (non-throwing)
 * Returns quota information without enforcing
 */
export async function getE2BQuotaStatus(userId: string): Promise<{
  hasQuota: boolean;
  dailyUsage: number;
  dailyLimit: number;
  remainingQuota: number;
  tier: string;
  shouldWarn: boolean;
  warningMessage?: string;
}> {
  const quota = await e2bCostTracker.checkQuota(userId);
  const warning = await e2bCostTracker.shouldWarnAboutQuota(userId);

  return {
    ...quota,
    shouldWarn: warning.shouldWarn,
    warningMessage: warning.message,
  };
}

/**
 * Wrap a sandbox operation with quota check
 * Automatically checks quota before execution and tracks usage after
 */
export async function withE2BQuota<T>(
  userId: string,
  operation: () => Promise<T>,
  options?: {
    operationType?: "create" | "edit" | "execute" | "deploy";
    template?: string;
  },
): Promise<T> {
  // Check quota before operation
  await checkE2BQuota(userId);

  const startTime = Date.now();
  let sessionId: string | undefined;

  try {
    const result = await operation();

    // If result has sessionId, track usage
    if (result && typeof result === "object" && "sessionId" in result) {
      sessionId = result.sessionId as string;
    }

    return result;
  } finally {
    // Track usage if we have session info
    if (sessionId) {
      const durationMs = Date.now() - startTime;
      e2bCostTracker
        .trackSession({
          userId,
          sessionId,
          template: options?.template,
          durationMs,
          operationType: options?.operationType,
        })
        .catch((error) => {
          logger.error(`[E2B_QUOTA] Failed to track usage: ${error}`);
        });
    }
  }
}
