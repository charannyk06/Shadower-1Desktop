"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { memo, useMemo } from "react";
import { ToolStatus } from "ui/tool-status-badge";
import { ToolCallRow, getToolIcon } from "./tool-call-row";

interface ToolCall {
  name: string;
  args?: unknown;
  result?: unknown;
  timestamp: number;
  status?: ToolStatus;
}

interface ToolCallTimelineProps {
  toolCalls: ToolCall[];
  className?: string;
}

export const ToolCallTimeline = memo(function ToolCallTimeline({
  toolCalls,
  className,
}: ToolCallTimelineProps) {
  if (toolCalls.length === 0) {
    return null;
  }

  // Collect unique tool icons for the header
  const toolIcons = useMemo(() => {
    const seen = new Set<string>();
    const icons: Array<{ icon: ReturnType<typeof getToolIcon>["icon"]; color: string; name: string }> = [];

    for (const tc of toolCalls) {
      if (!seen.has(tc.name)) {
        seen.add(tc.name);
        const { icon, color } = getToolIcon(tc.name);
        icons.push({ icon, color, name: tc.name });
      }
      if (icons.length >= 5) break; // Limit to 5 unique icons
    }

    return icons;
  }, [toolCalls]);

  return (
    <div className={cn("space-y-1", className)}>
      {/* Compact header with tool icons */}
      <div className="flex items-center gap-2 px-1 py-1">
        <div className="flex items-center gap-1">
          {toolIcons.map(({ icon: Icon, color, name }, idx) => (
            <Icon key={`${name}-${idx}`} className={cn("size-3", color)} />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {toolCalls.length} tool call{toolCalls.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Tool call rows */}
      <div className="space-y-0.5">
        {toolCalls.map((toolCall, index) => {
          const status: ToolStatus =
            toolCall.status ||
            (toolCall.result === undefined ? "pending" : "success");

          return (
            <motion.div
              key={`${toolCall.name}-${index}-${toolCall.timestamp}`}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.03 }}
            >
              <ToolCallRow
                toolName={toolCall.name}
                input={toolCall.args}
                output={toolCall.result}
                status={status}
              />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
});

ToolCallTimeline.displayName = "ToolCallTimeline";
