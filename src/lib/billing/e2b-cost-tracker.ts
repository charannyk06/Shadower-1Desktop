import { e2bUsageRepository, subscriptionRepository } from "lib/db/repository";
import logger from "logger";

/**
 * E2B cost constants
 */
const E2B_COSTS = {
  // Credits per minute of sandbox usage
  creditsPerMinute: 1,
  // Cost per credit in USD
  costPerCredit: 0.001,
  // Minimum credits per operation
  minCreditsPerOp: 1,
};

/**
 * Daily limits by subscription tier
 */
const DAILY_LIMITS = {
  free: 30, // 30 minutes/day free
  pro: 300, // 300 minutes/day pro
  ultra: 1000, // 1000 minutes/day ultra
};

/**
 * E2B Cost Tracker - Track sandbox usage and enforce quotas
 */
export class E2BCostTracker {
  /**
   * Track a sandbox session
   */
  async trackSession(data: {
    userId: string;
    sessionId: string;
    template?: string;
    durationMs: number;
    operationType?: "create" | "edit" | "execute" | "deploy";
  }): Promise<{
    creditsUsed: number;
    costUsd: number;
    remainingQuota: number;
  }> {
    const { userId, sessionId, template, durationMs, operationType } = data;

    // Calculate credits
    const creditsUsed = Math.max(
      E2B_COSTS.minCreditsPerOp,
      Math.ceil(durationMs / 60000) * E2B_COSTS.creditsPerMinute,
    );

    // Record usage
    await e2bUsageRepository.recordUsage({
      userId,
      sessionId,
      template,
      durationMs,
      operationType,
    });

    logger.info(
      `[E2B_COST] Tracked ${creditsUsed} credits for user ${userId} (${operationType || "unknown"})`,
    );

    // Get remaining quota
    const dailyUsage = await e2bUsageRepository.getDailyUsage(userId);
    const limit = await this.getUserLimit(userId);
    const remainingQuota = Math.max(0, limit - dailyUsage);

    return {
      creditsUsed,
      costUsd: creditsUsed * E2B_COSTS.costPerCredit,
      remainingQuota,
    };
  }

  /**
   * Check if user has available quota
   */
  async checkQuota(userId: string): Promise<{
    hasQuota: boolean;
    dailyUsage: number;
    dailyLimit: number;
    remainingQuota: number;
    tier: string;
  }> {
    const dailyUsage = await e2bUsageRepository.getDailyUsage(userId);
    const tier = await this.getUserTier(userId);
    const dailyLimit =
      DAILY_LIMITS[tier as keyof typeof DAILY_LIMITS] || DAILY_LIMITS.free;
    const remainingQuota = Math.max(0, dailyLimit - dailyUsage);

    return {
      hasQuota: remainingQuota > 0,
      dailyUsage,
      dailyLimit,
      remainingQuota,
      tier,
    };
  }

  /**
   * Enforce quota before sandbox operation
   * Throws if quota exceeded
   */
  async enforceQuota(userId: string): Promise<void> {
    const { hasQuota, dailyUsage, dailyLimit, tier } =
      await this.checkQuota(userId);

    if (!hasQuota) {
      logger.warn(
        `[E2B_COST] Quota exceeded for user ${userId}: ${dailyUsage}/${dailyLimit} (${tier})`,
      );
      throw new QuotaExceededError(
        `Daily E2B sandbox limit exceeded. You've used ${dailyUsage}/${dailyLimit} minutes today. ` +
          (tier === "free"
            ? "Upgrade to Pro for more sandbox time."
            : "Your quota will reset tomorrow."),
      );
    }
  }

  /**
   * Get user's subscription tier
   */
  private async getUserTier(userId: string): Promise<string> {
    try {
      const subscription = await subscriptionRepository.getByUserId(userId);
      return subscription?.tier || "free";
    } catch (error) {
      logger.warn(`[E2B_COST] Failed to get user tier: ${error}`);
      return "free";
    }
  }

  /**
   * Get user's daily limit based on tier
   */
  private async getUserLimit(userId: string): Promise<number> {
    const tier = await this.getUserTier(userId);
    return DAILY_LIMITS[tier as keyof typeof DAILY_LIMITS] || DAILY_LIMITS.free;
  }

  /**
   * Get usage statistics for a user
   */
  async getUsageStats(userId: string): Promise<{
    daily: { used: number; limit: number; percentage: number };
    monthly: { used: number; cost: number };
    tier: string;
    history: Array<{
      sessionId: string;
      template: string | null;
      durationMs: number;
      creditsUsed: string;
      operationType: string | null;
      createdAt: Date;
    }>;
  }> {
    const [dailyUsage, monthlyUsage, tier, history] = await Promise.all([
      e2bUsageRepository.getDailyUsage(userId),
      e2bUsageRepository.getMonthlyUsage(userId),
      this.getUserTier(userId),
      e2bUsageRepository.getUsageHistory(userId, 20),
    ]);

    const dailyLimit =
      DAILY_LIMITS[tier as keyof typeof DAILY_LIMITS] || DAILY_LIMITS.free;

    return {
      daily: {
        used: dailyUsage,
        limit: dailyLimit,
        percentage: Math.min(100, (dailyUsage / dailyLimit) * 100),
      },
      monthly: {
        used: monthlyUsage,
        cost: monthlyUsage * E2B_COSTS.costPerCredit,
      },
      tier,
      history: history.map((h) => ({
        sessionId: h.sessionId,
        template: h.template,
        durationMs: h.durationMs,
        creditsUsed: h.creditsUsed,
        operationType: h.operationType,
        createdAt: h.createdAt,
      })),
    };
  }

  /**
   * Check if user should be warned about quota
   */
  async shouldWarnAboutQuota(userId: string): Promise<{
    shouldWarn: boolean;
    percentage: number;
    message?: string;
  }> {
    const { dailyUsage, dailyLimit, tier } = await this.checkQuota(userId);
    const percentage = (dailyUsage / dailyLimit) * 100;

    if (percentage >= 100) {
      return {
        shouldWarn: true,
        percentage,
        message: `You've reached your daily sandbox limit (${dailyLimit} minutes). ${
          tier === "free" ? "Upgrade for more." : "Resets tomorrow."
        }`,
      };
    }

    if (percentage >= 80) {
      return {
        shouldWarn: true,
        percentage,
        message: `You've used ${Math.round(percentage)}% of your daily sandbox quota.`,
      };
    }

    return { shouldWarn: false, percentage };
  }
}

/**
 * Custom error for quota exceeded
 */
export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

// Singleton instance
export const e2bCostTracker = new E2BCostTracker();
