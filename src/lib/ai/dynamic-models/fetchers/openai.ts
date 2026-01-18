import "server-only";

import logger from "logger";
import { getModelCapabilities } from "../../providers/capabilities";
import { formatOpenAIDisplayName } from "../display-names";
import { DynamicModelInfo } from "../types";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

const CHAT_MODEL_PREFIXES = [
  "gpt-5",
  "gpt-4.1",
  "gpt-4o",
  "gpt-4-turbo",
  "gpt-4",
  "o1",
  "o3",
  "o4",
];

const EXCLUDED_PATTERNS = [
  "davinci",
  "babbage",
  "ada",
  "curie",
  "whisper",
  "tts",
  "dall-e",
  "embedding",
  "moderation",
  "transcribe",
  "realtime",
  "audio",
  "search",
];

// Models to hide from the UI
const HIDDEN_MODEL_PATTERNS = [
  "o4-mini", // O4 Mini Reasoning
  "o3-mini", // O3 Mini
  "o3", // O3 Reasoning
  "o1-pro", // O1-PRO
  "o1", // O1 Reasoning
  "gpt-5.2", // GPT-5.2 Chat & Pro
  "gpt-4o-mini", // GPT-4o Mini
  "gpt-4o", // GPT-4o
  "gpt-4-turbo", // GPT-4 Turbo
  "gpt-4-0125", // GPT-4-0125
];

function isChatModel(modelId: string): boolean {
  const lowerId = modelId.toLowerCase();
  if (EXCLUDED_PATTERNS.some((p) => lowerId.includes(p))) {
    return false;
  }
  // Check if this model should be hidden
  if (HIDDEN_MODEL_PATTERNS.some((pattern) => lowerId.startsWith(pattern))) {
    return false;
  }
  return CHAT_MODEL_PREFIXES.some((prefix) => lowerId.startsWith(prefix));
}

// Strip version/date suffixes to get canonical base model ID
// Handles: gpt-4o-2024-11-20, gpt-5.1-preview-2024-12-17, gpt-5.2-turbo-2025-01-05, etc.
function getBaseModelId(modelId: string): string {
  return modelId
    .replace(/-\d{4}-\d{2}-\d{2}/g, "") // Remove all date patterns (YYYY-MM-DD)
    .replace(/-preview$/i, "") // Remove -preview suffix
    .replace(/-latest$/i, ""); // Remove -latest suffix
}

export async function fetchOpenAIModels(
  timeoutMs: number,
): Promise<DynamicModelInfo[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "****") {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(OPENAI_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.error(`OpenAI models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      data: Array<{ id: string; created: number }>;
    };

    // Filter to chat models and sort by creation date (newest first)
    // NOTE: We no longer filter out reasoning models - they're included with proper capability flags
    const filteredModels = data.data
      .filter((model) => isChatModel(model.id))
      .sort((a, b) => b.created - a.created);

    // Transform to DynamicModelInfo with capabilities from unified registry
    const transformedModels = filteredModels.map((model): DynamicModelInfo => {
      const baseId = getBaseModelId(model.id);

      // Use centralized capability detection
      const capabilities = getModelCapabilities(baseId);

      return {
        id: baseId,
        name: formatOpenAIDisplayName(baseId),

        // Core capabilities from unified system
        isToolCallSupported: capabilities.isToolCallSupported,
        isImageInputSupported: capabilities.isImageInputSupported,
        isReasoningModel: capabilities.isReasoningModel,
        requiresResponsesAPI: capabilities.requiresResponsesAPI,

        // Rich capabilities (like Sim)
        reasoningEffort: capabilities.reasoningEffort,
        thinkingLevel: capabilities.thinkingLevel,
        nativeStructuredOutputs: capabilities.nativeStructuredOutputs,

        // Workflow-specific
        workflowGenerationSupport: capabilities.workflowGenerationSupport,
        toolCallUnsupportedReason: capabilities.toolCallUnsupportedReason,

        // File support
        supportedFileMimeTypes: [
          "application/pdf",
          "text/plain",
          "text/csv",
          "text/html",
          "text/markdown",
        ],
      };
    });

    // Deduplicate by display name (what users actually see)
    const seenNames = new Set<string>();
    const chatModels = transformedModels.filter((model) => {
      if (seenNames.has(model.name)) return false;
      seenNames.add(model.name);
      return true;
    });

    // Debug: log model counts
    const duplicateCount = transformedModels.length - chatModels.length;
    const reasoningCount = chatModels.filter((m) => m.isReasoningModel).length;
    const toolSupportedCount = chatModels.filter(
      (m) => m.isToolCallSupported,
    ).length;

    logger.info(
      `OpenAI: ${transformedModels.length} total -> ${chatModels.length} after dedup (removed ${duplicateCount})`,
    );
    logger.info(
      `OpenAI: ${toolSupportedCount} support tools, ${reasoningCount} are reasoning models`,
    );

    return chatModels;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logger.warn("OpenAI models fetch timed out");
    } else {
      logger.error("Failed to fetch OpenAI models:", error);
    }
    return [];
  }
}
