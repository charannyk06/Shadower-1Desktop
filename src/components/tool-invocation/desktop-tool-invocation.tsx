"use client";

import { appStore } from "@/app/store";
import { ToolUIPart } from "ai";
import { cn } from "lib/utils";
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  Loader2,
  Maximize2,
  Monitor,
  MousePointer,
  Terminal,
  XCircle,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo } from "react";
import { Button } from "ui/button";
import { useShallow } from "zustand/shallow";

interface DesktopToolResult {
  success: boolean;
  sandboxId?: string;
  screenshot?: string;
  message?: string;
  error?: string;
  width?: number;
  height?: number;
  guide?: string;
  // For stream tool
  streamUrl?: string;
  authKey?: string;
  // For command tool
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

interface DesktopToolInvocationProps {
  part: ToolUIPart;
  threadId?: string;
}

/**
 * Component to display desktop tool invocation results (desktop_screenshot, desktop_click, etc.)
 * Shows screenshots inline and provides "View Live" button to open Theater Mode
 */
export const DesktopToolInvocation = memo(function DesktopToolInvocation({
  part,
  threadId,
}: DesktopToolInvocationProps) {
  const { mutate } = appStore(
    useShallow((state) => ({
      mutate: state.mutate,
    })),
  );

  const result = useMemo(() => {
    if (part.state.startsWith("input")) return null;
    return part.output as DesktopToolResult;
  }, [part.state, part.output]);

  const toolName = useMemo(() => {
    if ("toolName" in part) return part.toolName as string;
    return "desktop_action";
  }, [part]);

  const isLoading =
    part.state === "input-streaming" || part.state === "input-available";
  const hasError = !result?.success && result?.error;
  const hasScreenshot = !!result?.screenshot;

  // Auto-populate theater mode state when sandbox is created or stream started
  useEffect(() => {
    if (result?.sandboxId && threadId) {
      console.log("[DesktopToolInvocation] Setting desktop session in store:", {
        sandboxId: result.sandboxId,
        streamUrl: result.streamUrl,
      });

      mutate((state) => ({
        theaterMode: {
          ...state.theaterMode,
          desktopSession: {
            sandboxId: result.sandboxId!,
            streamUrl: result.streamUrl,
            authKey: result.authKey,
          },
        },
      }));
    }
  }, [result?.sandboxId, result?.streamUrl, result?.authKey, threadId, mutate]);

  const openInTheater = useCallback(() => {
    if (!result?.sandboxId) return;

    mutate((state) => ({
      theaterMode: {
        ...state.theaterMode,
        isOpen: true,
        type: "desktop",
        title: `Desktop Session`,
        desktopSession: {
          sandboxId: result.sandboxId!,
          streamUrl: result.streamUrl,
          authKey: result.authKey,
        },
      },
    }));
  }, [result, mutate]);

  const openStreamUrl = useCallback(() => {
    if (result?.streamUrl) {
      // Append auth key if available
      const url = result.authKey
        ? `${result.streamUrl}?authKey=${result.authKey}`
        : result.streamUrl;
      window.open(url, "_blank");
    }
  }, [result?.streamUrl, result?.authKey]);

  // Get friendly tool name and icon
  const { friendlyToolName, Icon } = useMemo(() => {
    switch (toolName) {
      case "desktop_create":
        return { friendlyToolName: "Create Desktop", Icon: Monitor };
      case "desktop_screenshot":
        return { friendlyToolName: "Screenshot", Icon: Monitor };
      case "desktop_click":
        return { friendlyToolName: "Click", Icon: MousePointer };
      case "desktop_type":
        return { friendlyToolName: "Type Text", Icon: Terminal };
      case "desktop_press":
        return { friendlyToolName: "Press Key", Icon: Terminal };
      case "desktop_scroll":
        return { friendlyToolName: "Scroll", Icon: MousePointer };
      case "desktop_launch":
        return { friendlyToolName: "Launch App", Icon: Monitor };
      case "desktop_move":
        return { friendlyToolName: "Move Mouse", Icon: MousePointer };
      case "desktop_drag":
        return { friendlyToolName: "Drag", Icon: MousePointer };
      case "desktop_command":
        return { friendlyToolName: "Run Command", Icon: Terminal };
      case "desktop_stream":
        return { friendlyToolName: "Start Stream", Icon: Monitor };
      case "desktop_close":
        return { friendlyToolName: "Close Desktop", Icon: Monitor };
      default:
        return {
          friendlyToolName: toolName.replace("desktop_", "").replace(/_/g, " "),
          Icon: Monitor,
        };
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
          <Icon className="size-4 text-purple-500" />
          <span className="text-sm font-medium">{friendlyToolName}</span>
          {result.success ? (
            <CheckCircle2 className="size-4 text-green-500" />
          ) : (
            <XCircle className="size-4 text-red-500" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {result.sandboxId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={openInTheater}
              className="h-7 text-xs gap-1"
            >
              <Maximize2 className="size-3" />
              View Live
            </Button>
          )}
          {result.streamUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={openStreamUrl}
              className="h-7 text-xs gap-1"
            >
              <ExternalLink className="size-3" />
              Open Stream
            </Button>
          )}
        </div>
      </div>

      {/* Sandbox ID display */}
      {result.sandboxId && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-background/50 px-2 py-1 rounded">
          <Monitor className="size-3" />
          <span className="truncate">Sandbox: {result.sandboxId}</span>
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

      {/* Screenshot */}
      {hasScreenshot && (
        <div className="relative group">
          <img
            src={result.screenshot}
            alt="Desktop screenshot"
            className="w-full rounded-md border shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
            onClick={openInTheater}
          />
          {result.width && result.height && (
            <div className="absolute bottom-2 right-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded">
              {result.width} × {result.height}
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-md">
            <Button variant="secondary" size="sm" className="gap-1">
              <Eye className="size-3" />
              View Live
            </Button>
          </div>
        </div>
      )}

      {/* Command output */}
      {(result.stdout || result.stderr) && (
        <div className="text-sm">
          <div className="font-medium mb-1 flex items-center gap-2">
            <Terminal className="size-3" />
            Command Output
            {result.exitCode !== undefined && (
              <span
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded",
                  result.exitCode === 0
                    ? "bg-green-500/20 text-green-600"
                    : "bg-red-500/20 text-red-600",
                )}
              >
                Exit: {result.exitCode}
              </span>
            )}
          </div>
          {result.stdout && (
            <pre className="bg-background/50 p-2 rounded text-xs overflow-x-auto max-h-48 whitespace-pre-wrap">
              {result.stdout}
            </pre>
          )}
          {result.stderr && (
            <pre className="bg-red-500/10 p-2 rounded text-xs overflow-x-auto max-h-32 whitespace-pre-wrap text-red-600">
              {result.stderr}
            </pre>
          )}
        </div>
      )}

      {/* Stream URL */}
      {result.streamUrl && (
        <div className="text-sm">
          <div className="font-medium mb-1">Live Stream Available</div>
          <div className="flex items-center gap-2 text-xs bg-background/50 px-2 py-1 rounded">
            <ExternalLink className="size-3 text-purple-500" />
            <span className="truncate flex-1">{result.streamUrl}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={openStreamUrl}
              className="h-5 text-xs"
            >
              Open
            </Button>
          </div>
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

DesktopToolInvocation.displayName = "DesktopToolInvocation";
