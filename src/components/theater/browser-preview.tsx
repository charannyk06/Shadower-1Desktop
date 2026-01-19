"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Camera,
  ExternalLink,
  Globe,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

// Local provider types
type BrowserProvider =
  | "chrome-devtools"
  | "local-terminal"
  | "browserbase"
  | "e2b-desktop";

interface BrowserPreviewProps {
  sessionId: string;
  provider?: BrowserProvider;
  initialUrl?: string;
  replayUrl?: string;
  onClose?: () => void;
  onScreenshot?: (data: string) => void;
  className?: string;
}

interface StreamEvent {
  type: "connected" | "screenshot" | "session_closed" | "error";
  data?: string;
  url?: string;
  timestamp?: string;
  message?: string;
  sessionId?: string;
}

export function BrowserPreview({
  sessionId,
  provider = "chrome-devtools",
  initialUrl,
  replayUrl,
  onClose,
  onScreenshot,
  className,
}: BrowserPreviewProps) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl || "");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  // Connect to SSE stream for live updates
  const connectToStream = useCallback(() => {
    if (!sessionId || !isStreaming) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setIsLoading(true);
    setError(null);

    const eventSource = new EventSource(
      `/api/browser/stream?sessionId=${sessionId}&interval=1000`,
    );

    eventSource.onopen = () => {
      console.log("[BrowserPreview] SSE connection opened");
      retryCountRef.current = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);

        switch (data.type) {
          case "connected":
            setIsConnected(true);
            setIsLoading(false);
            break;

          case "screenshot":
            if (data.data) {
              setScreenshot(`data:image/png;base64,${data.data}`);
              setLastUpdated(new Date());
              setIsLoading(false);
            }
            if (data.url) {
              setCurrentUrl(data.url);
            }
            break;

          case "session_closed":
            setIsConnected(false);
            setError("Browser session has been closed");
            eventSource.close();
            break;

          case "error":
            console.error("[BrowserPreview] Stream error:", data.message);
            setError(data.message || "Stream error occurred");
            break;
        }
      } catch (err) {
        console.error("[BrowserPreview] Failed to parse SSE message:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("[BrowserPreview] SSE error:", err);
      eventSource.close();
      setIsConnected(false);

      if (retryCountRef.current < maxRetries && isStreaming) {
        retryCountRef.current++;
        console.log(
          `[BrowserPreview] Retrying connection (${retryCountRef.current}/${maxRetries})...`,
        );
        setTimeout(connectToStream, 2000 * retryCountRef.current);
      } else {
        setError("Failed to connect to browser stream");
        setIsLoading(false);
      }
    };

    eventSourceRef.current = eventSource;
  }, [sessionId, isStreaming]);

  // Start streaming on mount
  useEffect(() => {
    if (isStreaming) {
      connectToStream();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connectToStream, isStreaming]);

  // Manual screenshot capture
  const takeScreenshot = useCallback(async () => {
    try {
      const response = await fetch("/api/browser/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, saveToHistory: true }),
      });

      if (!response.ok) {
        throw new Error("Failed to capture screenshot");
      }

      const data = await response.json();
      if (data.success && data.screenshot?.data) {
        const screenshotData = `data:image/png;base64,${data.screenshot.data}`;
        setScreenshot(screenshotData);
        setLastUpdated(new Date());
        onScreenshot?.(screenshotData);
      }
    } catch (err) {
      console.error("[BrowserPreview] Screenshot error:", err);
    }
  }, [sessionId, onScreenshot]);

  // Toggle streaming
  const toggleStreaming = useCallback(() => {
    if (isStreaming) {
      // Stop streaming
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsStreaming(false);
    } else {
      // Resume streaming
      setIsStreaming(true);
    }
  }, [isStreaming]);

  // Manual refresh
  const refreshFrame = useCallback(async () => {
    try {
      const response = await fetch("/api/browser/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.frame?.data) {
          setScreenshot(`data:image/png;base64,${data.frame.data}`);
          setLastUpdated(new Date());
          if (data.frame.url) {
            setCurrentUrl(data.frame.url);
          }
        }
      }
    } catch (err) {
      console.error("[BrowserPreview] Refresh error:", err);
    }
  }, [sessionId]);

  return (
    <div
      className={cn(
        "h-full w-full flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-[#0A0A0A] shadow-2xl",
        className,
      )}
    >
      {/* Browser Chrome */}
      <div className="flex-none h-10 bg-[#1a1a1a] border-b border-white/5 flex items-center px-3 gap-2">
        {/* Traffic lights */}
        <div className="flex items-center gap-1.5 mr-2">
          <button
            onClick={onClose}
            className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors flex items-center justify-center group"
          >
            <X className="w-2 h-2 text-red-900 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
        </div>

        {/* URL Bar */}
        <div className="flex-1 flex items-center gap-2 bg-black/40 rounded-md px-3 py-1 border border-white/5">
          <Globe className="w-3.5 h-3.5 text-white/40" />
          <input
            type="text"
            value={currentUrl}
            readOnly
            className="flex-1 bg-transparent text-xs text-white/70 outline-none truncate"
            placeholder="No URL"
          />
          {isConnected && (
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
            onClick={toggleStreaming}
            title={isStreaming ? "Pause live view" : "Resume live view"}
          >
            {isStreaming ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
            onClick={refreshFrame}
            title="Refresh frame"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
            onClick={takeScreenshot}
            title="Capture screenshot"
          >
            <Camera className="w-3.5 h-3.5" />
          </Button>

          {replayUrl && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
              onClick={() => window.open(replayUrl, "_blank")}
              title="Open session replay"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="flex-none h-6 bg-[#151515] border-b border-white/5 px-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] text-white/40">
          <span
            className={cn(
              "flex items-center gap-1",
              isConnected ? "text-green-400" : "text-white/30",
            )}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                isConnected ? "bg-green-400" : "bg-white/30",
              )}
            />
            {isConnected ? "Live" : "Disconnected"}
          </span>
          <span className="text-white/20">|</span>
          <span className="uppercase tracking-wider">{provider}</span>
        </div>

        {lastUpdated && (
          <span className="text-[10px] text-white/30">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Viewport */}
      <div className="flex-1 relative bg-black overflow-hidden">
        {isLoading && !screenshot ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50 gap-4">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-xs font-mono uppercase tracking-wider">
              Connecting to browser...
            </span>
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50 gap-4">
            <AlertCircle className="w-8 h-8 text-red-400/60" />
            <div className="text-center">
              <p className="text-sm text-white/70">{error}</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-4 text-xs"
                onClick={connectToStream}
              >
                <RefreshCw className="w-3 h-3 mr-2" />
                Retry Connection
              </Button>
            </div>
          </div>
        ) : screenshot ? (
          <div className="absolute inset-0 flex items-center justify-center p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshot}
              alt="Browser view"
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/30 gap-4">
            <Globe className="w-12 h-12 opacity-30" />
            <span className="text-xs font-mono uppercase tracking-wider">
              Waiting for content...
            </span>
          </div>
        )}

        {/* Streaming indicator overlay */}
        {isStreaming && isConnected && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 bg-black/60 rounded-full backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] text-white/70 font-mono uppercase">
              Live
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
