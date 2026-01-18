import "server-only";

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { LanguageModel } from "ai";
import { ChatModel } from "app-types/chat";
import {
  createOpenAICompatibleModels,
  openaiCompatibleModelsSafeParse,
} from "./create-openai-compatiable";
import {
  ANTHROPIC_FILE_MIME_TYPES,
  GEMINI_FILE_MIME_TYPES,
  OPENAI_FILE_MIME_TYPES,
  XAI_FILE_MIME_TYPES,
} from "./file-support";
import {
  isToolCallUnsupportedModel as checkToolCallUnsupported,
  requiresResponsesAPI,
} from "./providers/capabilities";
import {
  cerebras,
  getProviderForModel as getProviderForModelFromRegistry,
  groq,
  ollama,
  openrouter,
} from "./providers/registry";

type ProviderModels = Record<string, LanguageModel>;
type AllModels = Record<string, ProviderModels>;

// Static models - keys MUST match the IDs returned by dynamic fetchers
// This ensures model selection works correctly without silent fallbacks
const staticModels: AllModels = {
  openai: {
    "gpt-4.1": openai("gpt-4.1"),
    "gpt-4.1-mini": openai("gpt-4.1-mini"),
    "gpt-4.1-nano": openai("gpt-4.1-nano"),
  },
  google: {
    "gemini-3-pro-preview": google("gemini-3-pro-preview"),
    "gemini-3-flash-preview": google("gemini-3-flash-preview"),
    "gemini-2.5-pro": google("gemini-2.5-pro"),
    "gemini-2.5-flash": google("gemini-2.5-flash"),
  },
  anthropic: {
    "claude-sonnet-4-5-20250929": anthropic("claude-sonnet-4-5-20250929"),
    "claude-opus-4-5-20251101": anthropic("claude-opus-4-5-20251101"),
    "claude-haiku-4-5": anthropic("claude-haiku-4-5"),
    "claude-sonnet-4-20250514": anthropic("claude-sonnet-4-20250514"),
  },
  xai: {
    "grok-4": xai("grok-4"),
    "grok-4.1-fast": xai("grok-4.1-fast"),
    "grok-3": xai("grok-3"),
    "grok-3-mini": xai("grok-3-mini"),
  },
  ollama: {
    // Type assertion needed due to ollama-ai-provider-v2 using @ai-sdk/provider@2.0.0
    // while AI SDK v6 uses @ai-sdk/provider@3.0.2
    "llama3.3": ollama("llama3.3") as unknown as LanguageModel,
    qwen3: ollama("qwen3") as unknown as LanguageModel,
    gemma3: ollama("gemma3") as unknown as LanguageModel,
    "deepseek-r1": ollama("deepseek-r1") as unknown as LanguageModel,
  },
  // Groq models - keys match FULL IDs from dynamic fetcher
  groq: {
    "openai/gpt-oss-120b": groq("openai/gpt-oss-120b"),
    "openai/gpt-oss-20b": groq("openai/gpt-oss-20b"),
    "meta-llama/llama-4-maverick-17b-128e-instruct": groq(
      "meta-llama/llama-4-maverick-17b-128e-instruct",
    ),
    "meta-llama/llama-4-scout-17b-16e-instruct": groq(
      "meta-llama/llama-4-scout-17b-16e-instruct",
    ),
    "llama-3.3-70b-versatile": groq("llama-3.3-70b-versatile"),
    "llama-3.1-8b-instant": groq("llama-3.1-8b-instant"),
    "moonshotai/kimi-k2-instruct-0905": groq(
      "moonshotai/kimi-k2-instruct-0905",
    ),
    "qwen/qwen3-32b": groq("qwen/qwen3-32b"),
  },
  // OpenRouter models - keys match FULL IDs from dynamic fetcher
  openRouter: {
    "openai/gpt-oss-120b:free": openrouter("openai/gpt-oss-120b:free"),
    "openai/gpt-oss-20b:free": openrouter("openai/gpt-oss-20b:free"),
    "deepseek/deepseek-r1-0528:free": openrouter(
      "deepseek/deepseek-r1-0528:free",
    ),
    "meta-llama/llama-3.3-70b-instruct:free": openrouter(
      "meta-llama/llama-3.3-70b-instruct:free",
    ),
    "google/gemma-3-27b-it:free": openrouter("google/gemma-3-27b-it:free"),
    "qwen/qwen3-coder:free": openrouter("qwen/qwen3-coder:free"),
  },
  // Cerebras models - high-speed inference
  cerebras: {
    "zai-glm-4.7": cerebras("zai-glm-4.7"),
    "zai-glm-4.6": cerebras("zai-glm-4.6"),
    "gpt-oss-120b": cerebras("gpt-oss-120b"),
    "llama-3.3-70b": cerebras("llama-3.3-70b"),
    "qwen-3-235b-a22b-instruct-2507": cerebras(
      "qwen-3-235b-a22b-instruct-2507",
    ),
    "qwen-3-32b": cerebras("qwen-3-32b"),
    "llama3.1-8b": cerebras("llama3.1-8b"),
  },
};

// Note: TOOL_UNSUPPORTED_MODELS and requiresResponsesAPI have been moved to
// ./providers/capabilities.ts as part of the unified capability system

const FILE_SUPPORT_BY_PROVIDER: Record<string, readonly string[]> = {
  openai: OPENAI_FILE_MIME_TYPES,
  google: GEMINI_FILE_MIME_TYPES,
  anthropic: ANTHROPIC_FILE_MIME_TYPES,
  xai: XAI_FILE_MIME_TYPES,
};

const openaiCompatibleProviders = openaiCompatibleModelsSafeParse(
  process.env.OPENAI_COMPATIBLE_DATA,
);

const {
  providers: openaiCompatibleModels,
  unsupportedModels: openaiCompatibleUnsupportedModels,
} = createOpenAICompatibleModels(openaiCompatibleProviders);

const allModels: AllModels = { ...openaiCompatibleModels, ...staticModels };

export function isToolCallUnsupportedModel(model: LanguageModel): boolean {
  // First check OpenAI-compatible unsupported models set
  if (openaiCompatibleUnsupportedModels.has(model)) return true;

  // Use centralized capability detection
  // Convert model to string to get the model ID
  const modelId = String(model);

  // Delegate to the unified capability system
  return checkToolCallUnsupported(modelId);
}

export function getFilePartSupportedMimeTypes(model: LanguageModel): string[] {
  for (const [provider, models] of Object.entries(allModels)) {
    for (const [, m] of Object.entries(models)) {
      if (m === model) {
        return [...(FILE_SUPPORT_BY_PROVIDER[provider] ?? [])];
      }
    }
  }
  return [];
}

export function getProviderForModel(modelName: string): string {
  // First try exact match on model keys
  for (const [provider, models] of Object.entries(allModels)) {
    if (modelName in models) return provider;
  }

  // Use centralized pattern matching from registry
  const providerId = getProviderForModelFromRegistry(modelName);
  if (providerId) return providerId;

  // Fallback to "unknown" if no pattern matches
  return "unknown";
}

export function getModel(chatModel?: ChatModel): LanguageModel {
  if (!chatModel) {
    throw new Error("No model specified - chatModel is required");
  }

  const { provider, model } = chatModel;

  // First try exact match in static models
  const staticModel = allModels[provider]?.[model];
  if (staticModel) {
    return staticModel;
  }

  // Dynamic model creation for each provider
  // This handles models fetched dynamically from provider APIs
  switch (provider) {
    case "openRouter":
      return openrouter(model);

    case "groq":
      return groq(model);

    case "ollama":
      return ollama(model) as unknown as LanguageModel;

    case "openai":
      // Use Responses API for codex and computer-use models
      if (requiresResponsesAPI(model)) {
        return openai.responses(model);
      }
      return openai(model);

    case "google":
      return google(model);

    case "anthropic":
      return anthropic(model);

    case "xai":
      return xai(model);

    case "cerebras":
      return cerebras(model);

    default:
      // Check if it's an OpenAI-compatible provider
      if (allModels[provider]) {
        const providerModels = allModels[provider];
        const dynamicModel = providerModels[model];
        if (dynamicModel) return dynamicModel;
      }

      throw new Error(
        `Unknown provider "${provider}" for model "${model}". ` +
          `Available providers: openai, google, anthropic, xai, groq, openRouter, ollama`,
      );
  }
}

export const customModelProvider = {
  getModel,
  getProviderForModel,
};
