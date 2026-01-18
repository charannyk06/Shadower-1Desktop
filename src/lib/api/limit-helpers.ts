import {
  checkImageLimit,
  checkSandboxLimit,
  checkTokenLimit,
  checkWorkflowLimit,
} from "lib/billing";
import type {
  CreditLimitCheckResult,
  TokenLimitCheckResult,
} from "lib/billing/limit-check";

// Union type for all limit check results
export type LimitCheckResult = TokenLimitCheckResult | CreditLimitCheckResult;

/**
 * Creates a standardized limit exceeded response
 */
export function createLimitExceededResponse(
  limitCheck: LimitCheckResult,
): Response {
  // Access multiplier safely - only TokenLimitCheckResult has it
  const multiplier =
    "multiplier" in limitCheck ? limitCheck.multiplier : undefined;

  return Response.json(
    {
      error: "limit_exceeded",
      message: limitCheck.reason,
      usage: limitCheck.usage,
      limit: limitCheck.limit,
      tier: limitCheck.tier,
      ...(multiplier && { multiplier }),
    },
    { status: 429 },
  );
}

/**
 * Validates token limit and returns error response if exceeded
 */
export async function validateTokenLimit(
  userId: string,
  estimatedTokens: number,
  model?: string,
  provider?: string,
): Promise<LimitCheckResult | null> {
  const limitCheck = await checkTokenLimit(
    userId,
    estimatedTokens,
    model,
    provider,
  );
  return limitCheck.allowed ? null : limitCheck;
}

/**
 * Validates sandbox limit and returns error response if exceeded
 */
export async function validateSandboxLimit(
  userId: string,
): Promise<LimitCheckResult | null> {
  const limitCheck = await checkSandboxLimit(userId);
  return limitCheck.allowed ? null : limitCheck;
}

/**
 * Validates workflow limit and returns error response if exceeded
 */
export async function validateWorkflowLimit(
  userId: string,
): Promise<LimitCheckResult | null> {
  const limitCheck = await checkWorkflowLimit(userId);
  return limitCheck.allowed ? null : limitCheck;
}

/**
 * Validates image limit and returns error response if exceeded
 */
export async function validateImageLimit(
  userId: string,
  model?: string,
): Promise<LimitCheckResult | null> {
  const limitCheck = await checkImageLimit(userId, model);
  return limitCheck.allowed ? null : limitCheck;
}
