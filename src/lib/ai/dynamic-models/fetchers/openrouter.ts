import logger from "logger";
import { getModelCapabilities } from "../../providers/capabilities";
import { formatOpenRouterDisplayName } from "../display-names";
import { DynamicModelInfo } from "../types";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Hidden Gemini models - exclude these from results
const HIDDEN_GEMINI_PATTERNS = [
  "gemini-2.0-flash",
  "gemini-2.5-flash-preview",
  "gemini-2.5-computer-use",
];

// Preferred free models - get priority ordering and are shown first to users
const PREFERRED_FREE_MODELS = [
  // Llama 4 (April 2025) - Latest Meta models
  "meta-llama/llama-4-maverick:free",
  "meta-llama/llama-4-scout:free",
  // DeepSeek R1 variants - Top reasoning models
  "deepseek/deepseek-r1:free",
  "deepseek/deepseek-r1-0528:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "deepseek/deepseek-r1-distill-llama-70b:free",
  // Google Gemini 2.5 free tiers (2.0 models hidden)
  "google/gemini-2.5-pro-exp-03-25:free",
  // Qwen 3 models
  "qwen/qwen3-235b-a22b:free",
  "qwen/qwen3-32b:free",
  "qwen/qwen3-coder:free",
  // Mistral latest
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "mistralai/devstral-2512:free",
  // Llama 3.3 (still excellent)
  "meta-llama/llama-3.3-70b-instruct:free",
  // Google Gemma 3
  "google/gemma-3-27b-it:free",
];

export async function fetchOpenRouterModels(
  timeoutMs: number,
): Promise<DynamicModelInfo[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "****") {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.error(`OpenRouter models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      data: Array<{
        id: string;
        name: string;
        description: string;
        context_length: number;
        pricing: { prompt: string; completion: string };
        top_provider?: { context_length: number };
        architecture?: { modality: string };
      }>;
    };

    const transformedModels = data.data
      .filter((model) => {
        const promptPrice = parseFloat(model.pricing?.prompt || "1");
        const completionPrice = parseFloat(model.pricing?.completion || "1");
        if (promptPrice !== 0 || completionPrice !== 0) return false;

        // Filter out hidden Gemini models
        const lowerId = model.id.toLowerCase();
        if (
          HIDDEN_GEMINI_PATTERNS.some((pattern) =>
            lowerId.includes(pattern.toLowerCase()),
          )
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const aPreferred = PREFERRED_FREE_MODELS.indexOf(a.id);
        const bPreferred = PREFERRED_FREE_MODELS.indexOf(b.id);
        if (aPreferred !== -1 && bPreferred !== -1)
          return aPreferred - bPreferred;
        if (aPreferred !== -1) return -1;
        if (bPreferred !== -1) return 1;
        return (b.context_length || 0) - (a.context_length || 0);
      })
      .slice(0, 20)
      .map((model): DynamicModelInfo => {
        // Use centralized capability detection
        const capabilities = getModelCapabilities(model.id);

        return {
          id: model.id,
          name: formatOpenRouterDisplayName(model.id, model.name),
          description: model.description,
          contextWindow: model.context_length,

          // Core capabilities from unified system
          isToolCallSupported: capabilities.isToolCallSupported,
          isImageInputSupported:
            model.architecture?.modality?.includes("image") ||
            capabilities.isImageInputSupported,
          isReasoningModel: capabilities.isReasoningModel,

          // Rich capabilities (like Sim)
          reasoningEffort: capabilities.reasoningEffort,
          thinkingLevel: capabilities.thinkingLevel,
          nativeStructuredOutputs: capabilities.nativeStructuredOutputs,

          // Workflow-specific
          workflowGenerationSupport: capabilities.workflowGenerationSupport,
          toolCallUnsupportedReason: capabilities.toolCallUnsupportedReason,

          // OpenRouter models generally don't support file uploads
          supportedFileMimeTypes: [],
        };
      });

    // Deduplicate by display name
    const seenNames = new Set<string>();
    const freeModels = transformedModels.filter((model) => {
      if (seenNames.has(model.name)) return false;
      seenNames.add(model.name);
      return true;
    });

    return freeModels;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logger.warn("OpenRouter models fetch timed out");
    } else {
      logger.error("Failed to fetch OpenRouter models:", error);
    }
    return [];
  }
}
