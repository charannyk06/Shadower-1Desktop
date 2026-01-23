"use client";

import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";
import { getFriendlyToolName } from "@/lib/utils/tool-name-formatter";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Copy } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { Button } from "ui/button";
import { ToolStatus, ToolStatusBadge } from "ui/tool-status-badge";
import { FormattedToolData } from "./formatted-tool-data";

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

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Tools Used ({toolCalls.length})
        </span>
      </div>
      <div className="space-y-2">
        {toolCalls.map((toolCall, index) => {
          const status: ToolStatus =
            toolCall.status ||
            (toolCall.result === undefined ? "pending" : "success");
          const isLast = index === toolCalls.length - 1;

          return (
            <motion.div
              key={`${toolCall.name}-${index}-${toolCall.timestamp}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="flex gap-3"
            >
              {/* Timeline Line */}
              <div className="flex flex-col items-center">
                <ToolStatusBadge status={status} size="sm" />
                {!isLast && (
                  <div
                    className={cn(
                      "w-0.5 flex-1 mt-2",
                      (() => {
                        if (status === "success") return "bg-emerald-500/30";
                        if (status === "error") return "bg-red-500/30";
                        if (status === "running") return "bg-blue-500/30";
                        return "bg-muted";
                      })(),
                    )}
                  />
                )}
              </div>

              {/* Tool Call Card */}
              <div className="flex-1 min-w-0">
                <ToolCallTimelineItem toolCall={toolCall} status={status} />
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
});

interface ToolCallTimelineItemProps {
  toolCall: ToolCall;
  status: ToolStatus;
}

const ToolCallTimelineItem = memo(function ToolCallTimelineItem({
  toolCall,
  status,
}: ToolCallTimelineItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { copied: copiedInput, copy: copyInput } = useCopy();
  const { copied: copiedOutput, copy: copyOutput } = useCopy();

  const friendlyName = useMemo(() => {
    try {
      return getFriendlyToolName(toolCall.name || "");
    } catch (error) {
      console.error("Error getting friendly tool name:", error);
      return {
        displayName: toolCall.name || "Unknown Tool",
      };
    }
  }, [toolCall.name]);

  const borderColor = useMemo(() => {
    switch (status) {
      case "success":
        return "border-emerald-500/20";
      case "error":
        return "border-red-500/20";
      case "running":
        return "border-blue-500/20";
      default:
        return "border-border";
    }
  }, [status]);

  const handleCopyInput = () => {
    copyInput(JSON.stringify(toolCall.args, null, 2));
  };

  const handleCopyOutput = () => {
    if (toolCall.result !== null && toolCall.result !== undefined) {
      copyOutput(JSON.stringify(toolCall.result, null, 2));
    }
  };

  return (
    <div
      className={cn(
        "rounded-md border bg-card/50 transition-all duration-200",
        borderColor,
        "hover:bg-card hover:shadow-sm",
      )}
    >
      {/* Compact Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/50 transition-colors rounded-md"
      >
        <span className="text-xs font-medium flex-1 truncate">
          {friendlyName.displayName}
        </span>
        {friendlyName.serverName && (
          <span className="text-xs text-muted-foreground">
            {friendlyName.serverName}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          #{toolCall.timestamp}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform",
            isExpanded && "rotate-180",
          )}
        />
      </button>

      {/* Expandable Content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-2 pb-2 space-y-2 border-t">
              {toolCall.args !== null && toolCall.args !== undefined && (
                <div className="pt-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <h6 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Request
                    </h6>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyInput();
                      }}
                    >
                      {copiedInput ? (
                        <Check className="h-2.5 w-2.5" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                    </Button>
                  </div>
                  <div className="rounded border bg-muted/30 p-2">
                    <FormattedToolData
                      data={toolCall.args}
                      toolName={toolCall.name}
                      isInput={true}
                      defaultExpanded={false}
                    />
                  </div>
                </div>
              )}
              {toolCall.result !== null && toolCall.result !== undefined && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <h6 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Response
                    </h6>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyOutput();
                      }}
                    >
                      {copiedOutput ? (
                        <Check className="h-2.5 w-2.5" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                    </Button>
                  </div>
                  <div className="rounded border bg-muted/30 p-2">
                    <FormattedToolData
                      data={toolCall.result}
                      toolName={toolCall.name}
                      isInput={false}
                      defaultExpanded={false}
                    />
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

ToolCallTimeline.displayName = "ToolCallTimeline";
