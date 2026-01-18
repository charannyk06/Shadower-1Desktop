import "server-only";

import { formatAnthropicDisplayName } from "../display-names";
import { DynamicModelInfo } from "../types";
import {
  anthropicAuthHeaders,
  createExclusionFilter,
  fetchModelsGeneric,
} from "./shared";

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";

const ANTHROPIC_FILE_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/html",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export async function fetchAnthropicModels(
  timeoutMs: number,
): Promise<DynamicModelInfo[]> {
  return fetchModelsGeneric(
    {
      providerName: "Anthropic",
      apiUrl: ANTHROPIC_MODELS_URL,
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
      buildHeaders: anthropicAuthHeaders,
      filterModel: createExclusionFilter([], ["claude"]),
      formatDisplayName: (id, displayName) =>
        formatAnthropicDisplayName(id, displayName),
      supportedFileMimeTypes: ANTHROPIC_FILE_TYPES,
    },
    timeoutMs,
  );
}
