"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Camera,
  ExternalLink,
  Loader2,
  Monitor,
  MousePointer,
  Pause,
  Play,
  RefreshCw,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface DesktopPreviewProps {
  sandboxId: string;
  streamUrl?: string;
  authKey?: string;
  onClose?: () => void;
  onScreenshot?: (data: string) => void;
  className?: string;
}

export function DesktopPreview({
  sandboxId,
  streamUrl,
  authKey,
  onClose,
  onScreenshot,
  className,
}: DesktopPreviewProps) {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showStream, setShowStream] = useState(false);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Stop polling - defined first to avoid circular dependency
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // Fetch screenshot from desktop sandbox
  const fetchScreenshot = useCallback(async () => {
    try {
      // Use GET request with sandboxId as query param for polling efficiency
      const response = await fetch(
        `/api/desktop/screenshot?sandboxId=${encodeURIComponent(sandboxId)}`,
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to capture screenshot");
      }

      const data = await response.json();
      if (data.success && data.screenshot) {
        // API returns full data URI already
        setScreenshot(data.screenshot);
        setLastUpdated(new Date());
        setIsConnected(true);
        setIsLoading(false);
        setError(null);
      } else if (!data.success) {
        throw new Error(data.error || "Screenshot failed");
      }
    } catch (err: any) {
      console.error("[DesktopPreview] Screenshot error:", err);
      // Only show error if we don't have a screenshot yet
      if (!screenshot) {
        setError(err.message || "Failed to fetch screenshot");
        setIsLoading(false);
      }
      // If session is gone, stop polling
      if (
        err.message?.includes("not found") ||
        err.message?.includes("reconnect")
      ) {
        stopPolling();
        setIsConnected(false);
      }
    }
  }, [sandboxId, screenshot, stopPolling]);

  // Start polling for screenshots
  const startPolling = useCallback(() => {
    if (pollingRef.current) return;

    setIsStreaming(true);
    fetchScreenshot(); // Initial fetch

    pollingRef.current = setInterval(() => {
      fetchScreenshot();
    }, 2000); // Poll every 2 seconds
  }, [fetchScreenshot]);

  // Toggle streaming
  const toggleStreaming = useCallback(() => {
    if (isStreaming) {
      stopPolling();
    } else {
      startPolling();
    }
  }, [isStreaming, startPolling, stopPolling]);

  // Switch to VNC stream view
  const toggleStreamView = useCallback(() => {
    setShowStream(!showStream);
  }, [showStream]);

  // Manual screenshot capture
  const takeScreenshot = useCallback(async () => {
    await fetchScreenshot();
    if (screenshot) {
      onScreenshot?.(screenshot);
    }
  }, [fetchScreenshot, screenshot, onScreenshot]);

  // Start polling on mount
  useEffect(() => {
    startPolling();

    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  // Build stream URL with auth
  const getStreamSrc = useCallback(() => {
    if (!streamUrl) return null;
    if (authKey) {
      const url = new URL(streamUrl);
      url.searchParams.set("authKey", authKey);
      return url.toString();
    }
    return streamUrl;
  }, [streamUrl, authKey]);

  const streamSrc = getStreamSrc();

  return (
    <div
      className={cn(
        "h-full w-full flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-[#0A0A0A] shadow-2xl",
        className,
      )}
    >
      {/* Desktop Chrome */}
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

        {/* Title Bar */}
        <div className="flex-1 flex items-center gap-2 bg-black/40 rounded-md px-3 py-1 border border-white/5">
          <Monitor className="w-3.5 h-3.5 text-white/40" />
          <span className="text-xs text-white/70 truncate">Local Desktop</span>
          <span className="text-[10px] text-white/30 ml-auto font-mono">
            {sandboxId.substring(0, 8)}...
          </span>
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
            title={isStreaming ? "Pause updates" : "Resume updates"}
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
            onClick={fetchScreenshot}
            title="Refresh screenshot"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
            onClick={takeScreenshot}
            title="Save screenshot"
          >
            <Camera className="w-3.5 h-3.5" />
          </Button>

          {streamUrl && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 hover:bg-white/10",
                showStream
                  ? "text-purple-400"
                  : "text-white/50 hover:text-white",
              )}
              onClick={toggleStreamView}
              title={showStream ? "Show screenshots" : "Show live stream"}
            >
              <MousePointer className="w-3.5 h-3.5" />
            </Button>
          )}

          {streamSrc && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-white/50 hover:text-white hover:bg-white/10"
              onClick={() => window.open(streamSrc, "_blank")}
              title="Open stream in new window"
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
            {isConnected ? "Connected" : "Disconnected"}
          </span>
          <span className="text-white/20">|</span>
          <span className="uppercase tracking-wider flex items-center gap-1">
            <Terminal className="w-3 h-3" />
            Local Terminal
          </span>
          {showStream && streamUrl && (
            <>
              <span className="text-white/20">|</span>
              <span className="text-purple-400 uppercase tracking-wider">
                Interactive Mode
              </span>
            </>
          )}
        </div>

        {lastUpdated && !showStream && (
          <span className="text-[10px] text-white/30">
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Viewport */}
      <div className="flex-1 relative bg-black overflow-hidden">
        {showStream && streamSrc ? (
          // VNC Stream View (interactive)
          <iframe
            ref={iframeRef}
            src={streamSrc}
            className="absolute inset-0 w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            title="Desktop Stream"
          />
        ) : isLoading && !screenshot ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/50 gap-4">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-xs font-mono uppercase tracking-wider">
              Connecting to desktop...
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
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                  fetchScreenshot();
                }}
              >
                <RefreshCw className="w-3 h-3 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        ) : screenshot ? (
          <div className="absolute inset-0 flex items-center justify-center p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshot}
              alt="Desktop view"
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white/30 gap-4">
            <Monitor className="w-12 h-12 opacity-30" />
            <span className="text-xs font-mono uppercase tracking-wider">
              Waiting for desktop...
            </span>
          </div>
        )}

        {/* Status overlay */}
        {isStreaming && isConnected && !showStream && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 bg-black/60 rounded-full backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] text-white/70 font-mono uppercase">
              Polling
            </span>
          </div>
        )}

        {showStream && streamUrl && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 bg-purple-500/20 rounded-full backdrop-blur-sm border border-purple-500/30">
            <MousePointer className="w-3 h-3 text-purple-400" />
            <span className="text-[10px] text-purple-400 font-mono uppercase">
              Interactive
            </span>
          </div>
        )}
      </div>

      {/* Interactive mode hint */}
      {showStream && streamUrl && (
        <div className="flex-none h-8 bg-purple-500/10 border-t border-purple-500/20 px-3 flex items-center justify-center">
          <span className="text-[10px] text-purple-400">
            Click inside to interact with the desktop • Mouse and keyboard input
            forwarded
          </span>
        </div>
      )}
    </div>
  );
}
