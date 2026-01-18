import "server-only";

import { LanguageModel, UIMessage, generateText } from "ai";
import { colorize } from "consola/utils";
import globalLogger from "logger";

import { conversationSummaryRepository } from "lib/db/repository";
import {
  COMPACTION_THRESHOLD,
  MIN_MESSAGES_FOR_COMPACTION,
  PRESERVE_RECENT_MESSAGES,
} from "./provider-limits";
import {
  SUMMARIZATION_SYSTEM_PROMPT,
  buildSummarizationPrompt,
  formatMessagesForSummarization,
} from "./summary-prompt";
import {
  ContextUsage,
  calculateContextUsage,
  calculateContextUsageAsync,
  estimateMessagesTokens,
  estimateTokens,
} from "./token-counter";

const logger = globalLogger.withDefaults({
  message: colorize("magenta", `[Context Compaction] `),
});

/**
 * Result of a compaction operation
 */
export interface CompactionResult {
  /** The generated summary of older messages */
  summary: string;
  /** Messages that were preserved (not summarized) */
  preservedMessages: UIMessage[];
  /** Number of messages that were compacted into the summary */
  compactedCount: number;
  /** Estimated tokens saved by compaction */
  tokensSaved: number;
  /** Token count of the summary */
  summaryTokens: number;
  /** Whether compaction actually occurred */
  didCompact: boolean;
}

/**
 * Options for compaction
 */
export interface CompactionOptions {
  /** Number of recent messages to preserve (not summarize) */
  preserveCount?: number;
  /** Thread ID for logging/tracking and database persistence */
  threadId?: string;
  /** User ID for database persistence */
  userId?: string;
  /** Custom threshold for triggering compaction (0-1) */
  threshold?: number;
  /** Additional context to preserve in the summary */
  additionalContext?: string;
  /** Whether to persist the summary to the database */
  persistSummary?: boolean;
}

/**
 * Check if compaction is needed based on context usage
 *
 * ⚠️ DEPRECATED: This sync version uses static fallbacks.
 * Use needsCompactionAsync instead for dynamic limits.
 */
export function needsCompaction(
  messages: UIMessage[],
  provider: string,
  model: string,
  systemPromptTokens: number = 0,
  threshold: number = COMPACTION_THRESHOLD,
): { needed: boolean; usage: ContextUsage } {
  logger.warn(
    `[Compaction] Using deprecated sync needsCompaction for ${provider}/${model} - use async version instead!`,
  );
  const usage = calculateContextUsage(
    messages,
    provider,
    model,
    systemPromptTokens,
    threshold,
  );

  // Don't compact very short conversations
  const hasEnoughMessages = messages.length >= MIN_MESSAGES_FOR_COMPACTION;

  return {
    needed: usage.needsCompaction && hasEnoughMessages,
    usage,
  };
}

/**
 * Check if compaction is needed based on context usage (async version)
 * ALWAYS uses dynamically fetched model limits from provider APIs
 *
 * This is the PRIMARY method - it ensures we always have up-to-date limits.
 */
export async function needsCompactionAsync(
  messages: UIMessage[],
  provider: string,
  model: string,
  systemPromptTokens: number = 0,
  threshold: number = COMPACTION_THRESHOLD,
): Promise<{ needed: boolean; usage: ContextUsage }> {
  const usage = await calculateContextUsageAsync(
    messages,
    provider,
    model,
    systemPromptTokens,
    threshold,
  );

  // Don't compact very short conversations
  const hasEnoughMessages = messages.length >= MIN_MESSAGES_FOR_COMPACTION;

  return {
    needed: usage.needsCompaction && hasEnoughMessages,
    usage,
  };
}

/**
 * Split messages into those to be compacted and those to preserve
 */
function splitMessages(
  messages: UIMessage[],
  preserveCount: number,
): { toCompact: UIMessage[]; toPreserve: UIMessage[] } {
  // Ensure we don't try to preserve more messages than we have
  const actualPreserveCount = Math.min(preserveCount, messages.length - 1);

  // Always keep at least the first message for context
  const splitIndex = Math.max(1, messages.length - actualPreserveCount);

  return {
    toCompact: messages.slice(0, splitIndex),
    toPreserve: messages.slice(splitIndex),
  };
}

/**
 * Generate a summary of messages using the LLM
 */
async function generateSummary(
  model: LanguageModel,
  messages: UIMessage[],
  additionalContext?: string,
): Promise<string> {
  const conversationText = formatMessagesForSummarization(messages);
  const userPrompt = buildSummarizationPrompt(
    conversationText,
    additionalContext,
  );

  logger.info(`Generating summary for ${messages.length} messages`);

  try {
    const result = await generateText({
      model,
      system: SUMMARIZATION_SYSTEM_PROMPT,
      prompt: userPrompt,
      maxOutputTokens: 4096, // Summary should be concise
      temperature: 0.3, // Low temperature for consistent summaries
    });

    logger.info(`Summary generated: ${result.text.length} chars`);
    return result.text;
  } catch (error) {
    logger.error("Failed to generate summary:", error);
    throw error;
  }
}

/**
 * Compact messages by summarizing older ones
 *
 * This is the main entry point for context compaction.
 * It generates a summary of older messages and returns
 * the summary along with the preserved recent messages.
 */
export async function compactMessages(
  messages: UIMessage[],
  model: LanguageModel,
  provider: string,
  modelName: string,
  options: CompactionOptions = {},
): Promise<CompactionResult> {
  const {
    preserveCount = PRESERVE_RECENT_MESSAGES,
    threadId,
    userId,
    additionalContext,
    persistSummary = true,
  } = options;

  logger.info(
    `Starting compaction for thread ${threadId || "unknown"}, ` +
      `${messages.length} messages, preserving ${preserveCount}`,
  );

  // Check if we have enough messages to compact
  if (messages.length < MIN_MESSAGES_FOR_COMPACTION) {
    logger.info("Not enough messages to compact, skipping");
    return {
      summary: "",
      preservedMessages: messages,
      compactedCount: 0,
      tokensSaved: 0,
      summaryTokens: 0,
      didCompact: false,
    };
  }

  // Split messages
  const { toCompact, toPreserve } = splitMessages(messages, preserveCount);

  if (toCompact.length === 0) {
    logger.info("No messages to compact after split");
    return {
      summary: "",
      preservedMessages: messages,
      compactedCount: 0,
      tokensSaved: 0,
      summaryTokens: 0,
      didCompact: false,
    };
  }

  // Calculate tokens before compaction
  const tokensBeforeCompaction = estimateMessagesTokens(toCompact);

  // Generate summary
  const summary = await generateSummary(model, toCompact, additionalContext);
  const summaryTokens = estimateTokens(summary);

  // Calculate tokens saved
  const tokensSaved = Math.max(0, tokensBeforeCompaction - summaryTokens);

  logger.info(
    `Compaction complete: ${toCompact.length} messages -> ${summaryTokens} tokens summary, ` +
      `saved ~${tokensSaved} tokens`,
  );

  // Persist summary to database for long-term memory
  if (persistSummary && threadId && userId) {
    try {
      await conversationSummaryRepository.create({
        threadId,
        userId,
        summary,
        messagesCompacted: toCompact.length,
        tokensSaved,
        summaryTokens,
        modelProvider: provider,
        modelName,
      });
      logger.info(`Summary persisted to database for thread ${threadId}`);
    } catch (error) {
      logger.error("Failed to persist summary to database:", error);
      // Continue even if persistence fails - the compaction still succeeded
    }
  }

  return {
    summary,
    preservedMessages: toPreserve,
    compactedCount: toCompact.length,
    tokensSaved,
    summaryTokens,
    didCompact: true,
  };
}

/**
 * Create a summary message to prepend to preserved messages
 * This creates a properly formatted UIMessage containing the summary
 */
export function createSummaryMessage(
  summary: string,
  compactedCount: number,
): UIMessage {
  return {
    id: `summary-${Date.now()}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: `## Previous Conversation Summary\n\n*This summary covers the first ${compactedCount} messages of this conversation to maintain context while staying within model limits.*\n\n${summary}`,
      },
    ],
  };
}

/**
 * Build the final message array after compaction
 * Prepends the summary message to the preserved messages
 */
export function buildCompactedMessages(result: CompactionResult): UIMessage[] {
  if (!result.didCompact || !result.summary) {
    return result.preservedMessages;
  }

  const summaryMessage = createSummaryMessage(
    result.summary,
    result.compactedCount,
  );

  return [summaryMessage, ...result.preservedMessages];
}

/**
 * Full compaction pipeline - checks if needed and performs compaction
 * Returns the potentially compacted messages ready for use
 *
 * Uses dynamic model limits from provider APIs when available.
 */
export async function maybeCompactMessages(
  messages: UIMessage[],
  model: LanguageModel,
  provider: string,
  modelName: string,
  systemPromptTokens: number = 0,
  options: CompactionOptions = {},
): Promise<{
  messages: UIMessage[];
  compactionResult: CompactionResult | null;
  usage: ContextUsage;
}> {
  const threshold = options.threshold ?? COMPACTION_THRESHOLD;

  // Check if compaction is needed (using dynamic limits)
  const { needed, usage } = await needsCompactionAsync(
    messages,
    provider,
    modelName,
    systemPromptTokens,
    threshold,
  );

  if (!needed) {
    logger.debug(
      `Compaction not needed: ${(usage.percentage * 100).toFixed(1)}% of context used`,
    );
    return {
      messages,
      compactionResult: null,
      usage,
    };
  }

  logger.info(
    `Compaction triggered at ${(usage.percentage * 100).toFixed(1)}% context usage`,
  );

  // Perform compaction
  const compactionResult = await compactMessages(
    messages,
    model,
    provider,
    modelName,
    options,
  );

  // Build final messages
  const compactedMessages = buildCompactedMessages(compactionResult);

  // Calculate new usage (using dynamic limits)
  const newUsage = await calculateContextUsageAsync(
    compactedMessages,
    provider,
    modelName,
    systemPromptTokens,
    threshold,
  );

  logger.info(
    `After compaction: ${(newUsage.percentage * 100).toFixed(1)}% context used ` +
      `(was ${(usage.percentage * 100).toFixed(1)}%)`,
  );

  return {
    messages: compactedMessages,
    compactionResult,
    usage: newUsage,
  };
}
