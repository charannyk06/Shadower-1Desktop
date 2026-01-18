"use client";

import { Sparkles } from "lucide-react";
import { memo } from "react";
import { Badge } from "ui/badge";
import { cn } from "lib/utils";

interface ContextCompactionStatusProps {
  compactedCount: number;
  tokensSaved: number;
  oldPercentage: number;
  newPercentage: number;
  className?: string;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

function PureContextCompactionStatus({
  compactedCount,
  tokensSaved,
  oldPercentage,
  newPercentage,
  className,
}: ContextCompactionStatusProps) {
  const tokensSavedFormatted = formatTokens(tokensSaved);
  const percentageChange = ((oldPercentage - newPercentage) * 100).toFixed(1);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-muted/50 p-3 text-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-purple-500 animate-pulse" />
        <span className="font-semibold">Context Compressed</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="text-xs">
          {compactedCount} messages
        </Badge>
        <Badge variant="secondary" className="text-xs">
          -{tokensSavedFormatted} tokens
        </Badge>
        <Badge variant="secondary" className="text-xs">
          {oldPercentage.toFixed(1)}% → {newPercentage.toFixed(1)}%
        </Badge>
        {parseFloat(percentageChange) > 0 && (
          <Badge
            variant="outline"
            className="text-xs text-green-600 dark:text-green-400"
          >
            -{percentageChange}%
          </Badge>
        )}
      </div>
    </div>
  );
}

export const ContextCompactionStatus = memo(PureContextCompactionStatus);
