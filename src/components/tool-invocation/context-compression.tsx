"use client";

import { Loader2, Sparkles, CheckCircle2 } from "lucide-react";

interface ContextCompressionProps {
  state: "loading" | "complete";
  compactedCount?: number;
  tokensSaved?: number;
  oldPercentage?: number;
  newPercentage?: number;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}

export function ContextCompressionToolBlock({
  state,
  compactedCount,
  tokensSaved,
  oldPercentage,
  newPercentage,
}: ContextCompressionProps) {
  if (state === "loading") {
    return (
      <div className="flex items-center gap-3 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
        <Loader2 className="size-5 text-purple-500 animate-spin" />
        <div>
          <p className="text-sm font-medium">Compressing Context</p>
          <p className="text-xs text-muted-foreground">
            Summarizing older messages to free up space...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
      <div className="flex items-center justify-center size-10 rounded-full bg-purple-500/20">
        <Sparkles className="size-5 text-purple-500" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Context Compressed</p>
          <CheckCircle2 className="size-4 text-green-500" />
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span>{compactedCount} messages summarized</span>
          <span>-</span>
          <span>{formatTokens(tokensSaved || 0)} tokens saved</span>
          <span>-</span>
          <span className="text-green-500">
            {((oldPercentage || 0) * 100).toFixed(0)}% &rarr; {((newPercentage || 0) * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}
