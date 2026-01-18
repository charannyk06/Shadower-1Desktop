/**
 * Context Management Module
 *
 * Provides token counting, context usage tracking, and automatic
 * conversation compaction for endless chat without token limit errors.
 *
 * Based on Claude Code's context management patterns:
 * - Auto-compact at ~80% context usage
 * - LLM-based summarization of older messages
 * - Preserve recent messages for immediate context
 * - Real-time usage indicators
 */

// Token counting
export {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  calculateContextUsage,
  calculateContextUsageAsync,
  getTokenBreakdown,
  formatTokens,
  getModelContextInfo,
  getModelContextInfoAsync,
  type ContextUsage,
} from "./token-counter";

// Provider limits
export {
  getModelLimits,
  getModelLimitsAsync,
  getEffectiveContextLimit,
  getEffectiveContextLimitAsync,
  getContextWindowSize,
  getContextWindowSizeAsync,
  getMaxOutputTokens,
  getMaxOutputTokensAsync,
  COMPACTION_THRESHOLD,
  PRESERVE_RECENT_MESSAGES,
  MIN_MESSAGES_FOR_COMPACTION,
  type ProviderModelLimits,
} from "./provider-limits";

// Compaction service
export {
  needsCompaction,
  needsCompactionAsync,
  compactMessages,
  createSummaryMessage,
  buildCompactedMessages,
  maybeCompactMessages,
  type CompactionResult,
  type CompactionOptions,
} from "./compaction-service";

// Summary utilities
export {
  SUMMARIZATION_SYSTEM_PROMPT,
  buildSummarizationPrompt,
  formatMessagesForSummarization,
  extractMessageText,
} from "./summary-prompt";
