"use client";

import { ToolUIPart } from "ai";
import { DefaultToolName } from "lib/ai/tools";
import {
  ChevronRight,
  CheckIcon,
  Circle,
  FileCode,
  FileText,
  GitBranch,
  Globe,
  Terminal,
  Wrench,
  XIcon,
} from "lucide-react";
import { lazy, memo, Suspense, useState } from "react";
import { BrowserToolInvocation } from "./tool-invocation/browser-tool-invocation";
import { DesktopToolInvocation } from "./tool-invocation/desktop-tool-invocation";
import type { SubAgentEvent } from "./tool-invocation/sub-agent-view";
import { cn } from "lib/utils";
import { TextShimmer } from "ui/text-shimmer";
import { AnimatePresence, motion } from "framer-motion";

// Lazy load tool invocation components
const WebSearchToolInvocation = lazy(() =>
  import("./tool-invocation/web-search").then((mod) => ({
    default: mod.WebSearchToolInvocation,
  }))
);

const WebSearchLoadingFallback = () => (
  <div className="h-20 w-full flex items-center justify-center rounded-md bg-muted/50">
    <span className="text-muted-foreground text-sm">
      Loading search results...
    </span>
  </div>
);

interface SubAgentEventPartProps {
  event: SubAgentEvent;
  isLast?: boolean;
  threadId?: string;
  isAgentRunning?: boolean;
}

/**
 * Get an appropriate icon for a tool based on its name
 */
function getToolIcon(toolName: string) {
  const name = toolName.toLowerCase();

  if (name.includes("read") || name.includes("file") || name.includes("glob") || name.includes("grep")) {
    return FileText;
  }
  if (name.includes("write") || name.includes("edit")) {
    return FileCode;
  }
  if (name.includes("bash") || name.includes("terminal") || name.includes("exec")) {
    return Terminal;
  }
  if (name.includes("git") || name.includes("diff")) {
    return GitBranch;
  }
  if (name.includes("web") || name.includes("browser")) {
    return Globe;
  }

  return Wrench;
}

/**
 * Format a tool name for display
 */
function formatToolName(toolName: string): string {
  let name = toolName
    .replace(/^mcp__[^_]+__/, "")
    .replace(/^tool_/, "")
    .replace(/^sub_agent_/, "");

  name = name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return name;
}

/**
 * Renders a single sub-agent event inline in the message stream
 */
export const SubAgentEventPart = memo(function SubAgentEventPart({
  event,
  threadId,
  isAgentRunning = true,
}: SubAgentEventPartProps) {
  const [isToolExpanded, setIsToolExpanded] = useState(false);
  const { type, data } = event;

  switch (type) {
    case "data-sub-agent-start":
      return null;

    case "data-sub-agent-text":
      if (!data.text) return null;

      // Check if it's a "thinking" message
      const text = data.text.trim();
      const isThinking =
        text.toLowerCase().startsWith("thinking") ||
        text.toLowerCase().startsWith("let me") ||
        text.toLowerCase().startsWith("i'll") ||
        text.toLowerCase().startsWith("i will") ||
        text.toLowerCase().startsWith("i need to");

      if (isThinking) {
        return (
          <div className="flex items-start gap-2 py-1">
            <Circle className="h-2 w-2 text-muted-foreground mt-1.5 flex-shrink-0 fill-current" />
            <div className="flex-1 min-w-0 text-xs">
              {isAgentRunning ? (
                <TextShimmer className="font-medium" duration={1.5}>
                  Thinking
                </TextShimmer>
              ) : (
                <span className="font-medium text-muted-foreground">Thinking</span>
              )}
              <span className="text-muted-foreground ml-1 line-clamp-1">
                {text.replace(/^(thinking|let me|i'll|i will|i need to)\s*/i, "")}
              </span>
            </div>
          </div>
        );
      }

      return (
        <div className="flex items-start gap-2 py-1">
          <span className="w-3.5 flex-shrink-0" />
          <span className="text-xs text-muted-foreground line-clamp-2">
            {text}
          </span>
        </div>
      );

    case "data-sub-agent-tool-call":
      // Parse result
      let parsedResult: any = null;
      let actualResult: any = null;
      try {
        if (data.result) {
          if (typeof data.result === "string") {
            try {
              parsedResult = JSON.parse(data.result);
            } catch {
              const jsonMatch = data.result.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  parsedResult = JSON.parse(jsonMatch[0]);
                } catch {
                  parsedResult = { raw: data.result };
                }
              } else {
                parsedResult = { raw: data.result };
              }
            }
          } else {
            parsedResult = data.result;
          }

          if (parsedResult?.type === "tool-result") {
            actualResult = parsedResult.output || parsedResult.result || parsedResult;
          } else if (parsedResult?.result && typeof parsedResult.result === "object") {
            actualResult = parsedResult.result;
          } else if (parsedResult?.output) {
            actualResult = parsedResult.output;
          } else if (parsedResult && typeof parsedResult === "object" && !parsedResult.raw) {
            actualResult = parsedResult;
          } else {
            actualResult = parsedResult;
          }

          if (typeof actualResult === "string" && actualResult.trim().startsWith("{")) {
            try {
              const nested = JSON.parse(actualResult);
              if (nested.type === "tool-result" && nested.output) {
                actualResult = nested.output;
              } else if (nested.result) {
                actualResult = nested.result;
              } else {
                actualResult = nested;
              }
            } catch {}
          }
        }
      } catch (err) {
        parsedResult = { raw: data.result, error: "Failed to parse" };
        actualResult = parsedResult;
      }

      const toolName = (data.toolName || "").toLowerCase();
      const originalToolName = data.toolName || "";

      // Check for special tools
      const isWebSearchTool =
        toolName === "websearch" ||
        toolName === "web_search" ||
        toolName === DefaultToolName.WebSearch.toLowerCase() ||
        toolName === "webcontent" ||
        toolName === "web_content" ||
        toolName === DefaultToolName.WebContent.toLowerCase();

      const isBrowserTool =
        (toolName.startsWith("browser") && toolName !== "browser") ||
        toolName.includes("browser_");

      const isDesktopTool =
        (toolName.startsWith("desktop") && toolName !== "desktop") ||
        toolName.includes("desktop_");

      const createMockPart = (output: any, state: string = "output-available"): ToolUIPart =>
        ({
          type: "tool-call",
          toolCallId: `sub-agent-${data.agentId}-${data.timestamp || Date.now()}`,
          toolName: originalToolName,
          state,
          input: data.args,
          output,
        }) as ToolUIPart;

      // Web search with rich UI
      if (isWebSearchTool) {
        let webSearchResult = actualResult || parsedResult;
        if (webSearchResult?.data?.results) {
          webSearchResult = webSearchResult.data;
        } else if (webSearchResult?.value?.results) {
          webSearchResult = webSearchResult.value;
        }

        const mockPart = createMockPart(
          webSearchResult,
          webSearchResult?.isError ? "error" : "output-available"
        );

        return (
          <div className="w-full my-1">
            <Suspense fallback={<WebSearchLoadingFallback />}>
              <WebSearchToolInvocation part={mockPart} />
            </Suspense>
          </div>
        );
      }

      // Browser/Desktop with rich UI
      if ((isBrowserTool || isDesktopTool) && threadId) {
        const mockPart = createMockPart(
          actualResult || parsedResult || { success: false, error: "No result" },
          actualResult?.success !== false && actualResult ? "output-available" : "error"
        );

        return (
          <div className="w-full my-1">
            {isBrowserTool ? (
              <BrowserToolInvocation part={mockPart} threadId={threadId} />
            ) : (
              <DesktopToolInvocation part={mockPart} threadId={threadId} />
            )}
          </div>
        );
      }

      // Default tool call - collapsible
      const ToolIcon = getToolIcon(originalToolName);
      const displayName = formatToolName(originalToolName);

      // Extract relevant info from args
      let argsSummary: string | null = null;
      if (data.args) {
        try {
          const args = typeof data.args === "string" ? JSON.parse(data.args) : data.args;
          argsSummary = args.file_path || args.filePath || args.path || args.pattern || args.command || null;
          if (argsSummary && argsSummary.length > 40) {
            argsSummary = "..." + argsSummary.slice(-37);
          }
        } catch {}
      }

      return (
        <div className="py-0.5">
          <button
            type="button"
            onClick={() => setIsToolExpanded(!isToolExpanded)}
            className="w-full flex items-center gap-2 py-1 hover:bg-muted/30 rounded transition-colors text-left"
          >
            <ToolIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs font-medium text-foreground">
              {displayName}
            </span>
            {argsSummary && (
              <span className="text-xs text-muted-foreground font-mono truncate flex-1 min-w-0">
                {argsSummary}
              </span>
            )}
            {(data.args || parsedResult) && (
              <ChevronRight
                className={cn(
                  "h-3 w-3 text-muted-foreground transition-transform flex-shrink-0",
                  isToolExpanded && "rotate-90"
                )}
              />
            )}
          </button>

          <AnimatePresence initial={false}>
            {isToolExpanded && (data.args || parsedResult) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="overflow-hidden"
              >
                <div className="ml-5 mt-1 space-y-2 text-xs">
                  {data.args && (
                    <div>
                      <span className="text-muted-foreground font-medium">Input:</span>
                      <pre className="mt-0.5 p-2 bg-muted/50 rounded text-xs overflow-x-auto max-h-24 overflow-y-auto">
                        {typeof data.args === "string"
                          ? data.args
                          : JSON.stringify(data.args, null, 2)}
                      </pre>
                    </div>
                  )}
                  {parsedResult && (
                    <div>
                      <span className="text-muted-foreground font-medium">Output:</span>
                      <pre className="mt-0.5 p-2 bg-muted/50 rounded text-xs overflow-x-auto max-h-24 overflow-y-auto">
                        {typeof parsedResult === "string"
                          ? parsedResult
                          : JSON.stringify(parsedResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      );

    case "data-sub-agent-complete":
      return (
        <div className="flex items-center gap-2 py-1">
          <CheckIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs text-muted-foreground">
            {data.agentName || "Agent"} completed
          </span>
        </div>
      );

    case "data-sub-agent-error":
      return (
        <div className="flex items-start gap-2 py-1">
          <XIcon className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="text-xs text-red-500">
              {data.agentName || "Agent"} failed
            </span>
            {data.error && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {data.error}
              </p>
            )}
          </div>
        </div>
      );

    default:
      return null;
  }
});
