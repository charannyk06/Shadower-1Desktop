import { subscriptionRepository } from "@/lib/db/repository";
import { getMonthBoundaries } from "./date-utils";
import { DEFAULT_MULTIPLIER, getModelMultiplier } from "./model-multipliers";
import {
  SERVICE_CREDIT_COSTS,
  type SubscriptionTier,
  TIER_LIMITS,
  getImageCredits,
} from "./types";

export type CreditLimitCheckResult = {
  allowed: boolean;
  reason?: string;
  usage: number;
  limit: number;
  tier: SubscriptionTier;
  creditsRequired: number;
};

export type TokenLimitCheckResult = CreditLimitCheckResult & {
  multiplier: number;
  effectiveTokens: number;
  actualTokens: number;
};

// Legacy type for backwards compatibility
export type LimitCheckResult = {
  allowed: boolean;
  reason?: string;
  usage: number;
  limit: number;
  tier: SubscriptionTier;
};

/**
 * Get total credits used in a time period
 */
async function getCreditsUsedForPeriod(
  userId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const usageSummary = await subscriptionRepository.getUsageSummary(
    userId,
    start,
    end,
  );
  return usageSummary.total_credits || 0;
}

/**
 * UNIFIED CREDITS CHECK
 *
 * This is the primary function for checking if a user can consume credits.
 * All services (LLM tokens, images, voice, sandbox, etc.) use this function.
 *
 * @param userId - User ID
 * @param creditsRequired - Number of credits to consume
 */
export async function checkCreditsLimit(
  userId: string,
  creditsRequired: number,
): Promise<CreditLimitCheckResult> {
  // Get user's subscription
  const subscription = await subscriptionRepository.getByUserId(userId);
  const tier: SubscriptionTier =
    (subscription?.tier as SubscriptionTier) || "free";

  // Get current month's usage
  const { start, end } = getMonthBoundaries();
  const creditsUsed = await getCreditsUsedForPeriod(userId, start, end);

  // Calculate effective limit (tier limit + any purchased credits)
  const purchasedCredits = Number(subscription?.purchasedTokens || "0");
  const purchasedUsed = Number(subscription?.purchasedTokensUsed || "0");
  const purchasedRemaining = Math.max(0, purchasedCredits - purchasedUsed);
  const limit = TIER_LIMITS[tier].monthlyCredits + purchasedRemaining;

  // Check monthly limit
  const wouldExceed = creditsUsed + creditsRequired > limit;

  return {
    allowed: !wouldExceed,
    reason: wouldExceed
      ? `Credit limit reached (${creditsUsed.toLocaleString()}/${limit.toLocaleString()}). Upgrade your plan or purchase more credits.`
      : undefined,
    usage: creditsUsed,
    limit,
    tier,
    creditsRequired,
  };
}

/**
 * Check token/LLM limit with model-specific multipliers
 *
 * LLM tokens use the model multiplier system:
 * - Free models (0x multiplier): No credits consumed for Pro/Ultra users
 * - Standard models (1-2x): 1-2 credits per token
 * - Premium models (6x+): 6+ credits per token
 *
 * @param userId - User ID
 * @param estimatedTokens - Actual tokens to be consumed
 * @param model - Model name (optional, defaults to 2x if not provided)
 * @param provider - Provider name (optional)
 */
export async function checkTokenLimit(
  userId: string,
  estimatedTokens: number = 0,
  model?: string,
  provider?: string,
): Promise<TokenLimitCheckResult> {
  // Get user's subscription tier for free model handling
  const subscription = await subscriptionRepository.getByUserId(userId);
  const subscriptionTier: SubscriptionTier =
    (subscription?.tier as SubscriptionTier) || "free";

  // Get multiplier based on model AND subscription tier
  // Free models (OpenRouter :free, Groq, Ollama) are 0x for Pro/Ultra users!
  const multiplier = model
    ? getModelMultiplier(model, provider, subscriptionTier)
    : DEFAULT_MULTIPLIER;

  // Calculate effective credits (tokens × multiplier)
  // For free models with paid users, this will be 0!
  const effectiveCredits = Math.ceil(estimatedTokens * multiplier);

  // FREE MODEL BYPASS: If effectiveCredits is 0 (free models for Pro/Ultra),
  // skip ALL limit checks - these models cost us nothing!
  if (effectiveCredits === 0) {
    return {
      allowed: true,
      usage: 0,
      limit: TIER_LIMITS[subscriptionTier].monthlyCredits,
      tier: subscriptionTier,
      creditsRequired: 0,
      multiplier,
      effectiveTokens: 0,
      actualTokens: estimatedTokens,
    };
  }

  // Use unified credits check
  const result = await checkCreditsLimit(userId, effectiveCredits);

  return {
    ...result,
    multiplier,
    effectiveTokens: effectiveCredits,
    actualTokens: estimatedTokens,
  };
}

/**
 * Check image generation limit using credits system
 *
 * @param userId - User ID
 * @param model - Image model name (affects credit cost)
 * @param resolution - Image resolution (for 4K detection on Gemini models)
 */
export async function checkImageLimit(
  userId: string,
  model?: string,
  resolution?: string,
): Promise<CreditLimitCheckResult> {
  const credits = getImageCredits(model, resolution);
  return checkCreditsLimit(userId, credits);
}

/**
 * Check sandbox execution limit using credits system
 */
export async function checkSandboxLimit(
  userId: string,
): Promise<CreditLimitCheckResult> {
  return checkCreditsLimit(userId, SERVICE_CREDIT_COSTS.sandboxPerExecution);
}

/**
 * Check workflow execution limit using credits system
 */
export async function checkWorkflowLimit(
  userId: string,
): Promise<CreditLimitCheckResult> {
  return checkCreditsLimit(userId, SERVICE_CREDIT_COSTS.workflowPerRun);
}

/**
 * Check MCP tool call limit using credits system
 */
export async function checkMcpLimit(
  userId: string,
): Promise<CreditLimitCheckResult> {
  return checkCreditsLimit(userId, SERVICE_CREDIT_COSTS.mcpPerCall);
}

/**
 * Get voice minutes used in a time period
 */
async function getVoiceMinutesForPeriod(
  userId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const usageSummary = await subscriptionRepository.getUsageSummary(
    userId,
    start,
    end,
  );
  // Voice credits / credits per minute = minutes used
  const voiceCredits = usageSummary.voice_credits || 0;
  return voiceCredits / SERVICE_CREDIT_COSTS.voicePerMinute;
}

/**
 * Check voice usage limit using credits system + hard cap
 *
 * Voice is expensive ($0.30/min) so we have TWO limits:
 * 1. Credits pool limit (shared with other services)
 * 2. Hard monthly voice minutes cap (protects margins)
 *
 * @param userId - User ID
 * @param minutes - Number of voice minutes to use
 */
export async function checkVoiceLimit(
  userId: string,
  minutes: number = 1,
): Promise<CreditLimitCheckResult> {
  // Get user's subscription tier
  const subscription = await subscriptionRepository.getByUserId(userId);
  const tier: SubscriptionTier =
    (subscription?.tier as SubscriptionTier) || "free";

  // Check hard voice minutes cap first
  const { start, end } = getMonthBoundaries();
  const voiceMinutesUsed = await getVoiceMinutesForPeriod(userId, start, end);
  const voiceMinutesLimit = TIER_LIMITS[tier].monthlyVoiceMinutes;

  if (voiceMinutesUsed + minutes > voiceMinutesLimit) {
    return {
      allowed: false,
      reason: `Monthly voice limit reached (${Math.floor(voiceMinutesUsed)}/${voiceMinutesLimit} minutes). Upgrade your plan for more voice time.`,
      usage: voiceMinutesUsed * SERVICE_CREDIT_COSTS.voicePerMinute,
      limit: voiceMinutesLimit * SERVICE_CREDIT_COSTS.voicePerMinute,
      tier,
      creditsRequired: minutes * SERVICE_CREDIT_COSTS.voicePerMinute,
    };
  }

  // Also check credits pool
  return checkCreditsLimit(
    userId,
    SERVICE_CREDIT_COSTS.voicePerMinute * minutes,
  );
}

/**
 * Check web search limit using credits system
 */
export async function checkWebSearchLimit(
  userId: string,
): Promise<CreditLimitCheckResult> {
  return checkCreditsLimit(userId, SERVICE_CREDIT_COSTS.webSearchPerQuery);
}

// Usage warning thresholds
export const USAGE_WARNING_THRESHOLD = 0.8; // 80%
export const USAGE_CRITICAL_THRESHOLD = 0.95; // 95%

export type CreditsWarning = {
  type: "credits";
  label: string;
  usage: number;
  limit: number;
  percentUsed: number;
  severity: "warning" | "critical";
};

export type CreditsWarningsResult = {
  warnings: CreditsWarning[];
  hasWarnings: boolean;
  hasCritical: boolean;
  tier: SubscriptionTier;
  // Usage breakdown for display
  breakdown: {
    tokenCredits: number;
    imageCredits: number;
    voiceCredits: number;
    sandboxCredits: number;
    mcpCredits: number;
    workflowCredits: number;
    webSearchCredits: number;
    totalCredits: number;
  };
};

/**
 * Get credits usage warnings for a user (limits at 80%+ usage)
 * Used to show warnings in the UI and API responses
 */
export async function getCreditsWarnings(
  userId: string,
): Promise<CreditsWarningsResult> {
  const subscription = await subscriptionRepository.getByUserId(userId);
  const tier: SubscriptionTier =
    (subscription?.tier as SubscriptionTier) || "free";
  const { start: monthStart, end: monthEnd } = getMonthBoundaries();

  const warnings: CreditsWarning[] = [];

  // Get usage summary for credits breakdown
  const usageSummary = await subscriptionRepository.getUsageSummary(
    userId,
    monthStart,
    monthEnd,
  );

  // Calculate effective limit (tier limit + purchased credits)
  const purchasedCredits = Number(subscription?.purchasedTokens || "0");
  const purchasedUsed = Number(subscription?.purchasedTokensUsed || "0");
  const purchasedRemaining = Math.max(0, purchasedCredits - purchasedUsed);
  const monthlyLimit = TIER_LIMITS[tier].monthlyCredits + purchasedRemaining;

  // Get total credits used
  const totalCreditsUsed = usageSummary.total_credits || 0;

  // Check monthly credits limit
  const monthlyPercentUsed = totalCreditsUsed / monthlyLimit;
  if (monthlyPercentUsed >= USAGE_WARNING_THRESHOLD) {
    warnings.push({
      type: "credits",
      label: "Monthly Credits",
      usage: totalCreditsUsed,
      limit: monthlyLimit,
      percentUsed: monthlyPercentUsed * 100,
      severity:
        monthlyPercentUsed >= USAGE_CRITICAL_THRESHOLD ? "critical" : "warning",
    });
  }

  return {
    warnings,
    hasWarnings: warnings.length > 0,
    hasCritical: warnings.some((w) => w.severity === "critical"),
    tier,
    breakdown: {
      tokenCredits: usageSummary.token_credits || 0,
      imageCredits: usageSummary.image_credits || 0,
      voiceCredits: usageSummary.voice_credits || 0,
      sandboxCredits: usageSummary.sandbox_credits || 0,
      mcpCredits: usageSummary.mcp_credits || 0,
      workflowCredits: usageSummary.workflow_credits || 0,
      webSearchCredits: usageSummary.web_search_credits || 0,
      totalCredits: totalCreditsUsed,
    },
  };
}

// Legacy export for backwards compatibility
/** @deprecated Use getCreditsWarnings instead */
export const getUsageWarnings = getCreditsWarnings;
