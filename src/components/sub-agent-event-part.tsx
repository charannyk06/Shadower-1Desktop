"use client";

import { appStore } from "@/app/store";
import { ToolUIPart } from "ai";
import { DefaultToolName } from "lib/ai/tools";
import { CheckIcon, Globe, Maximize2, Wrench, XIcon } from "lucide-react";
import { lazy, memo, Suspense } from "react";
import { Button } from "ui/button";
import { useShallow } from "zustand/shallow";
import { Markdown } from "./markdown";
import { BrowserToolInvocation } from "./tool-invocation/browser-tool-invocation";
import { DesktopToolInvocation } from "./tool-invocation/desktop-tool-invocation";
import type { SubAgentEvent } from "./tool-invocation/sub-agent-view";

// Lazy load tool invocation components
const WebSearchToolInvocation = lazy(() =>
  import("./tool-invocation/web-search").then((mod) => ({
    default: mod.WebSearchToolInvocation,
  })),
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
}

/**
 * Renders a single sub-agent event inline in the message stream
 * This component displays individual events as they stream in chronological order
 */
export const SubAgentEventPart = memo(function SubAgentEventPart({
  event,
  threadId,
}: SubAgentEventPartProps) {
  const { mutate } = appStore(
    useShallow((state) => ({
      mutate: state.mutate,
    })),
  );
  const { type, data } = event;

  // Render different event types
  switch (type) {
    case "data-sub-agent-start":
      // Start event is handled by SubAgentTile header, but render a subtle indicator if needed
      return null;

    case "data-sub-agent-text":
      if (!data.text) return null;
      return (
        <div className="w-full my-1 px-3 py-1">
          <div className="text-sm text-muted-foreground prose prose-sm max-w-none dark:prose-invert">
            <Markdown>{data.text}</Markdown>
          </div>
        </div>
      );

    case "data-sub-agent-tool-call":
      // Parse result - handle nested tool-result structure
      let parsedResult: any = null;
      let actualResult: any = null;
      try {
        if (data.result) {
          if (typeof data.result === "string") {
            // Try to parse as JSON
            try {
              parsedResult = JSON.parse(data.result);
            } catch {
              // If it's not JSON, try to extract JSON from the string
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

          // Extract actual result from tool-result wrapper if present
          if (parsedResult?.type === "tool-result") {
            // Tool result wrapper - extract the actual output
            actualResult =
              parsedResult.output || parsedResult.result || parsedResult;
          } else if (
            parsedResult?.result &&
            typeof parsedResult.result === "object"
          ) {
            // Nested result object
            actualResult = parsedResult.result;
          } else if (parsedResult?.output) {
            // Direct output property
            actualResult = parsedResult.output;
          } else if (
            parsedResult &&
            typeof parsedResult === "object" &&
            !parsedResult.raw
          ) {
            // Use parsed result directly if it's not a wrapper
            actualResult = parsedResult;
          } else {
            // Fallback to parsed result
            actualResult = parsedResult;
          }

          // If actualResult is still a string, try to parse it
          if (
            typeof actualResult === "string" &&
            actualResult.trim().startsWith("{")
          ) {
            try {
              const nested = JSON.parse(actualResult);
              if (nested.type === "tool-result" && nested.output) {
                actualResult = nested.output;
              } else if (nested.result) {
                actualResult = nested.result;
              } else {
                actualResult = nested;
              }
            } catch {
              // Keep as string if parsing fails
            }
          }
        }
      } catch (err) {
        console.error(
          "[SubAgentEventPart] Failed to parse result:",
          err,
          data.result,
        );
        parsedResult = { raw: data.result, error: "Failed to parse result" };
        actualResult = parsedResult;
      }

      const toolName = (data.toolName || "").toLowerCase();
      const originalToolName = data.toolName || "";

      // Check for web search tools
      const isWebSearchTool =
        toolName === "websearch" ||
        toolName === "web_search" ||
        toolName === DefaultToolName.WebSearch.toLowerCase() ||
        toolName === "webcontent" ||
        toolName === "web_content" ||
        toolName === DefaultToolName.WebContent.toLowerCase();

      // Check for browser tools
      const isBrowserTool =
        (toolName.startsWith("browser") && toolName !== "browser") ||
        toolName.includes("browser_navigate") ||
        toolName.includes("browsernavigate") ||
        toolName.includes("browser_act") ||
        toolName.includes("browseract") ||
        toolName.includes("browser_observe") ||
        toolName.includes("browserobserve") ||
        toolName.includes("browser_extract") ||
        toolName.includes("browserextract") ||
        toolName.includes("browser_screenshot") ||
        toolName.includes("browserscreenshot");

      // Check for desktop tools
      const isDesktopTool =
        (toolName.startsWith("desktop") && toolName !== "desktop") ||
        toolName.includes("desktop_") ||
        toolName.includes("desktopscreenshot") ||
        toolName.includes("desktop_click") ||
        toolName.includes("desktopclick");

      // Create mock ToolUIPart for rich UI components
      const createMockPart = (
        output: any,
        state: string = "output-available",
      ): ToolUIPart =>
        ({
          type: "tool-call",
          toolCallId: `sub-agent-${data.agentId}-${data.timestamp || Date.now()}`,
          toolName: originalToolName,
          state,
          input: data.args,
          output,
        }) as ToolUIPart;

      // Render web search tools with rich UI
      if (isWebSearchTool) {
        // Ensure we have the actual ExaSearchResponse structure
        let webSearchResult = actualResult || parsedResult;

        // Debug logging (disabled to reduce console noise)
        // console.log("[SubAgentEventPart] Web search tool:", {
        //   toolName: originalToolName,
        //   hasResult: !!webSearchResult,
        //   resultType: typeof webSearchResult,
        //   resultKeys: webSearchResult && typeof webSearchResult === "object" ? Object.keys(webSearchResult) : [],
        //   hasResults: webSearchResult?.results ? "yes" : "no",
        // });

        // If it's wrapped, extract it - handle multiple nested structures
        if (
          webSearchResult?.results &&
          Array.isArray(webSearchResult.results)
        ) {
          // Already in correct format - ExaSearchResponse
        } else if (webSearchResult?.data?.results) {
          webSearchResult = webSearchResult.data;
        } else if (webSearchResult?.value?.results) {
          webSearchResult = webSearchResult.value;
        } else if (typeof webSearchResult === "string") {
          try {
            const parsed = JSON.parse(webSearchResult);
            if (parsed.results && Array.isArray(parsed.results)) {
              webSearchResult = parsed;
            } else if (parsed.data?.results) {
              webSearchResult = parsed.data;
            } else if (parsed.value?.results) {
              webSearchResult = parsed.value;
            } else {
              webSearchResult = parsed;
            }
          } catch {
            // Keep as is if parsing fails
          }
        }

        // Ensure we have results array for WebSearchToolInvocation
        // Silently handle missing results - no warning to reduce console noise
        // The WebSearchToolInvocation component will handle empty results gracefully

        const mockPart = createMockPart(
          webSearchResult,
          webSearchResult?.isError ? "error" : "output-available",
        );

        return (
          <div className="w-full my-2">
            <Suspense fallback={<WebSearchLoadingFallback />}>
              <WebSearchToolInvocation part={mockPart} />
            </Suspense>
          </div>
        );
      }

      // Render browser/desktop tools with rich UI
      if ((isBrowserTool || isDesktopTool) && threadId) {
        const mockPart = createMockPart(
          actualResult ||
            parsedResult || { success: false, error: "No result available" },
          actualResult?.success !== false && actualResult
            ? "output-available"
            : actualResult?.error
              ? "error"
              : "input-available",
        );

        return (
          <div className="w-full my-2">
            {isBrowserTool ? (
              <BrowserToolInvocation part={mockPart} threadId={threadId} />
            ) : (
              <DesktopToolInvocation part={mockPart} threadId={threadId} />
            )}
          </div>
        );
      }

      // Default tool call display for other tools
      return (
        <div className="w-full my-1 px-3 py-2">
          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2 border">
            <Wrench className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{toolName}</span>
                <span className="text-xs text-muted-foreground">
                  #{data.timestamp || Date.now()}
                </span>
              </div>
              {data.args && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Arguments
                  </summary>
                  <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto max-h-32 overflow-y-auto">
                    {typeof data.args === "string"
                      ? data.args
                      : JSON.stringify(data.args, null, 2)}
                  </pre>
                </details>
              )}
              {parsedResult && (
                <details className="text-xs" open>
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium">
                    Result
                  </summary>
                  {parsedResult.sessionId && isBrowserTool && (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <Globe className="h-3 w-3 text-blue-500" />
                        <span className="text-muted-foreground">
                          Session: {parsedResult.sessionId}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            mutate((state) => ({
                              theaterMode: {
                                ...state.theaterMode,
                                isOpen: true,
                                type: "browser",
                                title: `Browser Session`,
                                browserSession: {
                                  sessionId: parsedResult.sessionId,
                                  provider: "chrome-devtools",
                                  currentUrl:
                                    parsedResult.currentUrl || parsedResult.url,
                                  replayUrl: parsedResult.replayUrl,
                                },
                              },
                            }));
                          }}
                          className="h-6 text-xs gap-1 ml-auto"
                        >
                          <Maximize2 className="size-3" />
                          View Live
                        </Button>
                      </div>
                      {parsedResult.screenshot && (
                        <img
                          src={parsedResult.screenshot}
                          alt="Browser screenshot"
                          className="w-full rounded-md border shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => {
                            mutate((state) => ({
                              theaterMode: {
                                ...state.theaterMode,
                                isOpen: true,
                                type: "browser",
                                title: `Browser Session`,
                                browserSession: {
                                  sessionId: parsedResult.sessionId,
                                  provider: "chrome-devtools",
                                  currentUrl:
                                    parsedResult.currentUrl || parsedResult.url,
                                  replayUrl: parsedResult.replayUrl,
                                },
                              },
                            }));
                          }}
                        />
                      )}
                    </div>
                  )}
                  {parsedResult.sessionId && isDesktopTool && (
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">
                          Session: {parsedResult.sessionId}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            mutate((state) => ({
                              theaterMode: {
                                ...state.theaterMode,
                                isOpen: true,
                                type: "desktop",
                                title: `Desktop Session`,
                                desktopSession: {
                                  sessionId: parsedResult.sessionId,
                                  streamUrl: parsedResult.streamUrl,
                                  authKey: parsedResult.authKey,
                                },
                              },
                            }));
                          }}
                          className="h-6 text-xs gap-1 ml-auto"
                        >
                          <Maximize2 className="size-3" />
                          View Live
                        </Button>
                      </div>
                      {parsedResult.screenshot && (
                        <img
                          src={parsedResult.screenshot}
                          alt="Desktop screenshot"
                          className="w-full rounded-md border shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                        />
                      )}
                    </div>
                  )}
                  {!parsedResult.sessionId && (
                    <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto max-h-32 overflow-y-auto">
                      {typeof parsedResult === "string"
                        ? parsedResult
                        : JSON.stringify(parsedResult, null, 2)}
                    </pre>
                  )}
                </details>
              )}
            </div>
          </div>
        </div>
      );

    case "data-sub-agent-complete":
      return (
        <div className="w-full my-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/20">
            <CheckIcon className="h-4 w-4 text-emerald-500" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-emerald-500">
                  {data.agentName || "Sub-Agent"}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-500">
                  completed
                </span>
              </div>
            </div>
          </div>
        </div>
      );

    case "data-sub-agent-error":
      return (
        <div className="w-full my-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20">
            <XIcon className="h-4 w-4 text-red-500" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-red-500">
                  {data.agentName || "Sub-Agent"}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-500">
                  error
                </span>
              </div>
              {data.error && (
                <p className="text-xs text-red-500 mt-1">{data.error}</p>
              )}
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
});
