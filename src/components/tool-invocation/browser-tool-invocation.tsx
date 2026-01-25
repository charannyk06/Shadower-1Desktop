"use client";

import { ToolUIPart } from "ai";
import {
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  XCircle,
} from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import { Button } from "ui/button";

interface BrowserToolResult {
  success: boolean;
  sessionId?: string;
  screenshot?: string;
  message?: string;
  error?: string;
  url?: string;
  currentUrl?: string;
  replayUrl?: string;
  elements?: Array<{
    selector: string;
    description: string;
    tagName?: string;
  }>;
  elementCount?: number;
  data?: any;
  content?: string;
  truncated?: boolean;
  format?: string;
  guide?: string;
}

interface BrowserToolInvocationProps {
  part: ToolUIPart;
  threadId?: string;
}

/**
 * Component to display browser tool invocation results (browser_navigate, browser_act, etc.)
 * Shows screenshots inline in chat - no theater mode integration
 */
export const BrowserToolInvocation = memo(function BrowserToolInvocation({
  part,
}: BrowserToolInvocationProps) {
  const result = useMemo(() => {
    if (part.state?.startsWith("input")) return null;
    return part.output as BrowserToolResult;
  }, [part.state, part.output]);

  const toolName = useMemo(() => {
    if ("toolName" in part) return part.toolName as string;
    return "browser_action";
  }, [part]);

  const isLoading =
    part.state === "input-streaming" || part.state === "input-available";
  const hasError = !result?.success && result?.error;
  const hasScreenshot = !!result?.screenshot;

  const openReplay = useCallback(() => {
    if (result?.replayUrl) {
      window.open(result.replayUrl, "_blank");
    }
  }, [result?.replayUrl]);

  // Get friendly tool name
  const friendlyToolName = useMemo(() => {
    switch (toolName) {
      case "browser_navigate":
        return "Navigate";
      case "browser_act":
        return "Action";
      case "browser_observe":
        return "Observe";
      case "browser_extract":
        return "Extract";
      case "browser_screenshot":
        return "Screenshot";
      case "browser_wait":
        return "Wait";
      case "browser_close":
        return "Close";
      case "browser_stealth":
        return "Stealth Mode";
      case "browser_get_content":
        return "Get Content";
      case "browser_replay":
        return "Replay";
      default:
        return toolName.replace("browser_", "").replace(/_/g, " ");
    }
  }, [toolName]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-3 bg-muted/30 rounded-lg">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Executing {friendlyToolName}...</span>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="flex flex-col gap-3 p-3 bg-muted/30 rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-blue-500" />
          <span className="text-sm font-medium">{friendlyToolName}</span>
          {result.success ? (
            <CheckCircle2 className="size-4 text-green-500" />
          ) : (
            <XCircle className="size-4 text-red-500" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {result.replayUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={openReplay}
              className="h-7 text-xs gap-1"
            >
              <ExternalLink className="size-3" />
              Replay
            </Button>
          )}
        </div>
      </div>

      {/* URL display */}
      {(result.currentUrl || result.url) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background/50 px-2 py-1 rounded">
          <Globe className="size-3" />
          <span className="truncate">{result.currentUrl || result.url}</span>
        </div>
      )}

      {/* Error message */}
      {hasError && (
        <div className="text-sm text-red-500 bg-red-500/10 px-3 py-2 rounded">
          {result.error}
        </div>
      )}

      {/* Success message */}
      {result.message && !hasError && (
        <div className="text-sm text-muted-foreground">{result.message}</div>
      )}

      {/* Screenshot - inline display only */}
      {hasScreenshot && (
        <img
          src={result.screenshot}
          alt="Browser screenshot"
          className="w-full rounded-md border shadow-sm"
        />
      )}

      {/* Elements found (for observe) */}
      {result.elements && result.elements.length > 0 && (
        <div className="text-sm">
          <div className="font-medium mb-1">
            Found {result.elementCount || result.elements.length} elements:
          </div>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground">
            {result.elements.slice(0, 5).map((el, idx) => (
              <li key={idx} className="truncate">
                {el.description || el.selector}
              </li>
            ))}
            {result.elements.length > 5 && (
              <li className="text-xs">
                ...and {result.elements.length - 5} more
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Extracted data */}
      {result.data && (
        <div className="text-sm">
          <div className="font-medium mb-1">Extracted data:</div>
          <pre className="bg-background/50 p-2 rounded text-xs overflow-x-auto max-h-48">
            {typeof result.data === "string"
              ? result.data
              : JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}

      {/* Page content */}
      {result.content && (
        <div className="text-sm">
          <div className="font-medium mb-1">
            Page content ({result.format || "text"}):
            {result.truncated && (
              <span className="text-xs text-muted-foreground ml-1">
                (truncated)
              </span>
            )}
          </div>
          <pre className="bg-background/50 p-2 rounded text-xs overflow-x-auto max-h-48 whitespace-pre-wrap">
            {result.content.slice(0, 2000)}
            {result.content.length > 2000 && "..."}
          </pre>
        </div>
      )}

      {/* Guide message */}
      {result.guide && (
        <div className="text-xs text-muted-foreground italic border-t pt-2">
          {result.guide}
        </div>
      )}
    </div>
  );
});

BrowserToolInvocation.displayName = "BrowserToolInvocation";
