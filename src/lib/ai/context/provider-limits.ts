import "server-only";

import { serverCache } from "lib/cache";
import logger from "logger";
import type { ProviderModelsResult } from "../dynamic-models/types";

/**
 * Provider-specific context limits and configuration
 * These limits are conservative to leave room for response tokens
 */

export interface ProviderModelLimits {
  contextWindow: number; // Total context window in tokens
  maxOutputTokens: number; // Maximum output tokens
  effectiveLimit: number; // contextWindow - maxOutputTokens (what we can use for input)
}

// Provider model limits - context windows and output limits
// All values are in tokens
const MODEL_LIMITS: Record<string, Record<string, ProviderModelLimits>> = {
  anthropic: {
    // Claude 3.5/4 models
    "claude-sonnet-4-5-20250929": {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      effectiveLimit: 191808,
    },
    "claude-opus-4-5-20251101": {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      effectiveLimit: 191808,
    },
    "claude-haiku-4-5": {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      effectiveLimit: 191808,
    },
    "claude-sonnet-4-20250514": {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      effectiveLimit: 191808,
    },
    // Default for new Anthropic models
    default: {
      contextWindow: 200000,
      maxOutputTokens: 8192,
      effectiveLimit: 191808,
    },
  },
  openai: {
    "gpt-4.1": {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      effectiveLimit: 111616,
    },
    "gpt-4.1-mini": {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      effectiveLimit: 111616,
    },
    "gpt-4.1-nano": {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      effectiveLimit: 111616,
    },
    "gpt-4o": {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      effectiveLimit: 111616,
    },
    "gpt-4o-mini": {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      effectiveLimit: 111616,
    },
    default: {
      contextWindow: 128000,
      maxOutputTokens: 16384,
      effectiveLimit: 111616,
    },
  },
  google: {
    "gemini-3-pro-preview": {
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      effectiveLimit: 934464,
    },
    "gemini-3-flash-preview": {
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      effectiveLimit: 934464,
    },
    "gemini-2.5-pro": {
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      effectiveLimit: 934464,
    },
    "gemini-2.5-flash": {
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      effectiveLimit: 934464,
    },
    default: {
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      effectiveLimit: 934464,
    },
  },
  xai: {
    "grok-4": {
      contextWindow: 256000,
      maxOutputTokens: 16384,
      effectiveLimit: 239616,
    },
    "grok-4.1-fast": {
      contextWindow: 256000,
      maxOutputTokens: 16384,
      effectiveLimit: 239616,
    },
    "grok-4-1-fast": {
      contextWindow: 256000,
      maxOutputTokens: 16384,
      effectiveLimit: 239616,
    },
    "grok-4-1-fast-reasoning": {
      contextWindow: 256000,
      maxOutputTokens: 16384,
      effectiveLimit: 239616,
    },
    "grok-4.1-fast-reasoning": {
      contextWindow: 256000,
      maxOutputTokens: 16384,
      effectiveLimit: 239616,
    },
    "grok-3": {
      contextWindow: 128000,
      maxOutputTokens: 8192,
      effectiveLimit: 119808,
    },
    "grok-3-mini": {
      contextWindow: 128000,
      maxOutputTokens: 8192,
      effectiveLimit: 119808,
    },
    default: {
      contextWindow: 128000,
      maxOutputTokens: 8192,
      effectiveLimit: 119808,
    },
  },
  groq: {
    // Groq typically uses Llama models
    "llama-3.3-70b-versatile": {
      contextWindow: 128000,
      maxOutputTokens: 32768,
      effectiveLimit: 95232,
    },
    "llama-3.1-8b-instant": {
      contextWindow: 128000,
      maxOutputTokens: 8192,
      effectiveLimit: 119808,
    },
    default: {
      contextWindow: 128000,
      maxOutputTokens: 8192,
      effectiveLimit: 119808,
    },
  },
  cerebras: {
    // Cerebras has fast inference but specific limits
    "zai-glm-4.7": {
      contextWindow: 131072,
      maxOutputTokens: 8192,
      effectiveLimit: 122880,
    },
    "zai-glm-4.6": {
      contextWindow: 131072,
      maxOutputTokens: 8192,
      effectiveLimit: 122880,
    },
    "gpt-oss-120b": {
      contextWindow: 131072,
      maxOutputTokens: 8192,
      effectiveLimit: 122880,
    },
    "llama-3.3-70b": {
      contextWindow: 131072,
      maxOutputTokens: 8192,
      effectiveLimit: 122880,
    },
    default: {
      contextWindow: 131072,
      maxOutputTokens: 8192,
      effectiveLimit: 122880,
    },
  },
  ollama: {
    // Local models typically have smaller context windows
    "llama3.3": {
      contextWindow: 32768,
      maxOutputTokens: 4096,
      effectiveLimit: 28672,
    },
    qwen3: {
      contextWindow: 32768,
      maxOutputTokens: 4096,
      effectiveLimit: 28672,
    },
    gemma3: {
      contextWindow: 32768,
      maxOutputTokens: 4096,
      effectiveLimit: 28672,
    },
    "deepseek-r1": {
      contextWindow: 64000,
      maxOutputTokens: 4096,
      effectiveLimit: 59904,
    },
    default: {
      contextWindow: 32768,
      maxOutputTokens: 4096,
      effectiveLimit: 28672,
    },
  },
  openRouter: {
    // OpenRouter hosts various models - use conservative defaults
    default: {
      contextWindow: 128000,
      maxOutputTokens: 8192,
      effectiveLimit: 119808,
    },
  },
};

// Default fallback for unknown providers
const DEFAULT_LIMITS: ProviderModelLimits = {
  contextWindow: 100000,
  maxOutputTokens: 8192,
  effectiveLimit: 91808,
};

/**
 * Normalize model name for matching (handles variations like -reasoning suffix, dots vs dashes)
 */
function normalizeModelName(model: string): string[] {
  const variations: string[] = [model];

  // Handle -reasoning, -vision, etc. suffixes
  const baseModel = model.replace(/-reasoning$|-vision$|-beta$|-preview$/i, "");
  if (baseModel !== model) {
    variations.push(baseModel);
  }

  // Handle dot vs dash variations (grok-4.1-fast vs grok-4-1-fast)
  const dotToDash = model.replace(/\./g, "-");
  if (dotToDash !== model) {
    variations.push(dotToDash);
  }
  const dashToDot = model.replace(/-/g, ".");
  if (dashToDot !== model) {
    variations.push(dashToDot);
  }

  // Add base without suffix variations
  if (baseModel !== model) {
    const baseDotToDash = baseModel.replace(/\./g, "-");
    if (baseDotToDash !== baseModel) variations.push(baseDotToDash);
    const baseDashToDot = baseModel.replace(/-/g, ".");
    if (baseDashToDot !== baseModel) variations.push(baseDashToDot);
  }

  return [...new Set(variations)]; // Remove duplicates
}

/**
 * Normalize provider name for cache lookup (handles case variations)
 */
function normalizeProviderName(provider: string): string {
  // Map common variations to standard names
  const providerMap: Record<string, string> = {
    openrouter: "openRouter",
    openai: "openai",
    anthropic: "anthropic",
    google: "google",
    xai: "xai",
    groq: "groq",
    ollama: "ollama",
    cerebras: "cerebras",
  };
  return providerMap[provider.toLowerCase()] || provider;
}

/**
 * Look up model limits from dynamically fetched models cache
 * Forces a fresh fetch if cache is stale or empty to ensure we always have dynamic limits
 */
async function getDynamicModelLimits(
  provider: string,
  model: string,
): Promise<ProviderModelLimits | null> {
  try {
    const normalizedProvider = normalizeProviderName(provider);
    const cacheKey = `dynamic-models:${normalizedProvider}`;
    let cached = await serverCache.get<ProviderModelsResult>(cacheKey);

    // If cache is empty or stale, force a fresh fetch
    if (!cached || !cached.models || cached.models.length === 0) {
      logger.info(
        `[Provider Limits] Cache empty for ${normalizedProvider}, forcing fresh fetch`,
      );
      try {
        // Import here to avoid circular dependency
        const { getAllProviderModels } = await import(
          "../dynamic-models/model-service"
        );
        const allModels = await getAllProviderModels({
          cacheTtlMs: 60 * 60 * 1000, // 1 hour
          timeoutMs: 15000, // 15 seconds - longer timeout for reliability
          enableDynamicFetch: true,
        });
        const providerResult = allModels.find(
          (r) => r.provider === normalizedProvider,
        );
        if (providerResult && providerResult.models.length > 0) {
          cached = providerResult;
          // Update cache
          await serverCache.set(cacheKey, cached, 60 * 60 * 1000);
        } else {
          logger.warn(
            `[Provider Limits] No models found for ${normalizedProvider} after fetch`,
          );
          return null;
        }
      } catch (fetchError) {
        logger.error(
          `[Provider Limits] Failed to fetch models for ${normalizedProvider}:`,
          fetchError,
        );
        return null;
      }
    }

    // Get static fallback limits in case maxOutputTokens is missing
    const staticLimits = getModelLimits(provider, model);

    // Try exact match first
    const exactMatch = cached.models.find((m) => m.id === model);
    if (exactMatch && exactMatch.contextWindow) {
      const contextWindow = exactMatch.contextWindow;
      // Use dynamic maxOutputTokens if available, otherwise fall back to static
      const maxOutputTokens =
        exactMatch.maxOutputTokens ?? staticLimits.maxOutputTokens;
      return {
        contextWindow,
        maxOutputTokens,
        effectiveLimit: Math.max(0, contextWindow - maxOutputTokens),
      };
    }

    // Try normalized variations
    const variations = normalizeModelName(model);
    for (const variation of variations) {
      const match = cached.models.find((m) => m.id === variation);
      if (match && match.contextWindow) {
        const contextWindow = match.contextWindow;
        // Use dynamic maxOutputTokens if available, otherwise fall back to static
        const maxOutputTokens =
          match.maxOutputTokens ?? staticLimits.maxOutputTokens;
        return {
          contextWindow,
          maxOutputTokens,
          effectiveLimit: Math.max(0, contextWindow - maxOutputTokens),
        };
      }
    }

    // Try partial matches (for models with version suffixes)
    for (const cachedModel of cached.models) {
      if (
        cachedModel.id.startsWith(model) ||
        model.startsWith(cachedModel.id)
      ) {
        if (cachedModel.contextWindow) {
          const contextWindow = cachedModel.contextWindow;
          // Use dynamic maxOutputTokens if available, otherwise fall back to static
          const maxOutputTokens =
            cachedModel.maxOutputTokens ?? staticLimits.maxOutputTokens;
          return {
            contextWindow,
            maxOutputTokens,
            effectiveLimit: Math.max(0, contextWindow - maxOutputTokens),
          };
        }
      }
    }

    return null;
  } catch (error) {
    logger.debug(
      `[Provider Limits] Failed to get dynamic limits for ${provider}/${model}:`,
      error,
    );
    return null;
  }
}

/**
 * Get model limits for a specific provider and model
 * Handles model name variations (dots vs dashes, suffixes like -reasoning)
 *
 * This is the synchronous version that uses static fallbacks.
 * For dynamic limits, use getModelLimitsAsync instead.
 */
export function getModelLimits(
  provider: string,
  model: string,
): ProviderModelLimits {
  const providerLimits = MODEL_LIMITS[provider];
  if (!providerLimits) {
    return DEFAULT_LIMITS;
  }

  // Try exact match first
  if (providerLimits[model]) {
    return providerLimits[model];
  }

  // Try normalized variations
  const variations = normalizeModelName(model);
  for (const variation of variations) {
    if (providerLimits[variation]) {
      return providerLimits[variation];
    }
  }

  // Fallback to provider default or global default
  return providerLimits.default || DEFAULT_LIMITS;
}

/**
 * Get model limits for a specific provider and model (async version)
 * ALWAYS uses dynamically fetched model limits from APIs
 *
 * This is the PRIMARY method - it forces dynamic fetching and retries if needed.
 * Static fallbacks are ONLY used as absolute last resort with clear warnings.
 */
export async function getModelLimitsAsync(
  provider: string,
  model: string,
): Promise<ProviderModelLimits> {
  // Try to get limits from dynamically fetched models - with retry logic
  let dynamicLimits = await getDynamicModelLimits(provider, model);

  // Retry once if first attempt failed (cache might have been stale)
  if (!dynamicLimits) {
    logger.warn(
      `[Provider Limits] First attempt failed for ${provider}/${model}, retrying with fresh fetch...`,
    );
    // Force cache invalidation and retry
    try {
      const { invalidateModelCache } = await import(
        "../dynamic-models/model-service"
      );
      const normalizedProvider = normalizeProviderName(provider);
      await invalidateModelCache(normalizedProvider as any);
      dynamicLimits = await getDynamicModelLimits(provider, model);
    } catch (retryError) {
      logger.error(
        `[Provider Limits] Retry failed for ${provider}/${model}:`,
        retryError,
      );
    }
  }

  if (dynamicLimits) {
    logger.info(
      `[Provider Limits] Using dynamic limits for ${provider}/${model}: ${dynamicLimits.contextWindow} tokens (effective: ${dynamicLimits.effectiveLimit})`,
    );
    return dynamicLimits;
  }

  // ABSOLUTE LAST RESORT: Use static limits with clear warning
  logger.error(
    `[Provider Limits] ⚠️ CRITICAL: Falling back to STATIC limits for ${provider}/${model} - dynamic fetch failed! This should not happen in production.`,
  );
  const staticLimits = getModelLimits(provider, model);
  logger.warn(
    `[Provider Limits] Static fallback values: ${staticLimits.contextWindow} tokens (may be outdated!)`,
  );
  return staticLimits;
}

/**
 * Get the effective context limit (context window - reserved output tokens)
 * This is the maximum number of input tokens we can safely use
 *
 * ⚠️ DEPRECATED: This sync version uses static fallbacks.
 * Use getEffectiveContextLimitAsync instead for dynamic limits.
 */
export function getEffectiveContextLimit(
  provider: string,
  model: string,
): number {
  logger.warn(
    `[Provider Limits] Using deprecated sync getEffectiveContextLimit for ${provider}/${model} - use async version instead!`,
  );
  return getModelLimits(provider, model).effectiveLimit;
}

/**
 * Get the effective context limit (async version)
 * ALWAYS uses dynamically fetched model limits from provider APIs
 *
 * This is the PRIMARY method - it ensures we always have up-to-date limits.
 */
export async function getEffectiveContextLimitAsync(
  provider: string,
  model: string,
): Promise<number> {
  const limits = await getModelLimitsAsync(provider, model);
  return limits.effectiveLimit;
}

/**
 * Get the total context window size
 *
 * This is the synchronous version that uses static fallbacks.
 * For dynamic limits, use getContextWindowSizeAsync instead.
 */
export function getContextWindowSize(provider: string, model: string): number {
  return getModelLimits(provider, model).contextWindow;
}

/**
 * Get the total context window size (async version)
 * First checks dynamically fetched model limits from APIs, then falls back to static values
 */
export async function getContextWindowSizeAsync(
  provider: string,
  model: string,
): Promise<number> {
  const limits = await getModelLimitsAsync(provider, model);
  return limits.contextWindow;
}

/**
 * Get the maximum output tokens for a model
 *
 * This is the synchronous version that uses static fallbacks.
 * For dynamic limits, use getMaxOutputTokensAsync instead.
 */
export function getMaxOutputTokens(provider: string, model: string): number {
  return getModelLimits(provider, model).maxOutputTokens;
}

/**
 * Get the maximum output tokens for a model (async version)
 * First checks dynamically fetched model limits from APIs, then falls back to static values
 */
export async function getMaxOutputTokensAsync(
  provider: string,
  model: string,
): Promise<number> {
  const limits = await getModelLimitsAsync(provider, model);
  return limits.maxOutputTokens;
}

/**
 * Compaction threshold as a fraction of effective context limit
 * When usage exceeds this threshold, compaction will be triggered
 */
export const COMPACTION_THRESHOLD = 0.95; // 95% - Compact when near limit

/**
 * Number of recent messages to preserve during compaction
 * These messages won't be summarized to maintain immediate context
 */
export const PRESERVE_RECENT_MESSAGES = 10;

/**
 * Minimum number of messages required before compaction can be triggered
 * Don't compact very short conversations
 */
export const MIN_MESSAGES_FOR_COMPACTION = 6;
