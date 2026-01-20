import logger from "logger";
import { getModelCapabilities } from "../../providers/capabilities";
import { formatGoogleDisplayName } from "../display-names";
import { DynamicModelInfo } from "../types";

const GOOGLE_MODELS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

const CHAT_MODEL_PREFIXES = [
  "gemini-3",
  "gemini-2.5",
  "gemini-2.0",
  "gemini-1.5",
];

const EXCLUDED_PATTERNS = [
  "embedding",
  "aqa",
  "tts",
  "image-preview",
  "image-generation",
  "native-audio",
  "-lite",
  "-001",
  "-exp",
];

// Patterns to hide specific models from the UI
const HIDDEN_MODEL_PATTERNS = [
  "2.5-flash-preview", // Gemini 2.5 Flash Preview Sep 2025
  "2.0-flash", // Gemini 2.0 Flash (all variants)
  "computer-use", // Gemini 2.5 Computer Use Preview
];

// Priority order for sorting (higher = more recent/important)
const MODEL_PRIORITY: Record<string, number> = {
  "gemini-3-pro": 100,
  "gemini-3-flash": 95,
  "gemini-2.5-pro": 90,
  "gemini-2.5-flash": 85,
  "gemini-2.0-flash": 70,
  "gemini-1.5-pro": 50,
  "gemini-1.5-flash": 45,
};

function getModelPriority(modelId: string): number {
  const lowerId = modelId.toLowerCase();
  for (const [prefix, priority] of Object.entries(MODEL_PRIORITY)) {
    if (lowerId.startsWith(prefix)) {
      // Penalize preview/experimental versions slightly
      if (lowerId.includes("preview") || lowerId.includes("experimental")) {
        return priority - 1;
      }
      return priority;
    }
  }
  return 0;
}

function isChatModel(modelId: string): boolean {
  const lowerId = modelId.toLowerCase();
  if (EXCLUDED_PATTERNS.some((p) => lowerId.includes(p))) {
    return false;
  }
  // Check if this specific model should be hidden
  if (HIDDEN_MODEL_PATTERNS.some((pattern) => lowerId.includes(pattern))) {
    return false;
  }
  return CHAT_MODEL_PREFIXES.some((prefix) => lowerId.includes(prefix));
}

export async function fetchGoogleModels(
  timeoutMs: number,
): Promise<DynamicModelInfo[]> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey || apiKey === "****") {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${GOOGLE_MODELS_URL}?key=${apiKey}`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.error(`Google models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      models: Array<{
        name: string;
        displayName: string;
        description: string;
        inputTokenLimit: number;
        outputTokenLimit: number;
        supportedGenerationMethods: string[];
      }>;
    };

    const transformedModels = data.models
      .filter((model) => {
        const modelName = model.name.replace("models/", "");
        return (
          isChatModel(modelName) &&
          model.supportedGenerationMethods?.includes("generateContent")
        );
      })
      .map((model): DynamicModelInfo => {
        const modelId = model.name.replace("models/", "");

        // Use centralized capability detection
        const capabilities = getModelCapabilities(modelId);

        return {
          id: modelId,
          name: formatGoogleDisplayName(modelId, model.displayName),
          description: model.description,
          contextWindow: model.inputTokenLimit,
          maxOutputTokens: model.outputTokenLimit,

          // Core capabilities from unified system
          isToolCallSupported: capabilities.isToolCallSupported,
          isImageInputSupported: capabilities.isImageInputSupported,
          isReasoningModel: capabilities.isReasoningModel,

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
            "image/jpeg",
            "image/png",
            "image/gif",
            "image/webp",
            "video/mp4",
            "audio/mp3",
            "audio/wav",
          ],
        };
      })
      .sort((a, b) => getModelPriority(b.id) - getModelPriority(a.id));

    // Deduplicate by display name
    const seenNames = new Set<string>();
    const models = transformedModels.filter((model) => {
      if (seenNames.has(model.name)) return false;
      seenNames.add(model.name);
      return true;
    });

    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logger.warn("Google models fetch timed out");
    } else {
      logger.error("Failed to fetch Google models:", error);
    }
    return [];
  }
}
