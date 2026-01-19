import "server-only";
import type { LanguageModel } from "ai";

/**
 * Supported AI provider identifiers
 */
export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "groq"
  | "openRouter"
  | "ollama"
  | "lmstudio"
  | "cerebras";

/**
 * Reasoning effort levels for models that support configurable reasoning
 * Like Sim's o-series models with reasoning effort control
 */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

/**
 * Thinking levels for models with thinking/extended thinking support
 * Like Gemini 3 and Claude Opus with thinking modes
 */
export type ThinkingLevel = "none" | "low" | "medium" | "high";

/**
 * Output verbosity control levels
 */
export type Verbosity = "low" | "medium" | "high";

/**
 * Tool usage control modes
 * - auto: Model decides when to use tools
 * - force: Force the model to use a specific tool
 * - none: Disable tool usage
 */
export type ToolUsageControl = "auto" | "force" | "none";

/**
 * Workflow generation support levels
 * - full: Model fully supports workflow generation with tool calling
 * - limited: Model has some limitations but can be used
 * - none: Model cannot be used for workflow generation
 */
export type WorkflowGenerationSupport = "full" | "limited" | "none";

/**
 * Reasons why a model doesn't support tool calling
 */
export type ToolCallUnsupportedReason =
  | "reasoning-model" // Generates reasoning tokens incompatible with tools
  | "built-in-tools" // Has built-in tools that conflict (GPT-OSS)
  | "responses-api-only"; // Uses Responses API (codex, computer-use)

/**
 * Comprehensive model capabilities interface
 * Inspired by Sim Studio's model capability system
 */
export interface ModelCapabilities {
  // Core capabilities
  isReasoningModel: boolean;
  isToolCallSupported: boolean;
  isImageInputSupported: boolean;

  // Advanced features (like Sim)
  reasoningEffort?: ReasoningEffort[]; // Supported reasoning levels
  thinkingLevel?: ThinkingLevel[]; // Thinking mode levels
  verbosity?: Verbosity[]; // Output verbosity control

  // Workflow-specific
  workflowGenerationSupport: WorkflowGenerationSupport;
  toolCallUnsupportedReason?: ToolCallUnsupportedReason;

  // Special handling
  requiresResponsesAPI: boolean; // codex, computer-use
  nativeStructuredOutputs: boolean; // JSON schema support

  // Limits
  contextWindow?: number;
  maxOutputTokens?: number;
  temperature?: { min: number; max: number };
}

/**
 * Provider configuration interface
 * Similar to Sim's ProviderConfig pattern
 */
export interface ProviderConfig {
  id: ProviderId;
  name: string;
  description?: string;

  // Capabilities at provider level
  supportsToolUsageControl: boolean;
  defaultModel: string;

  // Model resolution
  getModel: (modelId: string) => LanguageModel;
  getModelCapabilities: (modelId: string) => ModelCapabilities;
}

/**
 * Default model capabilities for unknown models
 * Conservative defaults - assume full support
 */
export const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  isReasoningModel: false,
  isToolCallSupported: true,
  isImageInputSupported: false,
  workflowGenerationSupport: "full",
  requiresResponsesAPI: false,
  nativeStructuredOutputs: false,
};
