"use client";

import { ContextUsageState, appStore } from "@/app/store";
import { cn } from "lib/utils";
import { Sparkles } from "lucide-react";
import { useMemo, useRef } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { useShallow } from "zustand/shallow";

interface ContextIndicatorProps {
  threadId?: string;
  className?: string;
  showLabel?: boolean;
  compact?: boolean;
}

/**
 * Formats token count for display
 */
function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * Get color class based on context usage percentage
 */
function getUsageColor(percentage: number): {
  ring: string;
  text: string;
} {
  if (percentage >= 0.9) {
    return { ring: "stroke-red-500", text: "text-red-500" };
  }
  if (percentage >= 0.75) {
    return { ring: "stroke-yellow-500", text: "text-yellow-500" };
  }
  if (percentage >= 0.5) {
    return { ring: "stroke-blue-500", text: "text-blue-500" };
  }
  return { ring: "stroke-green-500", text: "text-green-500" };
}

/**
 * Circular progress ring component
 */
function CircularProgressRing({
  percentage,
  color,
  size = 20,
  strokeWidth = 2,
}: {
  percentage: number;
  color: string;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - percentage * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {/* Background ring - darker shade for unfilled portion */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        className="text-border dark:text-border/80"
      />
      {/* Progress ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={cn(color, "transition-all duration-200")}
      />
    </svg>
  );
}

/**
 * Context indicator component - shows current context usage with real-time updates
 */
export function ContextIndicator({
  threadId,
  className,
  compact = false,
}: ContextIndicatorProps) {
  // Get currentThreadId first (rarely changes)
  const currentThreadId = appStore((state) => state.currentThreadId);
  const effectiveThreadId = threadId || currentThreadId;

  // Subscribe to individual primitive values for proper reactivity
  // Each selector returns a primitive, ensuring React re-renders on changes
  const usedTokens = appStore((state) =>
    effectiveThreadId
      ? state.threadContextUsage[effectiveThreadId]?.usedTokens
      : undefined,
  );
  const limit = appStore((state) =>
    effectiveThreadId
      ? state.threadContextUsage[effectiveThreadId]?.limit
      : undefined,
  );
  const percentage = appStore((state) =>
    effectiveThreadId
      ? state.threadContextUsage[effectiveThreadId]?.percentage
      : undefined,
  );
  const remaining = appStore((state) =>
    effectiveThreadId
      ? state.threadContextUsage[effectiveThreadId]?.remaining
      : undefined,
  );
  const lastCompaction = appStore(
    useShallow((state) =>
      effectiveThreadId
        ? state.threadContextUsage[effectiveThreadId]?.lastCompaction
        : undefined,
    ),
  );

  // Debug: Track re-renders
  const renderCount = useRef(0);
  renderCount.current += 1;

  // Log when usage changes to verify reactivity - LOG EVERY TIME to see actual values
  console.log("[ContextIndicator] Render #" + renderCount.current, {
    threadId: effectiveThreadId,
    usedTokens,
    limit,
    percentage:
      percentage !== undefined ? (percentage * 100).toFixed(2) + "%" : "N/A",
    remaining,
  });

  // Calculate display values - depend on individual primitive values for proper reactivity
  const displayData = useMemo(() => {
    if (
      usedTokens === undefined ||
      limit === undefined ||
      percentage === undefined ||
      limit === 0
    ) {
      return null;
    }

    const percentDisplay =
      percentage < 0.1
        ? (percentage * 100).toFixed(2)
        : (percentage * 100).toFixed(1);

    // Check if compaction happened recently (within 10 seconds)
    const recentCompaction = lastCompaction?.timestamp
      ? Date.now() - lastCompaction.timestamp < 10000
      : false;

    return {
      usedTokens,
      limit,
      remaining: remaining ?? 0,
      percentage,
      percentDisplay,
      colors: getUsageColor(percentage),
      lastCompaction,
      recentCompaction,
    };
  }, [usedTokens, limit, remaining, percentage, lastCompaction]);

  // Don't render if no usage data
  if (!displayData) {
    return null;
  }

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-1.5 cursor-default",
              className,
            )}
          >
            {displayData.recentCompaction && (
              <Sparkles className="size-3 text-purple-500 animate-pulse" />
            )}
            <CircularProgressRing
              percentage={displayData.percentage}
              color={displayData.colors.ring}
              size={20}
              strokeWidth={2.5}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <ContextTooltipContent
            usedTokens={displayData.usedTokens}
            limit={displayData.limit}
            remaining={displayData.remaining}
            percentage={displayData.percentage}
            lastCompaction={displayData.lastCompaction}
          />
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-2 text-xs cursor-default",
            className,
          )}
        >
          {displayData.recentCompaction && (
            <Sparkles className="size-4 text-purple-500 animate-pulse" />
          )}
          <CircularProgressRing
            percentage={displayData.percentage}
            color={displayData.colors.ring}
            size={24}
            strokeWidth={3}
          />
          <span className="text-muted-foreground tabular-nums">
            {formatTokens(displayData.usedTokens)} /{" "}
            {formatTokens(displayData.limit)}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <ContextTooltipContent
          usedTokens={displayData.usedTokens}
          limit={displayData.limit}
          remaining={displayData.remaining}
          percentage={displayData.percentage}
          lastCompaction={displayData.lastCompaction}
        />
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Tooltip content showing detailed context information
 */
function ContextTooltipContent({
  usedTokens,
  limit,
  remaining,
  percentage,
  lastCompaction,
}: {
  usedTokens: number;
  limit: number;
  remaining: number;
  percentage: number;
  lastCompaction?: ContextUsageState["lastCompaction"];
}) {
  const colors = getUsageColor(percentage);
  const percentDisplay = Math.round(percentage * 100);

  return (
    <div className="space-y-2 p-1 min-w-48">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Context Usage</span>
        <span className={cn("font-medium", colors.text)}>
          {percentDisplay}%
        </span>
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Used</span>
          <span>{formatTokens(usedTokens)} tokens</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Limit</span>
          <span>{formatTokens(limit)} tokens</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Remaining</span>
          <span>{formatTokens(remaining)} tokens</span>
        </div>
      </div>

      {lastCompaction && (
        <div className="pt-2 border-t border-border">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3" />
            <span>
              Compacted {lastCompaction.compactedCount} messages, saved{" "}
              {formatTokens(lastCompaction.tokensSaved)} tokens
            </span>
          </div>
        </div>
      )}

      {percentage >= 0.75 && (
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {percentage >= 0.9
              ? "Context is nearly full. Auto-compaction will trigger soon."
              : "Context usage is high. Older messages will be summarized if needed."}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Compact badge showing compaction activity
 */
export function CompactionBadge({
  compactedCount,
  tokensSaved,
  className,
}: {
  compactedCount: number;
  tokensSaved: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/10 text-purple-500 text-xs",
        className,
      )}
    >
      <Sparkles className="size-3" />
      <span>
        Compressed {compactedCount} messages ({formatTokens(tokensSaved)} tokens
        saved)
      </span>
    </div>
  );
}
