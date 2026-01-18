import "server-only";

import logger from "logger";
import { formatCerebrasDisplayName } from "../display-names";
import { DynamicModelInfo } from "../types";
import {
  bearerAuthHeaders,
  createExclusionFilter,
  createPriorityMatcher,
  deduplicateByName,
  fetchWithTimeout,
  handleFetchError,
  isValidApiKey,
  transformModel,
} from "./shared";

const CEREBRAS_MODELS_URL = "https://api.cerebras.ai/v1/models";

const EXCLUDED_PATTERNS = ["embed", "whisper", "tts", "vision"];

const MODEL_PRIORITY: Record<string, number> = {
  "zai-glm-4.7": 110,
  "zai-glm-4.6": 105,
  "llama-3.3-70b": 100,
  "gpt-oss-120b": 95,
  "qwen-3-235b": 92,
  "llama3.1-70b": 90,
  "qwen-3-32b": 85,
  "llama3.1-8b": 80,
};

const isChatModel = createExclusionFilter(EXCLUDED_PATTERNS);
const getModelPriority = createPriorityMatcher(MODEL_PRIORITY);

export async function fetchCerebrasModels(
  timeoutMs: number,
): Promise<DynamicModelInfo[]> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!isValidApiKey(apiKey)) {
    return [];
  }

  try {
    const response = await fetchWithTimeout(
      CEREBRAS_MODELS_URL,
      bearerAuthHeaders(apiKey),
      timeoutMs,
    );

    if (!response.ok) {
      logger.error(`Cerebras models API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      data: Array<{
        id: string;
        created: number;
        owned_by?: string;
        context_window?: number;
      }>;
    };

    const transformedModels = data.data
      .filter((model) => isChatModel(model.id))
      .sort((a, b) => {
        const priorityDiff = getModelPriority(b.id) - getModelPriority(a.id);
        if (priorityDiff !== 0) return priorityDiff;
        return b.created - a.created;
      })
      .map((model) =>
        transformModel(
          model.id,
          formatCerebrasDisplayName(model.id),
          [],
          model.context_window,
        ),
      );

    const models = deduplicateByName(transformedModels);
    logger.info(`Fetched ${models.length} models from Cerebras`);

    return models;
  } catch (error) {
    return handleFetchError(error, "Cerebras");
  }
}
