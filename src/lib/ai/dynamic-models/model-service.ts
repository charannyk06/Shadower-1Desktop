import { LanguageModel } from "ai";
import { serverCache } from "lib/cache";
import logger from "logger";
import { customModelProvider } from "../models";
import {
  fetchAnthropicModels,
  fetchCerebrasModels,
  fetchGoogleModels,
  fetchGroqModels,
  fetchLMStudioModels,
  fetchOllamaModels,
  fetchOpenAIModels,
  fetchOpenRouterModels,
  fetchXAIModels,
} from "./fetchers";
import { STATIC_FALLBACK_MODELS } from "./static-fallback";
import {
  DEFAULT_FETCHER_CONFIG,
  DynamicModelInfo,
  ModelFetcherConfig,
  ProviderModelsResult,
  ProviderName,
} from "./types";

const CACHE_KEY_PREFIX = "dynamic-models:";
const CACHE_KEY_ALL_PROVIDERS = "dynamic-models:all-providers";

type ProviderFetcher = (timeoutMs: number) => Promise<DynamicModelInfo[]>;

const PROVIDER_FETCHERS: Record<ProviderName, ProviderFetcher> = {
  openai: fetchOpenAIModels,
  anthropic: fetchAnthropicModels,
  google: fetchGoogleModels,
  groq: fetchGroqModels,
  xai: fetchXAIModels,
  openRouter: fetchOpenRouterModels,
  ollama: fetchOllamaModels,
  lmstudio: fetchLMStudioModels,
  cerebras: fetchCerebrasModels,
};

const PROVIDER_API_KEY_ENV: Record<ProviderName, string | null> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  openRouter: "OPENROUTER_API_KEY",
  ollama: null,
  lmstudio: null, // LM Studio is local, no API key needed
  cerebras: "CEREBRAS_API_KEY",
};

function hasAPIKey(provider: ProviderName): boolean {
  const envVar = PROVIDER_API_KEY_ENV[provider];
  if (!envVar) return true;
  const key = process.env[envVar];
  return !!key && key !== "****";
}

async function fetchProviderModels(
  provider: ProviderName,
  config: ModelFetcherConfig,
): Promise<ProviderModelsResult> {
  const cacheKey = `${CACHE_KEY_PREFIX}${provider}`;

  const cached = await serverCache.get<ProviderModelsResult>(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < config.cacheTtlMs) {
    return cached;
  }

  const hasKey = hasAPIKey(provider);

  if (!hasKey) {
    const fallbackResult: ProviderModelsResult = {
      provider,
      models: STATIC_FALLBACK_MODELS[provider] || [],
      hasAPIKey: false,
      fetchedAt: Date.now(),
    };
    return fallbackResult;
  }

  if (!config.enableDynamicFetch) {
    const staticResult: ProviderModelsResult = {
      provider,
      models: STATIC_FALLBACK_MODELS[provider] || [],
      hasAPIKey: hasKey,
      fetchedAt: Date.now(),
    };
    return staticResult;
  }

  // Retry logic for reliability
  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const fetcher = PROVIDER_FETCHERS[provider];
      // Increase timeout on retries
      const timeout = config.timeoutMs * (attempt + 1);
      const models = await fetcher(timeout);

      if (models.length === 0) {
        if (attempt < maxRetries) {
          logger.warn(
            `[Dynamic Models] No models returned from ${provider} (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (attempt + 1)),
          ); // Exponential backoff
          continue;
        }
        // Last attempt failed - this is bad, but we'll still try to use what we have
        logger.error(
          `[Dynamic Models] ⚠️ CRITICAL: No models returned from ${provider} after ${maxRetries + 1} attempts!`,
        );
        const fallbackModels = STATIC_FALLBACK_MODELS[provider] || [];
        const result: ProviderModelsResult = {
          provider,
          models: fallbackModels,
          hasAPIKey: hasKey,
          fetchedAt: Date.now(),
          error: "No models returned from API after retries",
        };
        await serverCache.set(cacheKey, result, config.cacheTtlMs / 4); // Shorter cache on failure
        return result;
      }

      // Success! Cache and return
      const result: ProviderModelsResult = {
        provider,
        models,
        hasAPIKey: hasKey,
        fetchedAt: Date.now(),
      };

      await serverCache.set(cacheKey, result, config.cacheTtlMs);

      logger.info(
        `[Dynamic Models] Successfully fetched ${models.length} models from ${provider} (attempt ${attempt + 1})`,
      );

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        logger.warn(
          `[Dynamic Models] Fetch failed for ${provider} (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}, retrying...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        ); // Exponential backoff
        continue;
      }
      // Last attempt failed
      logger.error(
        `[Dynamic Models] ⚠️ CRITICAL: Failed to fetch models from ${provider} after ${maxRetries + 1} attempts: ${lastError.message}`,
      );
    }
  }

  // All retries failed - absolute last resort
  const fallbackModels = STATIC_FALLBACK_MODELS[provider] || [];
  const result: ProviderModelsResult = {
    provider,
    models: fallbackModels,
    hasAPIKey: hasKey,
    fetchedAt: Date.now(),
    error: lastError?.message || "Unknown error after retries",
  };

  await serverCache.set(cacheKey, result, config.cacheTtlMs / 4); // Shorter cache on failure

  return result;
}

export async function getAllProviderModels(
  config: Partial<ModelFetcherConfig> = {},
): Promise<ProviderModelsResult[]> {
  const mergedConfig: ModelFetcherConfig = {
    ...DEFAULT_FETCHER_CONFIG,
    ...config,
  };

  const cached = await serverCache.get<{
    results: ProviderModelsResult[];
    fetchedAt: number;
  }>(CACHE_KEY_ALL_PROVIDERS);

  if (cached && Date.now() - cached.fetchedAt < mergedConfig.cacheTtlMs) {
    return cached.results;
  }

  const providers: ProviderName[] = [
    "google",
    "openai",
    "anthropic",
    "groq",
    "xai",
    "openRouter",
    "ollama",
    "lmstudio",
    "cerebras",
  ];

  const results = await Promise.all(
    providers.map((provider) => fetchProviderModels(provider, mergedConfig)),
  );

  const providerOrder = new Map(providers.map((p, i) => [p, i]));
  const sortedResults = results.sort((a, b) => {
    if (a.hasAPIKey && !b.hasAPIKey) return -1;
    if (!a.hasAPIKey && b.hasAPIKey) return 1;
    return (
      (providerOrder.get(a.provider as ProviderName) ?? 99) -
      (providerOrder.get(b.provider as ProviderName) ?? 99)
    );
  });

  await serverCache.set(
    CACHE_KEY_ALL_PROVIDERS,
    { results: sortedResults, fetchedAt: Date.now() },
    mergedConfig.cacheTtlMs,
  );

  return sortedResults;
}

export async function invalidateModelCache(
  provider?: ProviderName,
): Promise<void> {
  if (provider) {
    await serverCache.delete(`${CACHE_KEY_PREFIX}${provider}`);
  }
  await serverCache.delete(CACHE_KEY_ALL_PROVIDERS);
  logger.info(`Invalidated model cache${provider ? ` for ${provider}` : ""}`);
}

export function transformToAPIResponse(results: ProviderModelsResult[]): Array<{
  provider: string;
  hasAPIKey: boolean;
  models: Array<{
    name: string;
    displayName: string;
    isToolCallUnsupported: boolean;
    isImageInputUnsupported: boolean;
    supportedFileMimeTypes: string[];
    // New capability fields
    isReasoningModel: boolean;
    workflowGenerationSupport: "full" | "limited" | "none";
    toolCallUnsupportedReason?:
      | "reasoning-model"
      | "built-in-tools"
      | "responses-api-only";
    reasoningEffort?: string[];
    thinkingLevel?: string[];
  }>;
}> {
  return results.map((result) => ({
    provider: result.provider,
    hasAPIKey: result.hasAPIKey,
    models: result.models.map((model) => ({
      name: model.id,
      displayName: model.name,
      isToolCallUnsupported: !model.isToolCallSupported,
      isImageInputUnsupported: !model.isImageInputSupported,
      supportedFileMimeTypes: model.supportedFileMimeTypes,
      // New capability fields for client-side validation
      isReasoningModel: model.isReasoningModel,
      workflowGenerationSupport: model.workflowGenerationSupport,
      toolCallUnsupportedReason: model.toolCallUnsupportedReason,
      reasoningEffort: model.reasoningEffort,
      thinkingLevel: model.thinkingLevel,
    })),
  }));
}

/**
 * Get a model client from a model name string
 * Maps common model names (e.g., "sonnet") to their full ChatModel configuration
 */
export function getModelClient(
  modelName: string,
  _config?: Record<string, unknown>,
): LanguageModel {
  // Map common model name aliases to their full ChatModel configuration
  const modelMap: Record<string, { provider: string; model: string }> = {
    sonnet: { provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
    opus: { provider: "anthropic", model: "claude-opus-4-5-20251101" },
    haiku: { provider: "anthropic", model: "claude-haiku-4-5" },
    "gpt-4": { provider: "openai", model: "gpt-4.1" },
    "gpt-4-mini": { provider: "openai", model: "gpt-4.1-mini" },
    "gpt-4-nano": { provider: "openai", model: "gpt-4.1-nano" },
    "gemini-pro": { provider: "google", model: "gemini-3-pro-preview" },
    "gemini-flash": { provider: "google", model: "gemini-3-flash-preview" },
    grok: { provider: "xai", model: "grok-4" },
  };

  const chatModel = modelMap[modelName.toLowerCase()];

  if (!chatModel) {
    // If not found in alias map, try to infer provider from model name
    // or use the model name directly with a default provider
    // For now, default to Anthropic Sonnet if unknown
    logger.warn(
      `Unknown model name "${modelName}", defaulting to claude-sonnet-4-5-20250929`,
    );
    return customModelProvider.getModel({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
    });
  }

  return customModelProvider.getModel(chatModel);
}
