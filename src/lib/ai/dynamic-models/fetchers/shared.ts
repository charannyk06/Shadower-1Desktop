import "server-only";

import logger from "logger";
import { getModelCapabilities } from "../../providers/capabilities";
import { DynamicModelInfo } from "../types";

/**
 * Configuration for a model fetcher
 */
export interface FetcherConfig {
  /** Provider name for logging */
  providerName: string;
  /** API endpoint URL */
  apiUrl: string;
  /** Environment variable name for API key */
  apiKeyEnvVar: string;
  /** Function to build request headers */
  buildHeaders: (apiKey: string) => Record<string, string>;
  /** Function to filter models (returns true to include) */
  filterModel: (modelId: string) => boolean;
  /** Function to format display name */
  formatDisplayName: (modelId: string, displayName?: string) => string;
  /** Function to get sort priority (higher = first) */
  getModelPriority?: (modelId: string) => number;
  /** Function to normalize model ID (e.g., strip date suffixes) */
  normalizeModelId?: (modelId: string) => string;
  /** Supported file MIME types for this provider */
  supportedFileMimeTypes: string[];
  /** Maximum number of models to return (optional) */
  maxModels?: number;
}

/**
 * Standard API response shape for model listing
 */
interface ModelListResponse {
  data: Array<{
    id: string;
    created?: number;
    created_at?: string;
    display_name?: string;
    context_window?: number;
    owned_by?: string;
  }>;
}

/**
 * Creates a timeout-controlled fetch request
 */
export async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Standard Bearer token authorization headers
 */
export function bearerAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/**
 * Anthropic-style API key headers
 */
export function anthropicAuthHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
}

/**
 * Deduplicates models by display name, keeping the first occurrence
 */
export function deduplicateByName(
  models: DynamicModelInfo[],
): DynamicModelInfo[] {
  const seenNames = new Set<string>();
  return models.filter((model) => {
    if (seenNames.has(model.name)) return false;
    seenNames.add(model.name);
    return true;
  });
}

/**
 * Transforms a raw model from API response to DynamicModelInfo
 */
export function transformModel(
  modelId: string,
  displayName: string,
  supportedFileMimeTypes: string[],
  contextWindow?: number,
): DynamicModelInfo {
  const capabilities = getModelCapabilities(modelId);

  return {
    id: modelId,
    name: displayName,
    contextWindow,

    // Core capabilities from unified system
    isToolCallSupported: capabilities.isToolCallSupported,
    isImageInputSupported: capabilities.isImageInputSupported,
    isReasoningModel: capabilities.isReasoningModel,
    requiresResponsesAPI: capabilities.requiresResponsesAPI,

    // Rich capabilities
    reasoningEffort: capabilities.reasoningEffort,
    thinkingLevel: capabilities.thinkingLevel,
    nativeStructuredOutputs: capabilities.nativeStructuredOutputs,

    // Workflow-specific
    workflowGenerationSupport: capabilities.workflowGenerationSupport,
    toolCallUnsupportedReason: capabilities.toolCallUnsupportedReason,

    supportedFileMimeTypes,
  };
}

/**
 * Handles fetch errors with consistent logging
 */
export function handleFetchError(
  error: unknown,
  providerName: string,
): DynamicModelInfo[] {
  if (error instanceof Error && error.name === "AbortError") {
    logger.warn(`${providerName} models fetch timed out`);
  } else {
    logger.error(`Failed to fetch ${providerName} models:`, error);
  }
  return [];
}

/**
 * Checks if API key is valid (not empty, not placeholder)
 */
export function isValidApiKey(apiKey: string | undefined): apiKey is string {
  return !!apiKey && apiKey !== "****";
}

/**
 * Generic model fetcher that handles common patterns
 */
export async function fetchModelsGeneric(
  config: FetcherConfig,
  timeoutMs: number,
): Promise<DynamicModelInfo[]> {
  const apiKey = process.env[config.apiKeyEnvVar];
  if (!isValidApiKey(apiKey)) {
    return [];
  }

  try {
    const response = await fetchWithTimeout(
      config.apiUrl,
      config.buildHeaders(apiKey),
      timeoutMs,
    );

    if (!response.ok) {
      logger.error(
        `${config.providerName} models API error: ${response.status}`,
      );
      return [];
    }

    const data = (await response.json()) as ModelListResponse;

    // Filter models
    let filteredModels = data.data.filter((model) =>
      config.filterModel(model.id),
    );

    // Sort by priority if provided, then by creation date
    if (config.getModelPriority) {
      const getPriority = config.getModelPriority;
      filteredModels = filteredModels.sort((a, b) => {
        const priorityDiff = getPriority(b.id) - getPriority(a.id);
        if (priorityDiff !== 0) return priorityDiff;
        // Sort by creation date
        const aTime =
          a.created ??
          (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
        const bTime =
          b.created ??
          (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
        return bTime - aTime;
      });
    } else {
      // Just sort by creation date
      filteredModels = filteredModels.sort((a, b) => {
        const aTime =
          a.created ??
          (a.created_at ? new Date(a.created_at).getTime() / 1000 : 0);
        const bTime =
          b.created ??
          (b.created_at ? new Date(b.created_at).getTime() / 1000 : 0);
        return bTime - aTime;
      });
    }

    // Limit number of models if specified
    if (config.maxModels) {
      filteredModels = filteredModels.slice(0, config.maxModels);
    }

    // Transform to DynamicModelInfo
    const transformedModels = filteredModels.map((model) => {
      const normalizedId = config.normalizeModelId?.(model.id) ?? model.id;
      return transformModel(
        normalizedId,
        config.formatDisplayName(normalizedId, model.display_name),
        config.supportedFileMimeTypes,
        model.context_window,
      );
    });

    // Deduplicate by display name
    return deduplicateByName(transformedModels);
  } catch (error) {
    return handleFetchError(error, config.providerName);
  }
}

/**
 * Creates a priority matcher function from a priority map
 */
export function createPriorityMatcher(
  priorities: Record<string, number>,
): (modelId: string) => number {
  return (modelId: string): number => {
    const lowerId = modelId.toLowerCase();
    for (const [prefix, priority] of Object.entries(priorities)) {
      if (lowerId.includes(prefix)) {
        return priority;
      }
    }
    return 0;
  };
}

/**
 * Creates an exclusion filter from patterns
 */
export function createExclusionFilter(
  excludedPatterns: string[],
  requiredPatterns?: string[],
): (modelId: string) => boolean {
  return (modelId: string): boolean => {
    const lowerId = modelId.toLowerCase();

    // Check exclusions
    if (excludedPatterns.some((p) => lowerId.includes(p))) {
      return false;
    }

    // Check required patterns if specified
    if (requiredPatterns && requiredPatterns.length > 0) {
      return requiredPatterns.some((p) => lowerId.includes(p));
    }

    return true;
  };
}
