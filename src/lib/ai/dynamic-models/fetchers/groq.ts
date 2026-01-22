import { formatGroqDisplayName } from "../display-names";
import { DynamicModelInfo } from "../types";
import {
  bearerAuthHeaders,
  createExclusionFilter,
  createPriorityMatcher,
  fetchModelsGeneric,
} from "./shared";

const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

const EXCLUDED_PATTERNS = [
  "whisper",
  "guard",
  "embed",
  "distil",
  "tool-use",
  "safeguard",
  "prompt-guard",
  "orpheus",
  "specdec",
];

const MODEL_PRIORITY: Record<string, number> = {
  "llama-4": 100,
  "gpt-oss-120b": 95,
  "gpt-oss-20b": 90,
  "kimi-k2": 85,
  qwen3: 80,
  "llama-3.3": 70,
  "llama-3.1": 60,
  gemma: 50,
  mixtral: 40,
};

export async function fetchGroqModels(
  timeoutMs: number,
): Promise<DynamicModelInfo[]> {
  return fetchModelsGeneric(
    {
      providerName: "Groq",
      apiUrl: GROQ_MODELS_URL,
      apiKeyEnvVar: "GROQ_API_KEY",
      buildHeaders: bearerAuthHeaders,
      filterModel: createExclusionFilter(EXCLUDED_PATTERNS),
      formatDisplayName: (id) => formatGroqDisplayName(id),
      getModelPriority: createPriorityMatcher(MODEL_PRIORITY),
      supportedFileMimeTypes: [],
      maxModels: 10,
    },
    timeoutMs,
  );
}
