import "server-only";

import { getModelCapabilities } from "../providers/capabilities";
import { DynamicModelInfo, ProviderName } from "./types";

// Common MIME type arrays to reduce duplication
const OPENAI_FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
] as const;

const ANTHROPIC_FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "image/jpeg",
  "image/png",
] as const;

const GOOGLE_FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "image/jpeg",
  "image/png",
  "video/mp4",
  "audio/mp3",
] as const;

const XAI_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

const NO_FILE_TYPES: readonly string[] = [];

// Common model configs to reduce duplication
const CEREBRAS_BASE_CONFIG = {
  contextWindow: 131072,
  isImageInputSupported: false,
  supportedFileMimeTypes: [...NO_FILE_TYPES],
};

const GOOGLE_BASE_CONFIG = {
  contextWindow: 1048576,
  maxOutputTokens: 65536,
  isImageInputSupported: true,
  supportedFileMimeTypes: [...GOOGLE_FILE_TYPES],
};

const TEXT_ONLY_CONFIG = {
  isImageInputSupported: false,
  supportedFileMimeTypes: [...NO_FILE_TYPES],
};

/**
 * Helper to create a static model with capabilities from centralized system
 */
function createStaticModel(
  id: string,
  name: string,
  overrides: Partial<DynamicModelInfo> = {},
): DynamicModelInfo {
  const capabilities = getModelCapabilities(id);

  return {
    id,
    name,
    isToolCallSupported: capabilities.isToolCallSupported,
    isImageInputSupported: capabilities.isImageInputSupported,
    isReasoningModel: capabilities.isReasoningModel,
    workflowGenerationSupport: capabilities.workflowGenerationSupport,
    toolCallUnsupportedReason: capabilities.toolCallUnsupportedReason,
    reasoningEffort: capabilities.reasoningEffort,
    thinkingLevel: capabilities.thinkingLevel,
    nativeStructuredOutputs: capabilities.nativeStructuredOutputs,
    supportedFileMimeTypes: [],
    ...overrides,
  };
}

export const STATIC_FALLBACK_MODELS: Record<ProviderName, DynamicModelInfo[]> =
  {
    openai: [
      createStaticModel("gpt-4.1", "GPT-4.1", {
        isImageInputSupported: true,
        supportedFileMimeTypes: [...OPENAI_FILE_TYPES],
      }),
      createStaticModel("gpt-4.1-mini", "GPT-4.1 Mini", {
        isImageInputSupported: true,
        supportedFileMimeTypes: [...OPENAI_FILE_TYPES],
      }),
      createStaticModel("gpt-4.1-nano", "GPT-4.1 Nano", {
        isImageInputSupported: true,
        supportedFileMimeTypes: [...OPENAI_FILE_TYPES],
      }),
    ],
    anthropic: [
      createStaticModel("claude-opus-4-5-20251101", "Claude Opus 4.5", {
        isImageInputSupported: true,
        supportedFileMimeTypes: [...ANTHROPIC_FILE_TYPES],
      }),
      createStaticModel("claude-sonnet-4-5-20250929", "Claude Sonnet 4.5", {
        isImageInputSupported: true,
        supportedFileMimeTypes: [...ANTHROPIC_FILE_TYPES],
      }),
      createStaticModel("claude-haiku-4-5", "Claude Haiku 4.5", {
        isImageInputSupported: true,
        supportedFileMimeTypes: [...ANTHROPIC_FILE_TYPES],
      }),
      createStaticModel("claude-sonnet-4-20250514", "Claude Sonnet 4", {
        isImageInputSupported: true,
        supportedFileMimeTypes: [...ANTHROPIC_FILE_TYPES],
      }),
    ],
    google: [
      createStaticModel("gemini-3-pro-preview", "Gemini 3 Pro (Preview)", {
        ...GOOGLE_BASE_CONFIG,
      }),
      createStaticModel("gemini-3-flash-preview", "Gemini 3 Flash (Preview)", {
        ...GOOGLE_BASE_CONFIG,
      }),
      createStaticModel("gemini-2.5-pro", "Gemini 2.5 Pro", {
        ...GOOGLE_BASE_CONFIG,
      }),
      createStaticModel("gemini-2.5-flash", "Gemini 2.5 Flash", {
        ...GOOGLE_BASE_CONFIG,
      }),
    ],
    xai: [
      createStaticModel("grok-4", "Grok 4", {
        contextWindow: 256000,
        isImageInputSupported: true,
        supportedFileMimeTypes: [...XAI_FILE_TYPES],
      }),
      createStaticModel("grok-4.1-fast", "Grok 4.1 Fast", {
        contextWindow: 131072,
        isImageInputSupported: true,
        supportedFileMimeTypes: [...XAI_FILE_TYPES],
      }),
      createStaticModel("grok-3", "Grok 3", {
        contextWindow: 131072,
        isImageInputSupported: true,
        supportedFileMimeTypes: [...XAI_FILE_TYPES],
      }),
      createStaticModel("grok-3-mini", "Grok 3 Mini", {
        contextWindow: 131072,
        ...TEXT_ONLY_CONFIG,
      }),
    ],
    groq: [
      createStaticModel(
        "meta-llama/llama-4-maverick-17b-128e-instruct",
        "Llama 4 Maverick 17B (Preview)",
        TEXT_ONLY_CONFIG,
      ),
      createStaticModel(
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "Llama 4 Scout 17B (Preview)",
        TEXT_ONLY_CONFIG,
      ),
      createStaticModel(
        "openai/gpt-oss-120b",
        "GPT OSS 120B",
        TEXT_ONLY_CONFIG,
      ),
      createStaticModel("openai/gpt-oss-20b", "GPT OSS 20B", TEXT_ONLY_CONFIG),
      createStaticModel(
        "moonshotai/kimi-k2-instruct-0905",
        "Kimi K2 (Preview)",
        TEXT_ONLY_CONFIG,
      ),
      createStaticModel(
        "qwen/qwen3-32b",
        "Qwen 3 32B (Preview)",
        TEXT_ONLY_CONFIG,
      ),
      createStaticModel(
        "llama-3.3-70b-versatile",
        "Llama 3.3 70B",
        TEXT_ONLY_CONFIG,
      ),
      createStaticModel(
        "llama-3.1-8b-instant",
        "Llama 3.1 8B",
        TEXT_ONLY_CONFIG,
      ),
    ],
    openRouter: [
      createStaticModel(
        "deepseek/deepseek-r1-0528:free",
        "DeepSeek R1 (Free)",
        TEXT_ONLY_CONFIG,
      ),
      createStaticModel(
        "openai/gpt-oss-120b:free",
        "GPT OSS 120B (Free)",
        TEXT_ONLY_CONFIG,
      ),
      createStaticModel(
        "qwen/qwen3-coder:free",
        "Qwen 3 Coder (Free)",
        TEXT_ONLY_CONFIG,
      ),
      createStaticModel("google/gemma-3-27b-it:free", "Gemma 3 27B (Free)", {
        isImageInputSupported: true,
        supportedFileMimeTypes: [...NO_FILE_TYPES],
      }),
      createStaticModel(
        "meta-llama/llama-3.3-70b-instruct:free",
        "Llama 3.3 70B (Free)",
        TEXT_ONLY_CONFIG,
      ),
    ],
    ollama: [
      createStaticModel("llama3.3", "Llama 3.3", TEXT_ONLY_CONFIG),
      createStaticModel("qwen3", "Qwen 3", TEXT_ONLY_CONFIG),
      createStaticModel("gemma3", "Gemma 3", TEXT_ONLY_CONFIG),
      createStaticModel("deepseek-r1", "DeepSeek R1", TEXT_ONLY_CONFIG),
    ],
    cerebras: [
      createStaticModel("zai-glm-4.7", "GLM 4.7", CEREBRAS_BASE_CONFIG),
      createStaticModel("zai-glm-4.6", "GLM 4.6", CEREBRAS_BASE_CONFIG),
      createStaticModel("gpt-oss-120b", "GPT OSS 120B", CEREBRAS_BASE_CONFIG),
      createStaticModel("llama-3.3-70b", "Llama 3.3 70B", CEREBRAS_BASE_CONFIG),
      createStaticModel(
        "qwen-3-235b-a22b-instruct-2507",
        "Qwen 3 235B",
        CEREBRAS_BASE_CONFIG,
      ),
      createStaticModel("qwen-3-32b", "Qwen 3 32B", CEREBRAS_BASE_CONFIG),
      createStaticModel("llama3.1-8b", "Llama 3.1 8B", CEREBRAS_BASE_CONFIG),
    ],
    // LM Studio is dynamically loaded, but we provide an empty fallback
    lmstudio: [],
  };
