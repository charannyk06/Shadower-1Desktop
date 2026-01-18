/**
 * Usage Forecasting Service
 *
 * Provides usage projections and recommendations based on historical data.
 */

import { subscriptionRepository } from "lib/db/repository";
import { type SubscriptionTier, TIER_LIMITS } from "./types";

export type UsageTrend = "increasing" | "stable" | "decreasing";

export interface UsageForecast {
  /** Current month's usage so far */
  currentUsage: number;
  /** Monthly limit for the user's tier */
  monthlyLimit: number;
  /** Projected total usage by end of month */
  projectedMonthlyUsage: number;
  /** Percentage of limit projected to be used */
  projectedUsagePercent: number;
  /** Date when user will hit their limit (null if not projected to hit) */
  projectedLimitDate: Date | null;
  /** Days until limit is reached (null if not projected to hit) */
  daysUntilLimit: number | null;
  /** Average daily usage over the analysis period */
  dailyAverage: number;
  /** Usage trend based on recent data */
  trend: UsageTrend;
  /** Recommendation based on forecast */
  recommendation: string;
  /** User's current tier */
  tier: SubscriptionTier;
  /** Days remaining in current billing period */
  daysRemaining: number;
  /** Analysis period in days */
  analysisPeriod: number;
}

/**
 * Get daily usage for a specific date range
 */
async function getDailyUsage(
  userId: string,
  days: number,
): Promise<{ date: Date; credits: number }[]> {
  const now = new Date();
  const dailyUsage: { date: Date; credits: number }[] = [];

  // Get usage for each day
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(now.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const summary = await subscriptionRepository.getUsageSummary(
      userId,
      dayStart,
      dayEnd,
    );

    dailyUsage.push({
      date: dayStart,
      credits: summary.total_credits || 0,
    });
  }

  return dailyUsage;
}

/**
 * Calculate usage trend using linear regression
 */
function calculateTrend(dailyCredits: number[]): UsageTrend {
  if (dailyCredits.length < 3) return "stable";

  // Simple linear regression to find slope
  const n = dailyCredits.length;
  const xs = dailyCredits.map((_, i) => i);
  const ys = dailyCredits;

  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumXX = xs.reduce((acc, x) => acc + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

  // Calculate average for scale
  const avgDaily = sumY / n;

  // Slope threshold: 10% of average is considered significant change
  const threshold = avgDaily * 0.1;

  if (slope > threshold) return "increasing";
  if (slope < -threshold) return "decreasing";
  return "stable";
}

/**
 * Get days remaining in current month
 */
function getDaysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.getDate() - now.getDate();
}

/**
 * Get start of current month
 */
function getMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Generate recommendation based on forecast
 */
function generateRecommendation(
  projectedUsage: number,
  limit: number,
  tier: SubscriptionTier,
  trend: UsageTrend,
  daysUntilLimit: number | null,
): string {
  const percentOfLimit = (projectedUsage / limit) * 100;

  // Projected to exceed limit significantly
  if (percentOfLimit > 120) {
    if (tier === "ultra") {
      return "You're projected to significantly exceed your limit. Consider purchasing a token pack for additional credits.";
    }
    if (tier === "pro") {
      return "Your usage is very high. Consider upgrading to Ultra for 2.9x more credits.";
    }
    return "Consider upgrading to Pro or Ultra for higher limits.";
  }

  // Projected to exceed limit
  if (percentOfLimit > 100) {
    if (daysUntilLimit !== null && daysUntilLimit <= 7) {
      if (tier === "ultra") {
        return `You'll reach your limit in about ${daysUntilLimit} days. Consider buying a token pack.`;
      }
      return `You'll reach your limit in about ${daysUntilLimit} days. Consider upgrading your plan.`;
    }

    if (tier === "free") {
      return "You're on track to exceed your free limit. Upgrade to Pro for 30x more credits.";
    }
    if (tier === "pro") {
      return "You may exceed your limit. Consider upgrading to Ultra for 2.9x more credits.";
    }
    return "You may exceed your limit. Consider purchasing additional token packs.";
  }

  // Will use most of their limit
  if (percentOfLimit > 80) {
    if (trend === "increasing") {
      return "Usage is trending up. Monitor your usage to avoid exceeding limits.";
    }
    return "You're on track to use most of your monthly credits.";
  }

  // Comfortable usage
  if (percentOfLimit > 50) {
    return "Your usage is on track. You have plenty of credits remaining.";
  }

  // Low usage
  if (trend === "decreasing") {
    return "Your usage is trending down. You have significant credits available.";
  }

  return "You're well within your limits with plenty of credits available.";
}

/**
 * Generate usage forecast for a user
 */
export async function generateForecast(userId: string): Promise<UsageForecast> {
  // Get subscription info
  const subscription = await subscriptionRepository.getByUserId(userId);
  const tier: SubscriptionTier = subscription?.tier || "free";
  const limits = TIER_LIMITS[tier];

  // Get current month's usage
  const monthStart = getMonthStart();
  const now = new Date();
  const currentMonthSummary = await subscriptionRepository.getUsageSummary(
    userId,
    monthStart,
    now,
  );
  const currentUsage = currentMonthSummary.total_credits || 0;

  // Get daily history for analysis (14 days)
  const analysisPeriod = 14;
  const dailyUsage = await getDailyUsage(userId, analysisPeriod);
  const dailyCredits = dailyUsage.map((d) => d.credits);

  // Calculate daily average
  const totalDays = dailyCredits.length || 1;
  const totalUsageInPeriod = dailyCredits.reduce((a, b) => a + b, 0);
  const dailyAverage =
    totalDays > 0 ? Math.round(totalUsageInPeriod / totalDays) : 0;

  // Calculate trend
  const trend = calculateTrend(dailyCredits);

  // Days remaining in month
  const daysRemaining = getDaysRemainingInMonth();

  // Project end-of-month usage
  const projectedMonthlyUsage = Math.round(
    currentUsage + dailyAverage * daysRemaining,
  );

  // Calculate projected usage percent
  const projectedUsagePercent = Math.round(
    (projectedMonthlyUsage / limits.monthlyCredits) * 100,
  );

  // Calculate when limit will be hit
  let projectedLimitDate: Date | null = null;
  let daysUntilLimit: number | null = null;

  if (dailyAverage > 0) {
    const creditsRemaining = limits.monthlyCredits - currentUsage;
    if (creditsRemaining > 0) {
      const daysToHitLimit = Math.ceil(creditsRemaining / dailyAverage);
      if (daysToHitLimit <= daysRemaining) {
        projectedLimitDate = new Date();
        projectedLimitDate.setDate(
          projectedLimitDate.getDate() + daysToHitLimit,
        );
        daysUntilLimit = daysToHitLimit;
      }
    } else {
      // Already at or over limit
      projectedLimitDate = now;
      daysUntilLimit = 0;
    }
  }

  // Generate recommendation
  const recommendation = generateRecommendation(
    projectedMonthlyUsage,
    limits.monthlyCredits,
    tier,
    trend,
    daysUntilLimit,
  );

  return {
    currentUsage,
    monthlyLimit: limits.monthlyCredits,
    projectedMonthlyUsage,
    projectedUsagePercent,
    projectedLimitDate,
    daysUntilLimit,
    dailyAverage,
    trend,
    recommendation,
    tier,
    daysRemaining,
    analysisPeriod,
  };
}

/**
 * Format credits for display (e.g., 1,000,000 -> "1M")
 */
export function formatCredits(credits: number): string {
  if (credits >= 1_000_000) {
    const millions = credits / 1_000_000;
    return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (credits >= 1_000) {
    const thousands = credits / 1_000;
    return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
  }
  return credits.toString();
}

/**
 * Get trend emoji for display
 */
export function getTrendEmoji(trend: UsageTrend): string {
  switch (trend) {
    case "increasing":
      return "📈";
    case "decreasing":
      return "📉";
    default:
      return "➡️";
  }
}

/**
 * Get trend label for display
 */
export function getTrendLabel(trend: UsageTrend): string {
  switch (trend) {
    case "increasing":
      return "Trending up";
    case "decreasing":
      return "Trending down";
    default:
      return "Stable";
  }
}
