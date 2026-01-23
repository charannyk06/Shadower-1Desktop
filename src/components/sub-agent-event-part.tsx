"use client";

import { ToolUIPart } from "ai";
import { DefaultToolName } from "lib/ai/tools";
import {
  CheckIcon,
  Circle,
  XIcon,
} from "lucide-react";
import { lazy, memo, Suspense } from "react";
import { BrowserToolInvocation } from "./tool-invocation/browser-tool-invocation";
import { DesktopToolInvocation } from "./tool-invocation/desktop-tool-invocation";
import type { SubAgentEvent } from "./tool-invocation/sub-agent-view";
import { TextShimmer } from "ui/text-shimmer";
import type { ToolStatus } from "ui/tool-status-badge";

// Lazy load tool invocation components
const WebSearchToolInvocation = lazy(() =>
  import("./tool-invocation/web-search").then((mod) => ({
    default: mod.WebSearchToolInvocation,
  }))
);

const ToolCallCard = lazy(() =>
  import("./tool-invocation/tool-call-card").then((mod) => ({
    default: mod.ToolCallCard,
  }))
);

const WebSearchLoadingFallback = () => (
  <div className="h-20 w-full flex items-center justify-center rounded-md bg-muted/50">
    <span className="text-muted-foreground text-sm">
      Loading search results...
    </span>
  </div>
);

const ToolCallLoadingFallback = () => (
  <div className="h-16 w-full flex items-center justify-center rounded-md bg-muted/50">
    <span className="text-muted-foreground text-sm">Loading...</span>
  </div>
);

interface SubAgentEventPartProps {
  event: SubAgentEvent;
  isLast?: boolean;
  threadId?: string;
  isAgentRunning?: boolean;
}

/**
 * Renders a single sub-agent event inline in the message stream
 */
export const SubAgentEventPart = memo(function SubAgentEventPart({
  event,
  threadId,
  isAgentRunning = true,
}: SubAgentEventPartProps) {
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
      } catch (_err) {
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

      // Default tool call - use consistent ToolCallCard component (same as main agent)
      // Determine tool status based on whether we have a result
      const getToolStatus = (): ToolStatus => {
        if (actualResult?.error || parsedResult?.error) return "error";
        if (parsedResult !== null) return "success";
        return "running";
      };

      // Parse input if it's a string
      const getParsedInput = () => {
        if (!data.args) return undefined;
        if (typeof data.args === "string") {
          try {
            return JSON.parse(data.args);
          } catch {
            return data.args;
          }
        }
        return data.args;
      };

      return (
        <div className="w-full my-1">
          <Suspense fallback={<ToolCallLoadingFallback />}>
            <ToolCallCard
              toolName={originalToolName}
              input={getParsedInput()}
              output={actualResult ?? parsedResult ?? undefined}
              status={getToolStatus()}
            />
          </Suspense>
        </div>
      );

    case "data-sub-agent-complete":
      return (
        <div className="py-1 space-y-1">
          <div className="flex items-center gap-2">
            <CheckIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">
              {data.agentName || "Agent"} completed
            </span>
          </div>
          {data.result && (
            <div className="ml-5 text-xs text-foreground whitespace-pre-wrap">
              {data.result}
            </div>
          )}
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
