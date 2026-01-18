import "server-only";

import logger from "logger";
import { getModelCapabilities } from "../../providers/capabilities";
import { formatOllamaDisplayName } from "../display-names";
import { DynamicModelInfo } from "../types";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export async function fetchOllamaModels(
  timeoutMs: number,
): Promise<DynamicModelInfo[]> {
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;
  const modelsUrl = `${baseUrl.replace("/api", "")}/api/tags`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(modelsUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`Ollama not available: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      models: Array<{
        name: string;
        model: string;
        modified_at: string;
        size: number;
        details?: {
          parameter_size?: string;
          family?: string;
        };
      }>;
    };

    const models = data.models
      .sort(
        (a, b) =>
          new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime(),
      )
      .map((model): DynamicModelInfo => {
        const modelName = model.name || model.model;
        const isVision =
          modelName.includes("vision") || modelName.includes("llava");

        // Use centralized capability detection
        const capabilities = getModelCapabilities(modelName);

        return {
          id: modelName,
          name: formatOllamaDisplayName(modelName),

          // Core capabilities from unified system
          isToolCallSupported: capabilities.isToolCallSupported,
          isImageInputSupported: isVision || capabilities.isImageInputSupported,
          isReasoningModel: capabilities.isReasoningModel,

          // Rich capabilities (like Sim)
          reasoningEffort: capabilities.reasoningEffort,
          thinkingLevel: capabilities.thinkingLevel,
          nativeStructuredOutputs: capabilities.nativeStructuredOutputs,

          // Workflow-specific
          workflowGenerationSupport: capabilities.workflowGenerationSupport,
          toolCallUnsupportedReason: capabilities.toolCallUnsupportedReason,

          // File support based on vision capability
          supportedFileMimeTypes: isVision
            ? ["image/jpeg", "image/png", "image/gif", "image/webp"]
            : [],
        };
      });

    return models;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logger.warn("Ollama models fetch timed out");
    } else {
      logger.debug("Ollama not available (this is normal if not installed)");
    }
    return [];
  }
}
