import { subscriptionRepository, userRepository } from "@/lib/db/repository";
import { TOKEN_PACKS, getPriceDollars } from "./pricing";
import type { SubscriptionTier } from "./types";

/**
 * Cost Tracker - Estimates actual API costs per user for margin analysis
 *
 * This module helps track whether users are profitable by estimating
 * the actual API costs we incur vs the revenue we receive.
 *
 * IMPORTANT: These are ESTIMATES based on average pricing.
 * Actual costs may vary based on input/output token ratios.
 */

// Average API costs per 1M tokens (input/output average)
const MODEL_COSTS_PER_MTOK: Record<string, number> = {
  // Ultra tier models ($15+)
  "opus-4.5": 15,
  "opus-4.1": 47.5,
  o1: 40,
  "o1-preview": 25,
  "gpt-5": 20,

  // Premium tier models ($5-15)
  "sonnet-4.5": 9,
  sonnet: 9,
  "gpt-4o": 10,
  "gpt-4.1": 10,
  "grok-3": 9,
  "grok-4": 9,
  "gemini-pro": 6,

  // Standard tier models ($1-4)
  "haiku-4.5": 3,
  haiku: 3,
  "gemini-2.5-flash": 1.4,
  o3: 1,
  o4: 1,
  "grok-2": 3,

  // Budget tier models (<$1)
  "gpt-4o-mini": 0.38,
  "gpt-4.1-mini": 0.38,
  "grok-4.1": 0.35,
  "gemini-flash": 0.25,
  llama: 0.5,
  mistral: 0.5,
  qwen: 0.4,
  deepseek: 0.3,

  // Free tier (no cost)
  ":free": 0,
  groq: 0,
  ollama: 0,
};

// Revenue per tier per month (from centralized pricing config)
const TIER_REVENUE: Record<SubscriptionTier, number> = {
  free: getPriceDollars("free", "monthly"),
  pro: getPriceDollars("pro", "monthly"),
  ultra: getPriceDollars("ultra", "monthly"),
};

// Estimated non-token costs
const OTHER_COSTS = {
  // Image generation costs vary by model and quality:
  // - DALL-E 3 Standard 1024x1024: $0.04
  // - DALL-E 3 HD 1024x1024: $0.08
  // - DALL-E 3 HD 1024x1792: $0.12
  // - GPT-image-1 Low: $0.01, Medium: $0.04, High: $0.17
  // Using $0.10 average to account for HD and GPT-image-1 usage
  imagePerUnit: 0.1,

  // E2B sandbox: $0.000028/second for 2 vCPU
  // ~$0.10/hour, typical execution 10-60 seconds = $0.0003-$0.002
  // Using $0.002 as conservative estimate for longer executions
  sandboxPerExec: 0.002,

  // OpenAI Realtime API - THIS IS CRITICAL:
  // - Audio INPUT: $0.06/minute
  // - Audio OUTPUT: $0.24/minute
  // For a conversation (50/50 split): ($0.06 + $0.24) / 2 = $0.15/minute each way
  // TOTAL for bidirectional conversation: $0.30/minute
  voicePerMinute: 0.3,
};

/**
 * Estimate cost per 1M tokens for a model
 */
function getModelCostPerMTok(model: string): number {
  const modelLower = model.toLowerCase();

  // Check for exact matches first
  for (const [pattern, cost] of Object.entries(MODEL_COSTS_PER_MTOK)) {
    if (modelLower.includes(pattern)) {
      return cost;
    }
  }

  // Check for free models
  if (modelLower.endsWith(":free")) return 0;

  // Default to standard tier pricing for unknown models
  return 2;
}

export interface UserCostSummary {
  userId: string;
  email?: string;
  tier: SubscriptionTier;
  periodStart: Date;
  periodEnd: Date;

  // Token costs
  totalTokens: number;
  estimatedTokenCost: number;
  modelBreakdown: Array<{
    model: string;
    tokens: number;
    estimatedCost: number;
  }>;

  // Other costs
  imageCost: number;
  sandboxCost: number;
  voiceCost: number;

  // Total
  totalEstimatedCost: number;
  revenue: number;
  margin: number;
  marginPercent: number;
  isProfitable: boolean;
}

/**
 * Calculate estimated costs for a user
 */
export async function calculateUserCost(
  userId: string,
): Promise<UserCostSummary> {
  const subscription = await subscriptionRepository.getByUserId(userId);
  const tier: SubscriptionTier =
    (subscription?.tier as SubscriptionTier) || "free";

  // Get billing period
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Get user stats
  const userStats = await userRepository.getUserStats(userId);
  const usageCounts = await userRepository.getUsageCounts(
    userId,
    periodStart,
    periodEnd,
  );

  // Calculate token costs by model
  const modelBreakdown: UserCostSummary["modelBreakdown"] = [];
  let totalTokenCost = 0;
  let totalTokens = 0;

  for (const stat of userStats.modelStats) {
    const costPerMTok = getModelCostPerMTok(stat.model);
    const cost = (stat.totalTokens / 1_000_000) * costPerMTok;
    modelBreakdown.push({
      model: stat.model,
      tokens: stat.totalTokens,
      estimatedCost: cost,
    });
    totalTokenCost += cost;
    totalTokens += stat.totalTokens;
  }

  // Calculate other costs
  const imageCost =
    (usageCounts.image_generation || 0) * OTHER_COSTS.imagePerUnit;
  const sandboxCost =
    (usageCounts.sandbox_execution || 0) * OTHER_COSTS.sandboxPerExec;
  const voiceCost =
    (usageCounts.voice_minutes || 0) * OTHER_COSTS.voicePerMinute;

  const totalEstimatedCost =
    totalTokenCost + imageCost + sandboxCost + voiceCost;

  // Calculate revenue (subscription + any token packs)
  const purchasedTokens = Number(subscription?.purchasedTokens || 0);
  // Estimate revenue from token packs using actual pricing from config
  // 500K pack = $1.99 (TOKEN_PACKS["500k"].priceCents / 100)
  const basePackPrice = TOKEN_PACKS["500k"].priceCents / 100;
  const basePackCredits = TOKEN_PACKS["500k"].credits;
  const tokenPackRevenue = (purchasedTokens / basePackCredits) * basePackPrice;
  const revenue = TIER_REVENUE[tier] + tokenPackRevenue;

  const margin = revenue - totalEstimatedCost;
  const marginPercent = revenue > 0 ? (margin / revenue) * 100 : 0;

  return {
    userId,
    tier,
    periodStart,
    periodEnd,
    totalTokens,
    estimatedTokenCost: totalTokenCost,
    modelBreakdown,
    imageCost,
    sandboxCost,
    voiceCost,
    totalEstimatedCost,
    revenue,
    margin,
    marginPercent,
    isProfitable: margin >= 0,
  };
}

export interface CostAlert {
  userId: string;
  email?: string;
  tier: SubscriptionTier;
  totalCost: number;
  revenue: number;
  margin: number;
  marginPercent: number;
  severity: "warning" | "critical";
  reason: string;
}

/**
 * Get cost alerts for users with negative or low margins
 * For admin monitoring
 */
export async function getCostAlerts(options?: {
  warningThreshold?: number; // Default: 10% margin
  criticalThreshold?: number; // Default: 0% margin (loss)
  limit?: number;
}): Promise<CostAlert[]> {
  const {
    warningThreshold = 10,
    criticalThreshold = 0,
    limit = 50,
  } = options || {};

  // Get all active subscriptions
  const subscriptions = await subscriptionRepository.getAllActive();
  const alerts: CostAlert[] = [];

  for (const sub of subscriptions) {
    if (!sub.userId) continue;

    try {
      const cost = await calculateUserCost(sub.userId);

      // Only flag paid users (free users expected to have 0 margin)
      if (cost.tier === "free") continue;

      if (cost.marginPercent < warningThreshold) {
        alerts.push({
          userId: sub.userId,
          tier: cost.tier,
          totalCost: cost.totalEstimatedCost,
          revenue: cost.revenue,
          margin: cost.margin,
          marginPercent: cost.marginPercent,
          severity:
            cost.marginPercent < criticalThreshold ? "critical" : "warning",
          reason:
            cost.marginPercent < criticalThreshold
              ? `Negative margin: -$${Math.abs(cost.margin).toFixed(2)}`
              : `Low margin: ${cost.marginPercent.toFixed(1)}%`,
        });
      }
    } catch (error) {
      console.error(`Error calculating cost for user ${sub.userId}:`, error);
    }

    if (alerts.length >= limit) break;
  }

  // Sort by margin (most negative first)
  alerts.sort((a, b) => a.margin - b.margin);

  return alerts;
}

/**
 * Get aggregate cost stats for all users
 */
export async function getAggregateCostStats(): Promise<{
  totalUsers: number;
  totalRevenue: number;
  totalEstimatedCost: number;
  averageMargin: number;
  profitableUsers: number;
  unprofitableUsers: number;
  byTier: Record<
    SubscriptionTier,
    {
      users: number;
      revenue: number;
      cost: number;
      margin: number;
    }
  >;
}> {
  const subscriptions = await subscriptionRepository.getAllActive();

  const stats = {
    totalUsers: 0,
    totalRevenue: 0,
    totalEstimatedCost: 0,
    profitableUsers: 0,
    unprofitableUsers: 0,
    byTier: {
      free: { users: 0, revenue: 0, cost: 0, margin: 0 },
      pro: { users: 0, revenue: 0, cost: 0, margin: 0 },
      ultra: { users: 0, revenue: 0, cost: 0, margin: 0 },
    } as Record<
      SubscriptionTier,
      { users: number; revenue: number; cost: number; margin: number }
    >,
  };

  for (const sub of subscriptions) {
    if (!sub.userId) continue;

    try {
      const cost = await calculateUserCost(sub.userId);
      stats.totalUsers++;
      stats.totalRevenue += cost.revenue;
      stats.totalEstimatedCost += cost.totalEstimatedCost;

      if (cost.isProfitable) {
        stats.profitableUsers++;
      } else {
        stats.unprofitableUsers++;
      }

      const tierStats = stats.byTier[cost.tier];
      tierStats.users++;
      tierStats.revenue += cost.revenue;
      tierStats.cost += cost.totalEstimatedCost;
      tierStats.margin += cost.margin;
    } catch {
      // Skip users with errors
    }
  }

  return {
    ...stats,
    averageMargin:
      stats.totalRevenue > 0
        ? ((stats.totalRevenue - stats.totalEstimatedCost) /
            stats.totalRevenue) *
          100
        : 0,
  };
}
