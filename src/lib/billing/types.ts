export type UsageEventType =
  | "llm_tokens"
  | "image_generation"
  | "sandbox_execution"
  | "voice_minutes"
  | "mcp_tool_call"
  | "workflow_execution"
  | "web_search";

// Re-export model multiplier types for convenience
export type { ModelTier, ModelMultiplierInfo } from "./model-multipliers";

export interface UsageEvent {
  type: UsageEventType;
  userId: string;
  timestamp?: Date;
  data: {
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    imageCount?: number;
    executionMs?: number;
    minutes?: number;
    toolName?: string;
    workflowId?: string;
    actionName?: string;
    query?: string; // For web search queries
    // NEW: Credits consumed for unified billing
    creditsConsumed?: number;
    imageResolution?: string; // e.g., "1024x1024" or "4096x4096"
  };
}

export type SubscriptionTier = "free" | "pro" | "ultra";

/**
 * Token pack configuration for one-time credit purchases
 */
export interface TokenPack {
  id: string; // e.g., "500000", "2000000"
  tokens: number; // Number of credits
  price: number; // Price in cents
  pricePerMillion: number; // Price per million credits (for display)
  enabled: boolean; // Whether this pack is available for purchase
  displayName?: string; // Optional display name (e.g., "500K Pack")
  description?: string; // Optional description
  popular?: boolean; // Mark as popular/recommended
}

// Credit costs per service (1 credit = $0.000004)
export const SERVICE_CREDIT_COSTS = {
  voicePerMinute: 75_000,
  sandboxPerExecution: 425,
  mcpPerCall: 250,
  workflowPerRun: 1_250,
  webSearchPerQuery: 1_500,
} as const;

// Image generation credit costs by model
export const IMAGE_CREDIT_COSTS: Record<string, number> = {
  "gpt-image-1-mini": 5_000,
  "gemini-2.5-flash-image": 10_000,
  "gemini-2.5-flash-image-4k": 60_000,
  sdxl: 2_500,
  "gpt-image-1-low": 2_500,
  "sd-3": 5_000,
  "dall-e-3": 10_000,
  "dall-e-3-standard": 10_000,
  "flux-1.1-pro": 10_000,
  "gpt-image-1": 10_000,
  "gpt-image-1-medium": 10_000,
  "grok-2-image": 10_000,
  "dall-e-3-hd": 20_000,
  "flux-kontext-max": 20_000,
  "gpt-image-1-high": 42_500,
  "imagen-3-4k": 60_000,
};

export const DEFAULT_IMAGE_CREDITS = 10_000;

/**
 * Get credit cost for an image generation model
 */
export function getImageCredits(model?: string, resolution?: string): number {
  if (!model) return DEFAULT_IMAGE_CREDITS;

  const modelLower = model.toLowerCase();

  // Check for 4K resolution on Gemini models
  if (modelLower.includes("gemini") && resolution) {
    const width = Number.parseInt(resolution.split("x")[0] || "0", 10);
    if (width >= 4096) {
      return IMAGE_CREDIT_COSTS["gemini-2.5-flash-image-4k"] || 60_000;
    }
  }

  // Look for exact match first
  if (IMAGE_CREDIT_COSTS[modelLower]) {
    return IMAGE_CREDIT_COSTS[modelLower];
  }

  // Look for partial match
  for (const [key, cost] of Object.entries(IMAGE_CREDIT_COSTS)) {
    if (modelLower.includes(key) || key.includes(modelLower)) {
      return cost;
    }
  }

  return DEFAULT_IMAGE_CREDITS;
}

export const EXPENSIVE_MODEL_MULTIPLIER_THRESHOLD = 6;

export interface TierLimits {
  monthlyCredits: number;
  monthlyVoiceMinutes: number;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    monthlyCredits: 100_000,
    monthlyVoiceMinutes: 1,
  },
  pro: {
    monthlyCredits: 3_000_000,
    monthlyVoiceMinutes: 15,
  },
  ultra: {
    monthlyCredits: 8_750_000,
    monthlyVoiceMinutes: 45,
  },
};

export interface UserUsage {
  credits: number;
  tokenCredits: number;
  imageCredits: number;
  voiceCredits: number;
  sandboxCredits: number;
  mcpCredits: number;
  workflowCredits: number;
  rawTokens: number;
  rawImages: number;
  rawVoiceMinutes: number;
  rawSandboxExecutions: number;
  rawMcpCalls: number;
  rawWorkflowRuns: number;
}

export interface UsageSummary {
  usage: UserUsage;
  limits: TierLimits;
  tier: SubscriptionTier;
  periodStart: Date;
  periodEnd: Date;
  percentUsed: number;
}

/** @deprecated */
export interface LegacyTierLimits {
  monthlyTokens: number;
  monthlyImages: number;
  monthlySandboxExecutions: number;
  monthlyVoiceMinutes: number;
  monthlyMcpCalls: number;
  monthlyWorkflowRuns: number;
  dailyExpensiveTokens: number;
  weeklyTokens: number;
}

/** @deprecated */
export interface LegacyUserUsage {
  tokens: number;
  images: number;
  sandboxExecutions: number;
  voiceMinutes: number;
  mcpCalls: number;
  workflowRuns: number;
}
