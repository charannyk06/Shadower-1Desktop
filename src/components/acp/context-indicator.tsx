/**
 * Context Window Indicator Component
 * 
 * Shows token usage and context window status for ACP sessions.
 * Implements P1 Gap #6 from ACP_GAP_ANALYSIS.md
 * 
 * Features:
 * - Visual progress bar for context usage
 * - Token count display
 * - Warning when approaching limit
 * - Context breakdown (system, messages, tools)
 */

"use client";

import  { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Info, Zap, MessageSquare, Settings, Wrench } from "lucide-react";

// Default context window sizes for different agents/models
const MODEL_CONTEXT_SIZES: Record<string, number> = {
  // Claude models
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "claude-3-haiku": 200_000,
  "claude-3.5-sonnet": 200_000,
  "claude-3.5-haiku": 200_000,
  "claude-4-sonnet": 200_000,
  // GPT models
  "gpt-4": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  // Gemini models
  "gemini-pro": 1_000_000,
  "gemini-1.5-pro": 2_000_000,
  "gemini-1.5-flash": 1_000_000,
  // Agent defaults
  "claude-code": 200_000,
  "codex-cli": 128_000,
  "gemini-cli": 1_000_000,
  default: 128_000,
};

export interface ContextBreakdown {
  /** System prompt tokens */
  system?: number;
  /** Message history tokens */
  messages?: number;
  /** Tool definitions tokens */
  tools?: number;
  /** File context tokens */
  files?: number;
  /** Other/unknown tokens */
  other?: number;
}

export interface ContextIndicatorProps {
  /** Current token count */
  tokenCount: number;
  /** Maximum context window size (optional, will use model default) */
  maxTokens?: number;
  /** Model/agent identifier for context size lookup */
  modelId?: string;
  /** Agent ID for context size lookup */
  agentId?: string;
  /** Context breakdown by category */
  breakdown?: ContextBreakdown;
  /** Whether to show detailed breakdown on hover */
  showDetails?: boolean;
  /** Compact mode (just progress bar) */
  compact?: boolean;
  /** Warning threshold (0-1, default 0.75) */
  warningThreshold?: number;
  /** Danger threshold (0-1, default 0.9) */
  dangerThreshold?: number;
  /** Custom class name */
  className?: string;
}

/**
 * Format token count for display
 */
function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return count.toString();
}

/**
 * Get context window size for a model/agent
 */
function getContextSize(modelId?: string, agentId?: string): number {
  if (modelId && MODEL_CONTEXT_SIZES[modelId]) {
    return MODEL_CONTEXT_SIZES[modelId];
  }
  if (agentId && MODEL_CONTEXT_SIZES[agentId]) {
    return MODEL_CONTEXT_SIZES[agentId];
  }
  return MODEL_CONTEXT_SIZES.default;
}

/**
 * Context Indicator Component
 */
export function ContextIndicator({
  tokenCount,
  maxTokens,
  modelId,
  agentId,
  breakdown,
  showDetails = true,
  compact = false,
  warningThreshold = 0.75,
  dangerThreshold = 0.9,
  className,
}: ContextIndicatorProps) {
  // Calculate context usage
  const contextSize = maxTokens || getContextSize(modelId, agentId);
  const usagePercent = Math.min((tokenCount / contextSize) * 100, 100);
  const usageRatio = tokenCount / contextSize;
  
  // Determine status
  const status = useMemo(() => {
    if (usageRatio >= dangerThreshold) return "danger";
    if (usageRatio >= warningThreshold) return "warning";
    return "normal";
  }, [usageRatio, warningThreshold, dangerThreshold]);
  
  // Color based on status
  const statusColor = {
    normal: "bg-blue-500",
    warning: "bg-yellow-500",
    danger: "bg-red-500",
  }[status];
  
  const textColor = {
    normal: "text-muted-foreground",
    warning: "text-yellow-600 dark:text-yellow-400",
    danger: "text-red-600 dark:text-red-400",
  }[status];
  
  // Calculate remaining tokens
  const remaining = Math.max(0, contextSize - tokenCount);
  
  // Breakdown totals
  const breakdownTotal = breakdown
    ? (breakdown.system || 0) +
      (breakdown.messages || 0) +
      (breakdown.tools || 0) +
      (breakdown.files || 0) +
      (breakdown.other || 0)
    : tokenCount;
  
  // Compact mode - just progress bar
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("flex items-center gap-2", className)}>
              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full transition-all", statusColor)}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              {status !== "normal" && (
                <AlertTriangle className={cn("h-3 w-3", textColor)} />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>
              {formatTokens(tokenCount)} / {formatTokens(contextSize)} tokens ({usagePercent.toFixed(0)}%)
            </p>
            {status !== "normal" && (
              <p className={textColor}>
                {status === "warning" ? "Approaching context limit" : "Near context limit!"}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  // Full indicator with hover details
  const content = (
    <div className={cn("flex items-center gap-3", className)}>
      {/* Token count */}
      <div className="flex items-center gap-1.5">
        <Zap className={cn("h-4 w-4", textColor)} />
        <span className={cn("text-sm font-medium tabular-nums", textColor)}>
          {formatTokens(tokenCount)}
        </span>
        <span className="text-xs text-muted-foreground">
          / {formatTokens(contextSize)}
        </span>
      </div>
      
      {/* Progress bar */}
      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all duration-300", statusColor)}
          style={{ width: `${usagePercent}%` }}
        />
      </div>
      
      {/* Percentage */}
      <span className={cn("text-xs tabular-nums", textColor)}>
        {usagePercent.toFixed(0)}%
      </span>
      
      {/* Warning icon */}
      {status !== "normal" && (
        <AlertTriangle className={cn("h-4 w-4", textColor)} />
      )}
    </div>
  );
  
  // With hover details
  if (showDetails) {
    return (
      <HoverCard openDelay={200}>
        <HoverCardTrigger asChild>
          <div className="cursor-help">{content}</div>
        </HoverCardTrigger>
        <HoverCardContent className="w-80" side="bottom" align="end">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Context Window</h4>
              {modelId && (
                <span className="text-xs text-muted-foreground">
                  {modelId}
                </span>
              )}
            </div>
            
            {/* Main stats */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Used:</span>
                <span className={cn("ml-2 font-medium", textColor)}>
                  {formatTokens(tokenCount)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Remaining:</span>
                <span className="ml-2 font-medium text-green-600 dark:text-green-400">
                  {formatTokens(remaining)}
                </span>
              </div>
            </div>
            
            {/* Progress bar with labels */}
            <div className="space-y-1">
              <div className="h-3 bg-muted rounded-full overflow-hidden relative">
                <div
                  className={cn("h-full transition-all", statusColor)}
                  style={{ width: `${usagePercent}%` }}
                />
                {/* Warning threshold marker */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-yellow-500/50"
                  style={{ left: `${warningThreshold * 100}%` }}
                />
                {/* Danger threshold marker */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500/50"
                  style={{ left: `${dangerThreshold * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0</span>
                <span>{formatTokens(contextSize)}</span>
              </div>
            </div>
            
            {/* Breakdown */}
            {breakdown && (
              <div className="space-y-2 pt-2 border-t">
                <h5 className="text-xs font-medium text-muted-foreground uppercase">
                  Breakdown
                </h5>
                <div className="space-y-1.5">
                  {breakdown.system !== undefined && breakdown.system > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Settings className="h-3 w-3" />
                        System
                      </span>
                      <span className="tabular-nums">{formatTokens(breakdown.system)}</span>
                    </div>
                  )}
                  {breakdown.messages !== undefined && breakdown.messages > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <MessageSquare className="h-3 w-3" />
                        Messages
                      </span>
                      <span className="tabular-nums">{formatTokens(breakdown.messages)}</span>
                    </div>
                  )}
                  {breakdown.tools !== undefined && breakdown.tools > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Wrench className="h-3 w-3" />
                        Tools
                      </span>
                      <span className="tabular-nums">{formatTokens(breakdown.tools)}</span>
                    </div>
                  )}
                  {breakdown.files !== undefined && breakdown.files > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        📄 Files
                      </span>
                      <span className="tabular-nums">{formatTokens(breakdown.files)}</span>
                    </div>
                  )}
                  {breakdown.other !== undefined && breakdown.other > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        Other
                      </span>
                      <span className="tabular-nums">{formatTokens(breakdown.other)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Status message */}
            {status !== "normal" && (
              <div
                className={cn(
                  "p-2 rounded text-sm",
                  status === "warning"
                    ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200"
                    : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200"
                )}
              >
                {status === "warning" ? (
                  <>
                    <AlertTriangle className="h-4 w-4 inline mr-1" />
                    Approaching context limit. Consider starting a new session.
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 inline mr-1" />
                    Near context limit! Responses may be truncated.
                  </>
                )}
              </div>
            )}
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }
  
  return content;
}

export default ContextIndicator;

/**
 * Hook for tracking context usage
 */
export function useContextTracking(
  messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }> }>,
  modelId?: string,
  agentId?: string
) {
  // Simple token estimation (rough approximation: 1 token ≈ 4 characters)
  const tokenCount = useMemo(() => {
    let totalChars = 0;
    
    for (const msg of messages) {
      if (msg.parts) {
        for (const part of msg.parts) {
          if (part.type === "text" && part.text) {
            totalChars += part.text.length;
          } else if (part.type === "reasoning" && (part as any).text) {
            totalChars += (part as any).text.length;
          }
        }
      }
    }
    
    // Rough token estimation
    return Math.ceil(totalChars / 4);
  }, [messages]);
  
  const contextSize = getContextSize(modelId, agentId);
  const usagePercent = (tokenCount / contextSize) * 100;
  const isNearLimit = usagePercent >= 75;
  const isAtLimit = usagePercent >= 90;
  
  return {
    tokenCount,
    contextSize,
    usagePercent,
    isNearLimit,
    isAtLimit,
    remaining: contextSize - tokenCount,
  };
}
