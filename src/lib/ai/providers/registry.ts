import { anthropic } from "@ai-sdk/anthropic";
import { createCerebras } from "@ai-sdk/cerebras";
import { google } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { ollama as createOllamaProvider } from "ai-sdk-ollama";

import { getModelCapabilities, requiresResponsesAPI } from "./capabilities";
import type { ProviderConfig, ProviderId } from "./types";

// =============================================================================
// PROVIDER INSTANCES
// =============================================================================

/**
 * OpenRouter instance with app identification headers
 */
const openrouter = createOpenRouter({
  headers: {
    "HTTP-Referer": "https://shadower.ai",
    "X-Title": "Shadower",
  },
});

/**
 * Ollama provider using ai-sdk-ollama for reliable tool calling
 * NOTE: The electron/ipc/ai.ts handles performance options dynamically.
 * This wrapper is for non-Electron usage (web/testing).
 * 
 * ai-sdk-ollama provides:
 * - Enhanced response synthesis for guaranteed complete responses
 * - Automatic JSON repair for tool arguments
 * - Built-in reliability features
 */
const ollama = (modelId: string) => createOllamaProvider(modelId, {
  options: {
    num_ctx: 8192,        // Larger context for tool schemas
    num_predict: 2048,    // Allow full outputs
    repeat_penalty: 1.1,  // Avoid repetition
    temperature: 0.7,     // Balanced creativity
  },
});

/**
 * LM Studio instance (OpenAI-compatible)
 * NOTE: LM Studio handles its own performance optimization.
 */
const lmstudio = createOpenAI({
  baseURL: process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1",
  apiKey: "lm-studio", // LM Studio doesn't require a real API key
});

/**
 * Groq instance with configurable base URL and API key
 */
const groq = createGroq({
  baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Cerebras instance for high-speed inference
 */
const cerebras = createCerebras({
  apiKey: process.env.CEREBRAS_API_KEY,
});

// =============================================================================
// PROVIDER REGISTRY
// =============================================================================

/**
 * Provider registry - centralized configuration for all AI providers
 * Inspired by Sim Studio's provider architecture
 */
const registry: Record<ProviderId, ProviderConfig> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o, GPT-4.1, o3, o4 models",
    supportsToolUsageControl: true,
    defaultModel: "gpt-4o-mini",
    getModel: (modelId: string): LanguageModel => {
      // Use Responses API for codex and computer-use models
      if (requiresResponsesAPI(modelId)) {
        return openai.responses(modelId);
      }
      return openai(modelId);
    },
    getModelCapabilities,
  },

  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Sonnet, Claude Opus, Claude Haiku",
    supportsToolUsageControl: true,
    defaultModel: "claude-sonnet-4-20250514",
    getModel: (modelId: string): LanguageModel => anthropic(modelId),
    getModelCapabilities,
  },

  google: {
    id: "google",
    name: "Google",
    description: "Gemini 3 Pro, Gemini 3 Flash, Gemini 2.5",
    supportsToolUsageControl: true,
    defaultModel: "gemini-3-flash-preview",
    getModel: (modelId: string): LanguageModel => google(modelId),
    getModelCapabilities,
  },

  xai: {
    id: "xai",
    name: "xAI",
    description: "Grok 4, Grok 3 models",
    supportsToolUsageControl: true,
    defaultModel: "grok-3",
    getModel: (modelId: string): LanguageModel => xai(modelId),
    getModelCapabilities,
  },

  groq: {
    id: "groq",
    name: "Groq",
    description: "Fast inference for Llama, Qwen, and other models",
    supportsToolUsageControl: true,
    defaultModel: "llama-3.3-70b-versatile",
    getModel: (modelId: string): LanguageModel => groq(modelId),
    getModelCapabilities,
  },

  openRouter: {
    id: "openRouter",
    name: "OpenRouter",
    description: "Access to multiple providers with free tier models",
    supportsToolUsageControl: true,
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    getModel: (modelId: string): LanguageModel => openrouter(modelId),
    getModelCapabilities,
  },

  ollama: {
    id: "ollama",
    name: "Ollama",
    description: "Local model hosting with enhanced tool calling",
    supportsToolUsageControl: true, // ai-sdk-ollama has reliable tool support!
    defaultModel: "llama3.3",
    getModel: (modelId: string): LanguageModel =>
      ollama(modelId) as unknown as LanguageModel,
    getModelCapabilities,
  },

  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    description: "Local model hosting with GUI",
    supportsToolUsageControl: false, // Local models have limited tool support
    defaultModel: "local-model",
    getModel: (modelId: string): LanguageModel => lmstudio(modelId),
    getModelCapabilities,
  },

  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    description: "High-speed inference for Llama and Qwen models",
    supportsToolUsageControl: true,
    defaultModel: "llama-3.3-70b",
    getModel: (modelId: string): LanguageModel => cerebras(modelId),
    getModelCapabilities,
  },
};

// =============================================================================
// REGISTRY ACCESS FUNCTIONS
// =============================================================================

/**
 * Get a provider configuration by ID
 */
export function getProvider(
  providerId: ProviderId,
): ProviderConfig | undefined {
  return registry[providerId];
}

/**
 * Get all registered providers
 */
export function getAllProviders(): ProviderConfig[] {
  return Object.values(registry);
}

/**
 * Get all provider IDs
 */
export function getAllProviderIds(): ProviderId[] {
  return Object.keys(registry) as ProviderId[];
}

/**
 * Check if a provider is registered
 */
export function isValidProvider(providerId: string): providerId is ProviderId {
  return providerId in registry;
}

// =============================================================================
// MODEL -> PROVIDER RESOLUTION
// =============================================================================

/**
 * Pattern matching rules for resolving provider from model ID
 */
const PROVIDER_PATTERNS: Array<{
  pattern: RegExp;
  provider: ProviderId;
  condition?: (modelId: string) => boolean;
}> = [
  // Free tier models go to OpenRouter
  { pattern: /:free$/i, provider: "openRouter" },

  // OpenAI patterns
  { pattern: /^gpt-/i, provider: "openai" },
  { pattern: /^o[134]/i, provider: "openai" },
  { pattern: /codex/i, provider: "openai" },
  { pattern: /computer-use/i, provider: "openai" },

  // Google patterns
  { pattern: /^gemini/i, provider: "google" },
  { pattern: /^google\//i, provider: "google" },

  // Anthropic patterns
  { pattern: /^claude/i, provider: "anthropic" },
  { pattern: /^anthropic\//i, provider: "anthropic" },

  // xAI patterns
  { pattern: /^grok/i, provider: "xai" },
  { pattern: /^xai\//i, provider: "xai" },

  // Groq-hosted models
  { pattern: /^openai\/gpt-oss/i, provider: "groq" },
  { pattern: /^meta-llama\//i, provider: "groq" },
  { pattern: /^qwen\//i, provider: "groq" },
  { pattern: /^moonshotai\//i, provider: "groq" },
  { pattern: /kimi/i, provider: "groq" },

  // Llama models (not from meta-llama/) go to Ollama
  { pattern: /^llama/i, provider: "ollama" },

  // DeepSeek models
  {
    pattern: /deepseek/i,
    provider: "openRouter",
    condition: (m) => m.includes(":free"),
  },
  { pattern: /^deepseek/i, provider: "ollama" },

  // OpenRouter patterns
  { pattern: /z-ai/i, provider: "openRouter" },
  { pattern: /glm/i, provider: "openRouter" },
];

/**
 * Resolve provider ID from model ID using pattern matching
 */
export function getProviderForModel(modelId: string): ProviderId | undefined {
  const lowerModelId = modelId.toLowerCase();

  for (const { pattern, provider, condition } of PROVIDER_PATTERNS) {
    if (pattern.test(lowerModelId)) {
      // If there's a condition, check it first
      if (condition && !condition(lowerModelId)) {
        continue;
      }
      return provider;
    }
  }

  return undefined;
}

/**
 * Get a model instance from the appropriate provider
 */
export function getModelFromRegistry(
  providerId: ProviderId,
  modelId: string,
): LanguageModel | undefined {
  const provider = getProvider(providerId);
  if (!provider) return undefined;

  try {
    return provider.getModel(modelId);
  } catch {
    return undefined;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { registry };

// Re-export SDK provider instances using export-from syntax
export { openai } from "@ai-sdk/openai";
export { anthropic } from "@ai-sdk/anthropic";
export { google } from "@ai-sdk/google";
export { xai } from "@ai-sdk/xai";

// Re-export locally created provider instances
export { groq, openrouter, ollama, lmstudio, cerebras };
