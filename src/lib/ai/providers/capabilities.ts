import "server-only";
import type {
  ModelCapabilities,
  ReasoningEffort,
  ThinkingLevel,
  ToolCallUnsupportedReason,
  WorkflowGenerationSupport,
} from "./types";

// =============================================================================
// CENTRALIZED MODEL PATTERNS - Single source of truth
// =============================================================================

/**
 * Patterns for identifying reasoning-capable models
 * Following Sim's pattern: reasoning models CAN use tools alongside reasoning
 * The reasoning_effort parameter controls the reasoning level, not tool compatibility
 */
const REASONING_MODEL_PATTERNS: RegExp[] = [
  /(^|[/:-])o[134]/i, // o1, o3, o4-mini (also matches provider prefixes like "openai/o3")
  /gpt-5\.1-codex/i, // gpt-5.1-codex-mini
  /gpt-5/i, // gpt-5 series with reasoning
  /codex/i, // codex models (reasoning-based)
  /deepseek-r1/i, // DeepSeek R1
];

/**
 * Patterns for models with built-in tools that conflict with custom tools
 */
const BUILT_IN_TOOL_PATTERNS: RegExp[] = [
  /gpt-oss/i, // Has python/code_interpreter built-in
];

/**
 * Patterns for models requiring OpenAI Responses API
 * Only computer-use models require this special API - codex models work with standard API
 */
const RESPONSES_API_PATTERNS: RegExp[] = [/computer-use/i];

/**
 * Patterns for image-capable models
 */
const IMAGE_CAPABLE_PATTERNS: RegExp[] = [
  /4o/i, // gpt-4o series
  /4\.1/i, // gpt-4.1 series
  /gpt-5/i, // gpt-5 series
  /gemini/i, // All Gemini models
  /claude/i, // All Claude models
  /grok/i, // Grok models
];

/**
 * Patterns for models with native structured output support
 */
const STRUCTURED_OUTPUT_PATTERNS: RegExp[] = [
  /claude/i,
  /anthropic/i,
  /gemini-[23]/i, // Gemini 2 and 3 series
];

// =============================================================================
// REASONING EFFORT CONFIGURATION
// =============================================================================

/**
 * Models with configurable reasoning effort levels
 * Like Sim's o-series with reasoning effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
 */
const REASONING_EFFORT_MODELS: Record<string, ReasoningEffort[]> = {
  o3: ["none", "minimal", "low", "medium", "high", "xhigh"],
  "o3-mini": ["none", "low", "medium", "high"],
  "o4-mini": ["none", "low", "medium", "high"],
  "gpt-5.1-codex-mini": ["low", "medium", "high"],
};

// =============================================================================
// THINKING LEVEL CONFIGURATION
// =============================================================================

/**
 * Models with thinking/extended thinking support
 * Like Gemini 3 with thinking levels
 */
const THINKING_MODELS: Record<string, ThinkingLevel[]> = {
  "gemini-3-pro-preview": ["none", "low", "medium", "high"],
  "gemini-3-flash-preview": ["none", "low", "medium"],
  "gemini-2.5-pro": ["none", "low", "medium", "high"],
  "claude-opus-4-5-20251101": ["none", "medium", "high"],
  "claude-sonnet-4-5-20250929": ["none", "low", "medium"],
};

// =============================================================================
// DETECTION FUNCTIONS
// =============================================================================

/**
 * Check if a model is a reasoning model
 */
export function isReasoningModel(modelId: string): boolean {
  return REASONING_MODEL_PATTERNS.some((p) => p.test(modelId));
}

/**
 * Check if a model has built-in tools that conflict
 */
export function hasBuiltInTools(modelId: string): boolean {
  return BUILT_IN_TOOL_PATTERNS.some((p) => p.test(modelId));
}

/**
 * Check if a model requires OpenAI Responses API
 */
export function requiresResponsesAPI(modelId: string): boolean {
  return RESPONSES_API_PATTERNS.some((p) => p.test(modelId));
}

/**
 * Check if a model supports image input
 */
export function supportsImageInput(modelId: string): boolean {
  return IMAGE_CAPABLE_PATTERNS.some((p) => p.test(modelId));
}

/**
 * Check if a model supports native structured outputs
 */
export function supportsNativeStructuredOutputs(modelId: string): boolean {
  return STRUCTURED_OUTPUT_PATTERNS.some((p) => p.test(modelId));
}

/**
 * Get reasoning effort levels for a model
 * Returns undefined if model doesn't support configurable reasoning effort
 */
export function getReasoningEffortLevels(
  modelId: string,
): ReasoningEffort[] | undefined {
  const lowerModelId = modelId.toLowerCase();

  // Sort by pattern length descending to match more specific patterns first
  // e.g., "o3-mini" should match before "o3"
  const sortedEntries = Object.entries(REASONING_EFFORT_MODELS).sort(
    ([a], [b]) => b.length - a.length,
  );

  for (const [pattern, levels] of sortedEntries) {
    if (lowerModelId.includes(pattern.toLowerCase())) {
      return levels;
    }
  }
  return undefined;
}

/**
 * Get thinking levels for a model
 * Returns undefined if model doesn't support thinking mode
 */
export function getThinkingLevels(
  modelId: string,
): ThinkingLevel[] | undefined {
  const lowerModelId = modelId.toLowerCase();

  for (const [pattern, levels] of Object.entries(THINKING_MODELS)) {
    if (lowerModelId.includes(pattern.toLowerCase())) {
      return levels;
    }
  }
  return undefined;
}

// =============================================================================
// MAIN CAPABILITY DETECTION
// =============================================================================

/**
 * Get comprehensive model capabilities
 * This is the main entry point for capability detection
 *
 * Following Sim's pattern: Reasoning models CAN use tools alongside reasoning.
 * The reasoning_effort parameter controls the reasoning level, not tool compatibility.
 */
export function getModelCapabilities(modelId: string): ModelCapabilities {
  const isReasoning = isReasoningModel(modelId);
  const hasBuiltIn = hasBuiltInTools(modelId);
  const needsResponsesAPI = requiresResponsesAPI(modelId);

  // Determine tool support - Following Sim's pattern:
  // - Reasoning models CAN use tools (reasoning + tools work together)
  // - Only block models with built-in tools or requiring Responses API
  const isToolCallSupported = !hasBuiltIn && !needsResponsesAPI;

  // Determine workflow support and reason for unsupported
  let workflowGenerationSupport: WorkflowGenerationSupport = "full";
  let toolCallUnsupportedReason: ToolCallUnsupportedReason | undefined;

  // Only block models with built-in tools or Responses API requirement
  // Reasoning models are NOT blocked - they support tools + reasoning together
  if (hasBuiltIn) {
    workflowGenerationSupport = "none";
    toolCallUnsupportedReason = "built-in-tools";
  } else if (needsResponsesAPI) {
    workflowGenerationSupport = "none";
    toolCallUnsupportedReason = "responses-api-only";
  }

  return {
    isReasoningModel: isReasoning,
    isToolCallSupported,
    isImageInputSupported: supportsImageInput(modelId),
    reasoningEffort: getReasoningEffortLevels(modelId),
    thinkingLevel: getThinkingLevels(modelId),
    workflowGenerationSupport,
    toolCallUnsupportedReason,
    requiresResponsesAPI: needsResponsesAPI,
    nativeStructuredOutputs: supportsNativeStructuredOutputs(modelId),
  };
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Check if a model supports workflow generation
 * Convenience function for quick validation
 */
export function supportsWorkflowGeneration(modelId: string): boolean {
  return getModelCapabilities(modelId).workflowGenerationSupport !== "none";
}

/**
 * Check if a model is unsupported for tool calling
 * Legacy compatibility function - use getModelCapabilities() for new code
 */
export function isToolCallUnsupportedModel(modelId: string): boolean {
  return !getModelCapabilities(modelId).isToolCallSupported;
}

/**
 * Get a human-readable reason why a model doesn't support workflow generation
 */
export function getWorkflowUnsupportedReason(modelId: string): string | null {
  const capabilities = getModelCapabilities(modelId);

  if (capabilities.workflowGenerationSupport === "full") {
    return null;
  }

  switch (capabilities.toolCallUnsupportedReason) {
    case "built-in-tools":
      return "This model has built-in tools (like code interpreter) that conflict with custom workflow tools.";
    case "responses-api-only":
      return "This model requires a special API format that isn't compatible with workflow generation.";
    default:
      return "This model has limitations with tool calling.";
  }
}

/**
 * Get suggested alternative models for workflow generation
 */
export function getSuggestedWorkflowModels(): Array<{
  model: string;
  provider: string;
}> {
  return [
    { model: "gemini-3-flash-preview", provider: "google" },
    { model: "gpt-4o-mini", provider: "openai" },
    { model: "claude-sonnet-4-20250514", provider: "anthropic" },
  ];
}
