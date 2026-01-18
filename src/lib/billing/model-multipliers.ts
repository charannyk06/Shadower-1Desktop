import type { SubscriptionTier } from "./types";

// Multiplier tiers based on API cost per million tokens
export type ModelTier = "free" | "budget" | "standard" | "premium" | "ultra";

export interface ModelMultiplierInfo {
  multiplier: number;
  tier: ModelTier;
}

// Pattern-based multiplier rules (first match wins)
// Note: Using .{0,50} instead of .* to prevent ReDoS (model names are short)
const MULTIPLIER_PATTERNS: Array<{
  pattern: RegExp;
  multiplier: number;
  tier: ModelTier;
}> = [
  // Free tier (0x for paid users)
  { pattern: /:free$/i, multiplier: 0, tier: "free" },

  // Extreme tier (12-15x)
  {
    pattern: /opus[- ]?4\.1|claude[- ]?.{0,30}opus[- ]?4\.1/i,
    multiplier: 15,
    tier: "ultra",
  },
  { pattern: /^o1(?!-preview)(?!-mini)/i, multiplier: 12, tier: "ultra" },

  // Ultra tier (6-8x)
  {
    pattern: /opus[- ]?4\.5|claude[- ]?.{0,30}opus[- ]?4\.5/i,
    multiplier: 6,
    tier: "ultra",
  },
  { pattern: /claude.{0,30}opus/i, multiplier: 6, tier: "ultra" },
  { pattern: /o1-preview/i, multiplier: 8, tier: "ultra" },
  { pattern: /gpt-5(?!.{0,30}mini)/i, multiplier: 8, tier: "ultra" },

  // Premium tier (4x)
  { pattern: /claude.{0,30}sonnet/i, multiplier: 4, tier: "premium" },
  { pattern: /gpt-4o(?!-mini)/i, multiplier: 4, tier: "premium" },
  {
    pattern: /gpt-4\.1(?!.{0,30}mini)(?!.{0,30}nano)/i,
    multiplier: 4,
    tier: "premium",
  },
  { pattern: /gemini.{0,30}pro/i, multiplier: 4, tier: "premium" },
  { pattern: /grok-3(?!.{0,30}mini)/i, multiplier: 4, tier: "premium" },
  { pattern: /grok-4(?!\.1)(?!.{0,30}mini)/i, multiplier: 4, tier: "premium" },

  // Standard tier (2x)
  { pattern: /claude.{0,30}haiku/i, multiplier: 2, tier: "standard" },
  { pattern: /^o3(?!-mini)/i, multiplier: 2, tier: "standard" },
  { pattern: /^o4(?!-mini)/i, multiplier: 2, tier: "standard" },
  { pattern: /grok-2/i, multiplier: 2, tier: "standard" },
  { pattern: /gemini-2\.5-flash(?!-lite)/i, multiplier: 2, tier: "standard" },

  // Budget tier (1x)
  { pattern: /grok-4\.1/i, multiplier: 1, tier: "budget" },
  { pattern: /grok.{0,30}4\.1/i, multiplier: 1, tier: "budget" },
  { pattern: /mini|nano|lite/i, multiplier: 1, tier: "budget" },
  // Match o1-mini, o3-mini, o4-mini etc. - bounded digit count
  { pattern: /^o\d{1,2}-mini/i, multiplier: 1, tier: "budget" },

  // Google Gemini Flash models (all versions except 2.5 non-lite)
  { pattern: /gemini.{0,30}flash/i, multiplier: 1, tier: "budget" },

  // Llama models (all - cheap on Groq/OpenRouter)
  { pattern: /llama/i, multiplier: 1, tier: "budget" },

  // Qwen models (all - cheap)
  { pattern: /qwen/i, multiplier: 1, tier: "budget" },

  // Gemma models (all - cheap/free)
  { pattern: /gemma/i, multiplier: 1, tier: "budget" },

  // DeepSeek models (all - cheap)
  { pattern: /deepseek/i, multiplier: 1, tier: "budget" },

  // Kimi models (cheap)
  { pattern: /kimi/i, multiplier: 1, tier: "budget" },

  // Mistral/Mixtral models (mostly cheap)
  { pattern: /mistral|mixtral|devstral/i, multiplier: 1, tier: "budget" },

  // GPT-OSS (open source variants on OpenRouter)
  { pattern: /gpt-oss/i, multiplier: 1, tier: "budget" },

  // Phi models (Microsoft - cheap)
  { pattern: /phi-/i, multiplier: 1, tier: "budget" },

  // Yi models (cheap)
  { pattern: /^yi-/i, multiplier: 1, tier: "budget" },

  // Command models (Cohere - cheap)
  { pattern: /command/i, multiplier: 1, tier: "budget" },
];

// Default for truly unknown models - use standard to be safe
export const DEFAULT_MULTIPLIER = 2;
export const DEFAULT_TIER: ModelTier = "standard";

/**
 * Get the token multiplier for a specific model
 * Uses pattern matching first, then provider defaults
 *
 * @param model - Model name
 * @param provider - Provider name (optional)
 * @param subscriptionTier - User's subscription tier (optional, affects free model handling)
 */
export function getModelMultiplier(
  model: string,
  provider?: string,
  subscriptionTier?: SubscriptionTier,
): number {
  const info = getModelMultiplierInfo(model, provider);

  // For "free" tier models (cost us $0):
  // - Pro/Ultra users: 0x multiplier (unlimited use!)
  // - Free users: 1x multiplier (still counts to prevent abuse)
  if (info.tier === "free") {
    if (subscriptionTier === "pro" || subscriptionTier === "ultra") {
      return 0; // FREE for paid users!
    }
    return 1; // Still counts for free tier users
  }

  return info.multiplier;
}

/**
 * Get the tier classification for a specific model
 */
export function getModelTier(model: string, provider?: string): ModelTier {
  const info = getModelMultiplierInfo(model, provider);
  return info.tier;
}

/**
 * Check if a model is a free model (costs us $0)
 */
export function isFreeModel(model: string, provider?: string): boolean {
  const info = getModelMultiplierInfo(model, provider);
  return info.tier === "free";
}

/**
 * Get full multiplier info for a model
 * Uses pattern matching with provider-based fallbacks
 */
export function getModelMultiplierInfo(
  model: string,
  provider?: string,
): ModelMultiplierInfo {
  // Check patterns first (order matters - first match wins!)
  for (const rule of MULTIPLIER_PATTERNS) {
    if (rule.pattern.test(model)) {
      return { multiplier: rule.multiplier, tier: rule.tier };
    }
  }

  // Provider-based defaults for models that don't match any pattern
  if (provider) {
    const providerLower = provider.toLowerCase();

    // Groq - All models are FREE tier (generous free tier from Groq)
    if (providerLower === "groq") {
      return { multiplier: 0, tier: "free" };
    }

    // Ollama - Self-hosted = FREE (no API cost)
    if (providerLower === "ollama") {
      return { multiplier: 0, tier: "free" };
    }

    // OpenRouter - extract model name after provider prefix and re-check
    if (providerLower === "openrouter") {
      // OpenRouter IDs have format like "openai/gpt-4o" or "meta-llama/llama-3.3-70b:free"
      if (model.includes("/")) {
        const modelPart = model.split("/").pop() || model;
        for (const rule of MULTIPLIER_PATTERNS) {
          if (rule.pattern.test(modelPart)) {
            return { multiplier: rule.multiplier, tier: rule.tier };
          }
        }
      }
      // Unknown OpenRouter model - default to standard
      return { multiplier: 2, tier: "standard" };
    }
  }

  // Default fallback for truly unknown models
  return { multiplier: DEFAULT_MULTIPLIER, tier: DEFAULT_TIER };
}

/**
 * Calculate effective tokens based on actual tokens and model multiplier
 */
export function calculateEffectiveTokens(
  actualTokens: number,
  model: string,
  provider?: string,
  subscriptionTier?: SubscriptionTier,
): number {
  const multiplier = getModelMultiplier(model, provider, subscriptionTier);
  return Math.ceil(actualTokens * multiplier);
}

/**
 * Tier display information for UI
 */
export const TIER_DISPLAY: Record<
  ModelTier,
  { label: string; description: string; color: string }
> = {
  free: {
    label: "Free",
    description: "No cost - unlimited for Pro/Ultra",
    color: "emerald",
  },
  budget: {
    label: "Budget",
    description: "Most cost-effective option",
    color: "green",
  },
  standard: {
    label: "Standard",
    description: "Balanced performance and cost",
    color: "yellow",
  },
  premium: {
    label: "Premium",
    description: "High capability, higher cost",
    color: "orange",
  },
  ultra: {
    label: "Ultra",
    description: "Maximum capability, premium pricing",
    color: "red",
  },
};
