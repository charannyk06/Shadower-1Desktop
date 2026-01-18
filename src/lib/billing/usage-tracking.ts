import { subscriptionRepository } from "@/lib/db/repository";
import type { TokenLimitCheckResult } from "./limit-check";
import { getModelMultiplier } from "./model-multipliers";
import { trackLLMUsage } from "./openmeter";
import type { SubscriptionTier } from "./types";

interface UsageTrackingParams {
  userId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  tier: SubscriptionTier;
  source: string;
  logger?: { error: (msg: string, err?: unknown) => void };
}

interface UsageTrackingResult {
  actualTokens: number;
  multiplier: number;
  creditsConsumed: number;
}

/**
 * Tracks LLM usage in OpenMeter and records a usage event in the database.
 * This is a unified helper to eliminate duplicated tracking code across API routes.
 *
 * @param params - Usage tracking parameters
 * @returns Calculated usage metrics (actualTokens, multiplier, creditsConsumed)
 */
export async function trackAndRecordUsage(
  params: UsageTrackingParams,
): Promise<UsageTrackingResult> {
  const {
    userId,
    model,
    provider,
    inputTokens,
    outputTokens,
    tier,
    source,
    logger,
  } = params;

  const actualTokens = inputTokens + outputTokens;
  const multiplier = getModelMultiplier(model, provider, tier);
  const creditsConsumed = Math.ceil(actualTokens * multiplier);

  // Track in OpenMeter
  trackLLMUsage({
    userId,
    model,
    provider,
    inputTokens,
    outputTokens,
    totalTokens: actualTokens,
    tier,
  }).catch((err) => {
    if (logger) {
      logger.error("Failed to track LLM usage:", err);
    }
  });

  // Record in database
  subscriptionRepository
    .recordUsageEvent({
      userId,
      eventType: "llm_tokens",
      amount: String(actualTokens),
      metadata: {
        model,
        provider,
        actualTokens,
        multiplier,
        creditsConsumed,
        inputTokens,
        outputTokens,
        source,
      },
    })
    .catch((err) => {
      if (logger) {
        logger.error("Failed to record usage event:", err);
      }
    });

  return { actualTokens, multiplier, creditsConsumed };
}

/**
 * Creates an onFinish callback for streamText/streamObject that tracks usage.
 * This is a convenience wrapper for the common pattern in API routes.
 *
 * @param params - Base tracking parameters (without token counts)
 * @param getInputText - Function to estimate input text for fallback token calculation
 * @returns An onFinish callback function
 */
export function createUsageTrackingCallback(
  params: Omit<UsageTrackingParams, "inputTokens" | "outputTokens">,
  getInputText?: () => string,
) {
  return (ctx: {
    usage?: { inputTokens?: number; outputTokens?: number };
    text?: string;
    object?: unknown;
  }) => {
    const inputText = getInputText?.() || "";
    const inputTokens =
      ctx.usage?.inputTokens || Math.ceil((inputText?.length || 0) / 4);
    const outputTokens =
      ctx.usage?.outputTokens ||
      Math.ceil(
        (ctx.text?.length || JSON.stringify(ctx.object || "")?.length || 0) / 4,
      );

    trackAndRecordUsage({
      ...params,
      inputTokens,
      outputTokens,
    });
  };
}

/**
 * Creates a 429 error response for token limit exceeded.
 * Standardizes the error response format across API routes.
 *
 * @param checkResult - The token limit check result
 * @returns A Response object with 429 status
 */
export function createLimitExceededResponse(
  checkResult: TokenLimitCheckResult,
): Response {
  return Response.json(
    {
      error: "limit_exceeded",
      message: checkResult.reason,
      usage: checkResult.usage,
      limit: checkResult.limit,
      tier: checkResult.tier,
      multiplier: checkResult.multiplier,
    },
    { status: 429 },
  );
}

/**
 * Creates a default model config with fallback values.
 *
 * @param chatModel - Optional model config from request
 * @returns Model config with defaults applied
 */
export function getDefaultModelConfig(chatModel?: {
  provider?: string;
  model?: string;
}): { provider: string; model: string } {
  return {
    provider: chatModel?.provider || "google",
    model: chatModel?.model || "gemini-3-flash-preview",
  };
}
