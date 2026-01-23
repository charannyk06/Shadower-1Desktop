"use client";

import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";
import {
  getToolCallSummary,
  getToolResultSummary,
} from "@/lib/utils/tool-call-summary";
import { AnimatePresence, motion } from "framer-motion";
import { DefaultToolName } from "lib/ai/tools";
import {
  BookOpenIcon,
  ChartColumnIcon,
  ChartPieIcon,
  Check,
  ChevronDown,
  CodeIcon,
  ComputerIcon,
  Copy,
  FileSpreadsheetIcon,
  FileTextIcon,
  GlobeIcon,
  GripIcon,
  HammerIcon,
  HardDriveUploadIcon,
  ImageIcon,
  KeyboardIcon,
  MousePointerClickIcon,
  NavigationIcon,
  PlayIcon,
  PresentationIcon,
  ScrollIcon,
  SearchIcon,
  TableOfContents,
  TimerIcon,
  TrendingUpIcon,
  UploadIcon,
  XIcon,
  FolderSearchIcon,
  TerminalIcon,
  FileEditIcon,
  FilePlusIcon,
  FolderIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import { Button } from "ui/button";
import { TextShimmer } from "ui/text-shimmer";
import type { ToolStatus } from "ui/tool-status-badge";
import { FormattedToolData } from "./formatted-tool-data";

interface ToolCallRowProps {
  toolName: string;
  input: unknown;
  output?: unknown;
  status: ToolStatus;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
}

/**
 * Get the appropriate icon for a tool based on its name
 */
function getToolIcon(toolName: string): {
  icon: LucideIcon;
  color: string;
} {
  const name = toolName.toLowerCase();

  // Visualization tools
  if (name === DefaultToolName.CreatePieChart.toLowerCase()) {
    return { icon: ChartPieIcon, color: "text-blue-500" };
  }
  if (name === DefaultToolName.CreateBarChart.toLowerCase()) {
    return { icon: ChartColumnIcon, color: "text-blue-500" };
  }
  if (name === DefaultToolName.CreateLineChart.toLowerCase()) {
    return { icon: TrendingUpIcon, color: "text-blue-500" };
  }
  if (name === DefaultToolName.CreateTable.toLowerCase()) {
    return { icon: TableOfContents, color: "text-blue-500" };
  }

  // Web tools
  if (
    name === DefaultToolName.WebSearch.toLowerCase() ||
    name.includes("websearch") ||
    name === "web_search"
  ) {
    return { icon: GlobeIcon, color: "text-blue-400" };
  }
  if (
    name === DefaultToolName.WebContent.toLowerCase() ||
    name.includes("webcontent") ||
    name === "web_content" ||
    name.includes("fetch")
  ) {
    return { icon: GlobeIcon, color: "text-blue-400" };
  }
  if (name === DefaultToolName.Http.toLowerCase() || name.includes("http")) {
    return { icon: HardDriveUploadIcon, color: "text-blue-300" };
  }

  // File operations
  if (
    name.includes("read") ||
    name === "read_file" ||
    name.includes("readfile")
  ) {
    return { icon: FileTextIcon, color: "text-emerald-500" };
  }
  if (
    name.includes("write") ||
    name === "write_file" ||
    name.includes("writefile")
  ) {
    return { icon: FilePlusIcon, color: "text-amber-500" };
  }
  if (name.includes("edit") || name === "edit_file") {
    return { icon: FileEditIcon, color: "text-amber-500" };
  }
  if (
    name.includes("glob") ||
    name.includes("find") ||
    name === "search_files"
  ) {
    return { icon: FolderSearchIcon, color: "text-purple-500" };
  }
  if (
    name.includes("grep") ||
    name.includes("search") ||
    name === "ripgrep" ||
    name.includes("rg")
  ) {
    return { icon: SearchIcon, color: "text-purple-500" };
  }
  if (name.includes("list") || name.includes("directory") || name.includes("ls")) {
    return { icon: FolderIcon, color: "text-purple-400" };
  }

  // Shell/Bash operations
  if (
    name.includes("bash") ||
    name.includes("shell") ||
    name.includes("exec") ||
    name.includes("terminal") ||
    name === "execute_command"
  ) {
    return { icon: TerminalIcon, color: "text-green-500" };
  }

  // Browser automation tools
  if (name.startsWith("browser")) {
    if (name.includes("create") || name.includes("session")) {
      return { icon: PlayIcon, color: "text-orange-500" };
    }
    if (name.includes("close")) {
      return { icon: XIcon, color: "text-orange-500" };
    }
    if (name.includes("navigate")) {
      return { icon: NavigationIcon, color: "text-orange-500" };
    }
    if (name.includes("click")) {
      return { icon: MousePointerClickIcon, color: "text-orange-500" };
    }
    if (name.includes("fill") || name.includes("type")) {
      return { icon: FileTextIcon, color: "text-orange-400" };
    }
    if (name.includes("snapshot") || name.includes("content")) {
      return { icon: SearchIcon, color: "text-orange-400" };
    }
    if (name.includes("screenshot")) {
      return { icon: ImageIcon, color: "text-orange-500" };
    }
    if (name.includes("wait")) {
      return { icon: TimerIcon, color: "text-orange-400" };
    }
    if (name.includes("evaluate")) {
      return { icon: CodeIcon, color: "text-orange-500" };
    }
    return { icon: GlobeIcon, color: "text-orange-500" };
  }

  // Desktop/Computer Use tools
  if (name.startsWith("desktop")) {
    if (name.includes("screenshot")) {
      return { icon: ComputerIcon, color: "text-purple-500" };
    }
    if (name.includes("click")) {
      return { icon: MousePointerClickIcon, color: "text-purple-500" };
    }
    if (name.includes("type")) {
      return { icon: KeyboardIcon, color: "text-purple-400" };
    }
    if (name.includes("press")) {
      return { icon: KeyboardIcon, color: "text-purple-500" };
    }
    if (name.includes("scroll")) {
      return { icon: ScrollIcon, color: "text-purple-400" };
    }
    if (name.includes("drag")) {
      return { icon: GripIcon, color: "text-purple-500" };
    }
    if (name.includes("launch")) {
      return { icon: PlayIcon, color: "text-purple-600" };
    }
    return { icon: ComputerIcon, color: "text-purple-500" };
  }

  // Data analysis tools
  if (name.includes("upload") || name.includes("dataset")) {
    return { icon: UploadIcon, color: "text-cyan-500" };
  }
  if (name.includes("profile") || name.includes("analyze")) {
    return { icon: ChartColumnIcon, color: "text-cyan-500" };
  }

  // Document generation tools
  if (name.includes("presentation")) {
    return { icon: PresentationIcon, color: "text-amber-500" };
  }
  if (name.includes("document")) {
    return { icon: FileTextIcon, color: "text-amber-500" };
  }
  if (name.includes("spreadsheet")) {
    return { icon: FileSpreadsheetIcon, color: "text-amber-500" };
  }

  // Research tools
  if (name.includes("research")) {
    return { icon: BookOpenIcon, color: "text-indigo-500" };
  }

  // Default
  return { icon: HammerIcon, color: "text-muted-foreground" };
}

/**
 * Get status indicator color
 */
function getStatusColor(status: ToolStatus): string {
  switch (status) {
    case "running":
      return "bg-blue-500";
    case "success":
      return "bg-emerald-500";
    case "error":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/50";
  }
}

export const ToolCallRow = memo(function ToolCallRow({
  toolName,
  input,
  output,
  status,
  isExpanded: controlledExpanded,
  onToggleExpand,
  className,
}: ToolCallRowProps) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const { copied: copiedInput, copy: copyInput } = useCopy();
  const { copied: copiedOutput, copy: copyOutput } = useCopy();

  const isExpanded = controlledExpanded ?? internalExpanded;
  const toggleExpand =
    onToggleExpand ?? (() => setInternalExpanded((prev) => !prev));

  const { icon: ToolIcon, color: iconColor } = useMemo(
    () => getToolIcon(toolName),
    [toolName]
  );

  const summary = useMemo(
    () => getToolCallSummary(toolName, input),
    [toolName, input]
  );

  const resultSummary = useMemo(
    () => getToolResultSummary(toolName, output),
    [toolName, output]
  );

  const hasOutput = output !== null && output !== undefined;
  const isRunning = status === "running";

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
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn("w-full", className)}
    >
      <div
        className={cn(
          "rounded-md transition-all duration-200",
          isExpanded && "bg-muted/30 border border-border/50"
        )}
      >
        {/* Compact Row Header */}
        <button
          onClick={toggleExpand}
          className={cn(
            "w-full flex items-center gap-2 py-1.5 px-2 text-left transition-colors rounded-md",
            "hover:bg-muted/50",
            isExpanded && "border-b border-border/30"
          )}
        >
          {/* Status indicator dot */}
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full flex-shrink-0",
              getStatusColor(status),
              isRunning && "animate-pulse"
            )}
          />

          {/* Tool icon */}
          <ToolIcon className={cn("size-3.5 flex-shrink-0", iconColor)} />

          {/* Action text */}
          <div className="flex-1 min-w-0 flex items-center gap-2">
            {isRunning ? (
              <TextShimmer className="text-xs font-medium" duration={1.5}>
                {summary.action}
              </TextShimmer>
            ) : (
              <span className="text-xs font-medium truncate">
                {summary.action}
              </span>
            )}

            {/* Result summary (e.g., "11 matches") */}
            {resultSummary && !isRunning && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                {resultSummary}
              </span>
            )}
          </div>

          {/* Detail/path on the right */}
          {summary.detail && (
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {summary.detail}
            </span>
          )}

          {/* Expand chevron */}
          <ChevronDown
            className={cn(
              "h-3 w-3 text-muted-foreground transition-transform flex-shrink-0",
              isExpanded && "rotate-180"
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
              <div className="px-3 py-2 space-y-2">
                {/* Request Section */}
                {input !== null && input !== undefined && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <h6 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
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
                    <div className="rounded border bg-background/50 p-2 max-h-[200px] overflow-auto">
                      <FormattedToolData
                        data={input}
                        toolName={toolName}
                        isInput={true}
                        defaultExpanded={false}
                      />
                    </div>
                  </div>
                )}

                {/* Response Section */}
                {hasOutput && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <h6 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
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
                    <div className="rounded border bg-background/50 p-2 max-h-[200px] overflow-auto">
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

ToolCallRow.displayName = "ToolCallRow";

// Export the getToolIcon function for use in other components
export { getToolIcon };
