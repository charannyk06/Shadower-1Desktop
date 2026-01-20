import logger from "logger";
import { formatXAIDisplayName } from "../display-names";
import { DynamicModelInfo } from "../types";
import {
  bearerAuthHeaders,
  deduplicateByName,
  fetchWithTimeout,
  handleFetchError,
  isValidApiKey,
  transformModel,
} from "./shared";

const XAI_MODELS_URL = "https://api.x.ai/v1/models";

const MODEL_PRIORITY: Record<string, number> = {
  "grok-4": 100,
  "grok-3": 80,
  "grok-2": 60,
};

const XAI_FILE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function getModelPriority(modelId: string): number {
  const lowerId = modelId.toLowerCase();
  for (const [prefix, priority] of Object.entries(MODEL_PRIORITY)) {
    if (lowerId.startsWith(prefix)) {
      if (lowerId.includes("mini")) return priority - 5;
      if (lowerId.includes("beta")) return priority - 2;
      return priority;
    }
  }
  return 0;
}

function getBaseModelId(modelId: string): string {
  return modelId.replace(/-\d{4}$/, "");
}

export async function fetchXAIModels(
  timeoutMs: number,
): Promise<DynamicModelInfo[]> {
  const apiKey = process.env.XAI_API_KEY;
  if (!isValidApiKey(apiKey)) {
    return [];
  }

  try {
    const response = await fetchWithTimeout(
      XAI_MODELS_URL,
      bearerAuthHeaders(apiKey),
      timeoutMs,
    );

    if (!response.ok) {
      logger.error(`xAI models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      data: Array<{
        id: string;
        created: number;
      }>;
    };

    const filteredModels = data.data
      .filter((model) => model.id.startsWith("grok"))
      .sort((a, b) => {
        const priorityDiff = getModelPriority(b.id) - getModelPriority(a.id);
        if (priorityDiff !== 0) return priorityDiff;
        return b.created - a.created;
      });

    // Deduplicate: prefer base models over dated variants
    const seen = new Set<string>();
    const dedupedModels = filteredModels.filter((model) => {
      const baseId = getBaseModelId(model.id);
      if (seen.has(baseId)) return false;
      seen.add(baseId);
      return true;
    });

    const transformedModels = dedupedModels.map((model) => {
      const baseId = getBaseModelId(model.id);
      return transformModel(
        baseId,
        formatXAIDisplayName(baseId),
        XAI_FILE_TYPES,
      );
    });

    return deduplicateByName(transformedModels);
  } catch (error) {
    return handleFetchError(error, "xAI");
  }
}
