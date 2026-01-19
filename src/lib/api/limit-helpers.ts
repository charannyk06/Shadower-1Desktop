// No-op limit helpers for local-only desktop app
// All limits are disabled - users use their own API keys (BYOK)

// Stub type for backwards compatibility
export type LimitCheckResult = {
  allowed: false;
  reason: string;
  usage: number;
  limit: number;
  tier: string;
};

/**
 * Creates a standardized limit exceeded response
 * Note: This should never be called in local-only mode
 */
export function createLimitExceededResponse(
  _limitCheck: LimitCheckResult,
): Response {
  return Response.json(
    { error: "Unexpected billing check in local-only mode" },
    { status: 500 },
  );
}

/**
 * Validates token limit - always returns null (allowed) in local-only mode
 */
export async function validateTokenLimit(
  _userId: string,
  _estimatedTokens: number,
  _model?: string,
  _provider?: string,
): Promise<null> {
  return null; // Always allowed
}

/**
 * Validates local execution limit - always returns null (allowed) in local-only mode
 */
export async function validateLocalExecutionLimit(
  _userId: string,
): Promise<null> {
  return null; // Always allowed
}

/**
 * Validates workflow limit - always returns null (allowed) in local-only mode
 */
export async function validateWorkflowLimit(_userId: string): Promise<null> {
  return null; // Always allowed
}

/**
 * Validates image limit - always returns null (allowed) in local-only mode
 */
export async function validateImageLimit(
  _userId: string,
  _model?: string,
): Promise<LimitCheckResult | null> {
  return null; // Always allowed in desktop app
}
