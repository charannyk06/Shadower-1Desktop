"use client";

import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";
import { getFriendlyToolName } from "@/lib/utils/tool-name-formatter";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { Button } from "ui/button";
import { Separator } from "ui/separator";
import { TextShimmer } from "ui/text-shimmer";
import { ToolStatus, ToolStatusBadge } from "ui/tool-status-badge";
import { FormattedToolData } from "./formatted-tool-data";

interface ToolCallCardProps {
  toolName: string;
  input: unknown;
  output?: unknown;
  status: ToolStatus;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
}

export const ToolCallCard = memo(function ToolCallCard({
  toolName,
  input,
  output,
  status,
  isExpanded: controlledExpanded,
  onToggleExpand,
  className,
}: ToolCallCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const { copied: copiedInput, copy: copyInput } = useCopy();
  const { copied: copiedOutput, copy: copyOutput } = useCopy();

  const isExpanded = controlledExpanded ?? internalExpanded;
  const toggleExpand =
    onToggleExpand ?? (() => setInternalExpanded((prev) => !prev));

  const friendlyName = useMemo(() => {
    try {
      return getFriendlyToolName(toolName || "");
    } catch (error) {
      console.error("Error getting friendly tool name:", error);
      return {
        displayName: toolName || "Unknown Tool",
      };
    }
  }, [toolName]);

  const hasOutput = output !== null && output !== undefined;

  const borderColor = useMemo(() => {
    switch (status) {
      case "running":
        return "border-blue-500/30";
      case "success":
        return "border-emerald-500/30";
      case "error":
        return "border-red-500/30";
      default:
        return "border-border";
    }
  }, [status]);

  const bgGradient = useMemo(() => {
    switch (status) {
      case "running":
        return "bg-gradient-to-br from-blue-500/5 to-transparent";
      case "success":
        return "bg-gradient-to-br from-emerald-500/5 to-transparent";
      case "error":
        return "bg-gradient-to-br from-red-500/5 to-transparent";
      default:
        return "bg-card";
    }
  }, [status]);

  const handleCopyInput = () => {
    copyInput(JSON.stringify(input, null, 2));
  };

  const handleCopyOutput = () => {
    if (output !== null && output !== undefined) {
      copyOutput(JSON.stringify(output, null, 2));
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn("w-full", className)}
    >
      <div
        className={cn(
          "rounded-lg border transition-all duration-300",
          borderColor,
          bgGradient,
          "hover:shadow-md",
        )}
      >
        {/* Header */}
        <button
          onClick={toggleExpand}
          className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
        >
          <ToolStatusBadge status={status} size="md" />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {status === "running" ? (
                <TextShimmer className="font-semibold text-sm">
                  {friendlyName.serverName || friendlyName.displayName}
                </TextShimmer>
              ) : (
                <span className="font-semibold text-sm">
                  {friendlyName.serverName || friendlyName.displayName}
                </span>
              )}
              {friendlyName.serverName && friendlyName.toolName && (
                <>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {friendlyName.toolName}
                  </span>
                </>
              )}
            </div>
          </div>

          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
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
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3">
                {/* Request Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h6 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Request
                    </h6>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyInput();
                      }}
                    >
                      {copiedInput ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <FormattedToolData
                      data={input}
                      toolName={toolName}
                      isInput={true}
                      defaultExpanded={false}
                    />
                  </div>
                </div>

                {/* Response Section */}
                {hasOutput && (
                  <div className="space-y-2">
                    <Separator />
                    <div className="flex items-center justify-between">
                      <h6 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Response
                      </h6>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyOutput();
                        }}
                      >
                        {copiedOutput ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                    <div className="rounded-md border bg-muted/30 p-3">
                      <FormattedToolData
                        data={output}
                        toolName={toolName}
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
    </motion.div>
  );
});

ToolCallCard.displayName = "ToolCallCard";
