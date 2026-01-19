import "server-only";

import logger from "logger";
import { getModelCapabilities } from "../../providers/capabilities";
import { DynamicModelInfo } from "../types";

const DEFAULT_LM_STUDIO_URL = "http://localhost:1234/v1";

/**
 * Format display name for LM Studio models
 * LM Studio uses OpenAI-compatible format with model IDs like:
 * - "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF"
 * - "TheBloke/Mistral-7B-v0.1-GGUF"
 */
export function formatLMStudioDisplayName(modelId: string): string {
  let name = modelId;

  // Remove org/user prefix if present
  if (name.includes("/")) {
    name = name.split("/").pop() || name;
  }

  // Remove common suffixes
  name = name
    .replace(/-GGUF$/i, "")
    .replace(/-GPTQ$/i, "")
    .replace(/-AWQ$/i, "")
    .replace(/-fp16$/i, "")
    .replace(/-Q\d+_\w+$/i, "") // Remove quantization suffix like -Q4_K_M
    .replace(/-Instruct$/i, "")
    .replace(/-Chat$/i, "");

  // Format known model names
  name = name
    .replace(/^Meta-/i, "")
    .replace(/^TheBloke-/i, "")
    .replace(/^lmstudio-community-/i, "")
    .replace(/Llama-?(\d)/gi, "Llama $1")
    .replace(/Mistral-?(\d)/gi, "Mistral $1")
    .replace(/Mixtral/gi, "Mixtral")
    .replace(/Qwen-?(\d)/gi, "Qwen $1")
    .replace(/Gemma-?(\d)/gi, "Gemma $1")
    .replace(/Phi-?(\d)/gi, "Phi $1")
    .replace(/DeepSeek/gi, "DeepSeek")
    .replace(/CodeLlama/gi, "Code Llama")
    // Match version numbers like "3.1", "2.5"
    .replace(/-v?([\d.]+)/gi, " v$1")
    // Match model sizes like "7B", "70B"
    .replace(/-(\d{1,4})B/gi, " $1B");

  return name.trim().replace(/\s+/g, " ");
}

/**
 * Fetch models from LM Studio's OpenAI-compatible API
 */
export async function fetchLMStudioModels(
  timeoutMs: number,
  baseUrl?: string,
): Promise<DynamicModelInfo[]> {
  const url =
    baseUrl || process.env.LM_STUDIO_BASE_URL || DEFAULT_LM_STUDIO_URL;
  const modelsUrl = `${url.replace(/\/+$/, "")}/models`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(modelsUrl, {
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`LM Studio not available: ${response.status}`);
      return [];
    }

    // LM Studio uses OpenAI-compatible format
    const data = (await response.json()) as {
      data: Array<{
        id: string;
        object: string;
        created?: number;
        owned_by?: string;
      }>;
    };

    if (!data.data || !Array.isArray(data.data)) {
      logger.warn("LM Studio returned unexpected format");
      return [];
    }

    const models = data.data.map((model): DynamicModelInfo => {
      const modelId = model.id;

      // Detect vision capability from model name
      const isVision =
        modelId.toLowerCase().includes("vision") ||
        modelId.toLowerCase().includes("llava") ||
        modelId.toLowerCase().includes("bakllava") ||
        modelId.toLowerCase().includes("moondream");

      // Use centralized capability detection
      const capabilities = getModelCapabilities(modelId);

      return {
        id: modelId,
        name: formatLMStudioDisplayName(modelId),

        // Core capabilities from unified system
        isToolCallSupported: capabilities.isToolCallSupported,
        isImageInputSupported: isVision || capabilities.isImageInputSupported,
        isReasoningModel: capabilities.isReasoningModel,

        // Rich capabilities
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
      logger.warn("LM Studio models fetch timed out");
    } else {
      logger.debug("LM Studio not available (this is normal if not installed)");
    }
    return [];
  }
}

/**
 * Check if LM Studio is running and available
 */
export async function isLMStudioAvailable(
  timeoutMs: number = 3000,
  baseUrl?: string,
): Promise<boolean> {
  const url =
    baseUrl || process.env.LM_STUDIO_BASE_URL || DEFAULT_LM_STUDIO_URL;
  const modelsUrl = `${url.replace(/\/+$/, "")}/models`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(modelsUrl, {
      signal: controller.signal,
      method: "GET",
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}
