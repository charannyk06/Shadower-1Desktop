import "server-only";

import { UIMessage } from "ai";
import logger from "logger";
import {
  getEffectiveContextLimit,
  getEffectiveContextLimitAsync,
  getModelLimits,
  getModelLimitsAsync,
} from "./provider-limits";

/**
 * Token counting utilities for context management
 *
 * Uses estimation-based approach that works across all providers.
 * While not as accurate as tiktoken for OpenAI models, the estimation
 * is conservative and works reliably for all providers.
 */

// Average characters per token varies by content type
// Using conservative estimates to avoid context overflow
const CHARS_PER_TOKEN = {
  text: 4, // English text averages ~4 chars/token
  code: 3.5, // Code tends to be more token-dense
  json: 3, // JSON/structured data is very token-dense
  mixed: 3.5, // Conservative default for mixed content
};

/**
 * Estimate token count for a string
 * Uses character-based estimation with content type detection
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  // Detect content type for better estimation
  const isLikelyCode = /[{}\[\]();]/.test(text) && /\n/.test(text);
  const isLikelyJson =
    text.trim().startsWith("{") || text.trim().startsWith("[");

  let charsPerToken = CHARS_PER_TOKEN.text;
  if (isLikelyJson) {
    charsPerToken = CHARS_PER_TOKEN.json;
  } else if (isLikelyCode) {
    charsPerToken = CHARS_PER_TOKEN.code;
  }

  return Math.ceil(text.length / charsPerToken);
}

/**
 * Estimate tokens for a single message part
 */
function estimatePartTokens(part: any): number {
  if (!part) return 0;

  switch (part.type) {
    case "text":
      return estimateTokens(part.text || "");

    case "tool-invocation":
    case "tool-result":
      // Tool calls include name, args, and output
      const toolTokens = estimateTokens(JSON.stringify(part));
      return toolTokens;

    case "file":
    case "image":
      // Files/images have metadata + content
      // Images are typically processed separately, but metadata counts
      return estimateTokens(
        JSON.stringify({
          type: part.type,
          url: part.url,
          mediaType: part.mediaType,
          filename: part.filename,
        }),
      );

    default:
      // Generic fallback - stringify and estimate
      return estimateTokens(JSON.stringify(part));
  }
}

/**
 * Estimate total tokens for a single message
 */
export function estimateMessageTokens(message: UIMessage): number {
  if (!message || !message.parts) return 0;

  let total = 0;

  // Role adds a small overhead
  total += 4; // ~1 token for role marker

  // Count tokens for each part
  for (const part of message.parts) {
    total += estimatePartTokens(part);
  }

  // Message overhead (separators, formatting)
  total += 4;

  return total;
}

/**
 * Estimate total tokens for an array of messages
 */
export function estimateMessagesTokens(messages: UIMessage[]): number {
  if (!messages || messages.length === 0) return 0;

  let total = 0;

  for (const message of messages) {
    total += estimateMessageTokens(message);
  }

  // Conversation overhead
  total += 10;

  return total;
}

/**
 * Context usage information
 */
export interface ContextUsage {
  usedTokens: number;
  limit: number;
  percentage: number;
  remaining: number;
  needsCompaction: boolean;
}

/**
 * Calculate context usage for a conversation
 *
 * ⚠️ DEPRECATED: This sync version uses static fallbacks.
 * Use calculateContextUsageAsync instead for dynamic limits.
 */
export function calculateContextUsage(
  messages: UIMessage[],
  provider: string,
  model: string,
  systemPromptTokens: number = 0,
  compactionThreshold: number = 0.8,
): ContextUsage {
  logger.warn(
    `[Context] Using deprecated sync calculateContextUsage for ${provider}/${model} - use async version instead!`,
  );
  const usedTokens = estimateMessagesTokens(messages) + systemPromptTokens;
  const limit = getEffectiveContextLimit(provider, model);
  const percentage = usedTokens / limit;
  const remaining = Math.max(0, limit - usedTokens);
  const needsCompaction = percentage >= compactionThreshold;

  return {
    usedTokens,
    limit,
    percentage,
    remaining,
    needsCompaction,
  };
}

/**
 * Calculate context usage for a conversation (async version)
 * ALWAYS uses dynamically fetched model limits from provider APIs
 *
 * This is the PRIMARY method - it ensures we always have up-to-date limits.
 */
export async function calculateContextUsageAsync(
  messages: UIMessage[],
  provider: string,
  model: string,
  systemPromptTokens: number = 0,
  compactionThreshold: number = 0.8,
): Promise<ContextUsage> {
  const usedTokens = estimateMessagesTokens(messages) + systemPromptTokens;
  const limit = await getEffectiveContextLimitAsync(provider, model);
  const percentage = usedTokens / limit;
  const remaining = Math.max(0, limit - usedTokens);
  const needsCompaction = percentage >= compactionThreshold;

  return {
    usedTokens,
    limit,
    percentage,
    remaining,
    needsCompaction,
  };
}

/**
 * Get detailed token breakdown for messages
 * Useful for debugging and UI display
 */
export function getTokenBreakdown(messages: UIMessage[]): {
  total: number;
  byMessage: { id: string; role: string; tokens: number }[];
  byRole: { user: number; assistant: number; system: number; tool: number };
} {
  const byMessage: { id: string; role: string; tokens: number }[] = [];
  const byRole = { user: 0, assistant: 0, system: 0, tool: 0 };
  let total = 0;

  for (const message of messages) {
    const tokens = estimateMessageTokens(message);
    total += tokens;

    byMessage.push({
      id: message.id,
      role: message.role,
      tokens,
    });

    if (message.role === "user") byRole.user += tokens;
    else if (message.role === "assistant") byRole.assistant += tokens;
    else if (message.role === "system") byRole.system += tokens;
    else if (message.role === "tool") byRole.tool += tokens;
  }

  return { total, byMessage, byRole };
}

/**
 * Format token count for display (e.g., "12.5K")
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}K`;
  if (tokens < 1000000) return `${Math.round(tokens / 1000)}K`;
  return `${(tokens / 1000000).toFixed(1)}M`;
}

/**
 * Get model information for display
 *
 * This is the synchronous version that uses static fallbacks.
 * For dynamic limits, use getModelContextInfoAsync instead.
 */
export function getModelContextInfo(
  provider: string,
  model: string,
): {
  contextWindow: number;
  effectiveLimit: number;
  maxOutput: number;
  formattedWindow: string;
  formattedLimit: string;
} {
  const limits = getModelLimits(provider, model);
  return {
    contextWindow: limits.contextWindow,
    effectiveLimit: limits.effectiveLimit,
    maxOutput: limits.maxOutputTokens,
    formattedWindow: formatTokens(limits.contextWindow),
    formattedLimit: formatTokens(limits.effectiveLimit),
  };
}

/**
 * Get model information for display (async version)
 * First checks dynamically fetched model limits from APIs, then falls back to static values
 */
export async function getModelContextInfoAsync(
  provider: string,
  model: string,
): Promise<{
  contextWindow: number;
  effectiveLimit: number;
  maxOutput: number;
  formattedWindow: string;
  formattedLimit: string;
}> {
  const limits = await getModelLimitsAsync(provider, model);
  return {
    contextWindow: limits.contextWindow,
    effectiveLimit: limits.effectiveLimit,
    maxOutput: limits.maxOutputTokens,
    formattedWindow: formatTokens(limits.contextWindow),
    formattedLimit: formatTokens(limits.effectiveLimit),
  };
}
