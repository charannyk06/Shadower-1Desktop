"use client";

import { memo } from "react";
import type { ToolStatus } from "ui/tool-status-badge";
import { ToolCallRow } from "./tool-call-row";

interface ToolCallCardProps {
  toolName: string;
  input: unknown;
  output?: unknown;
  status: ToolStatus;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
}

/**
 * ToolCallCard - Now uses the compact ToolCallRow format
 * This component is kept for backwards compatibility
 */
export const ToolCallCard = memo(function ToolCallCard({
  toolName,
  input,
  output,
  status,
  isExpanded,
  onToggleExpand,
  className,
}: ToolCallCardProps) {
  return (
    <ToolCallRow
      toolName={toolName}
      input={input}
      output={output}
      status={status}
      isExpanded={isExpanded}
      onToggleExpand={onToggleExpand}
      className={className}
    />
  );
});

ToolCallCard.displayName = "ToolCallCard";
