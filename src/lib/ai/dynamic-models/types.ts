import "server-only";
import type {
  ReasoningEffort,
  ThinkingLevel,
  ToolCallUnsupportedReason,
  Verbosity,
  WorkflowGenerationSupport,
} from "../providers/types";

/**
 * Dynamic model information with rich capability fields
 * Extended to match Sim Studio's model capability system
 */
export interface DynamicModelInfo {
  id: string;
  name: string;
  description?: string;

  // Core capabilities
  isToolCallSupported: boolean;
  isImageInputSupported: boolean;
  isReasoningModel: boolean;

  /** Models that require OpenAI Responses API instead of Chat Completions (e.g., codex, computer-use) */
  requiresResponsesAPI?: boolean;

  // Rich capabilities (like Sim)
  /** Supported reasoning effort levels for reasoning models */
  reasoningEffort?: ReasoningEffort[];
  /** Supported thinking levels for models with thinking/extended thinking */
  thinkingLevel?: ThinkingLevel[];
  /** Supported verbosity levels */
  verbosity?: Verbosity[];
  /** Whether the model supports native JSON schema structured outputs */
  nativeStructuredOutputs?: boolean;

  // Workflow-specific
  /** Whether this model supports workflow generation */
  workflowGenerationSupport: WorkflowGenerationSupport;
  /** Reason why tool calling is not supported (if applicable) */
  toolCallUnsupportedReason?: ToolCallUnsupportedReason;

  // Limits
  contextWindow?: number;
  maxOutputTokens?: number;
  supportedFileMimeTypes: string[];
}

export interface ProviderModelsResult {
  provider: string;
  models: DynamicModelInfo[];
  hasAPIKey: boolean;
  fetchedAt: number;
  error?: string;
}

export interface ModelFetcherConfig {
  cacheTtlMs: number;
  timeoutMs: number;
  enableDynamicFetch: boolean;
}

export const DEFAULT_FETCHER_CONFIG: ModelFetcherConfig = {
  cacheTtlMs: 60 * 60 * 1000, // 1 hour
  timeoutMs: 10000, // 10 seconds
  enableDynamicFetch: true,
};

export type ProviderName =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "groq"
  | "openRouter"
  | "ollama"
  | "cerebras";
