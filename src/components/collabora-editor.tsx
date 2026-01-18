"use client";

/**
 * Collabora Editor Component
 *
 * Embeds the Collabora Online editor in an iframe for document editing.
 * Handles PostMessage communication for save events, close actions, etc.
 */

import { Button } from "@/components/ui/button";
import type { CollaboraPostMessageEvent } from "@/lib/collabora/types";
import { cn } from "@/lib/utils";
import { AlertCircle, Loader2, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface CollaboraEditorProps {
  /** The full Collabora editor URL with WOPI params */
  editorUrl: string;
  /** File name for display */
  fileName: string;
  /** Called when user closes the editor */
  onClose?: () => void;
  /** Called when document is saved */
  onSave?: () => void;
  /** Called when document is modified */
  onModified?: (modified: boolean) => void;
  /** Additional class names */
  className?: string;
}

export function CollaboraEditor({
  editorUrl,
  fileName,
  onClose,
  onSave,
  onModified,
  className,
}: CollaboraEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModified, setIsModified] = useState(false);

  // Handle PostMessage events from Collabora
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Verify origin EXACTLY matches Collabora server (security: prevent origin spoofing)
      const collaboraUrl = process.env.NEXT_PUBLIC_COLLABORA_URL;
      if (collaboraUrl) {
        const expectedOrigin = new URL(collaboraUrl).origin;
        if (event.origin !== expectedOrigin) {
          return; // Ignore messages from other origins
        }
      }

      try {
        // Collabora sends JSON strings
        const data: CollaboraPostMessageEvent =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;

        switch (data.MessageId) {
          case "App_LoadingStatus":
            // Collabora sends various status values - accept any that indicate progress
            if (
              data.Values?.Status === "Document_Loaded" ||
              data.Values?.Status === "Frame_Ready"
            ) {
              setIsLoading(false);
              setError(null);
            }
            break;

          case "Action_Load_Resp":
            // Document loaded response - also indicates loading complete
            setIsLoading(false);
            setError(null);
            break;

          case "Doc_ModifiedStatus":
            setIsModified(data.Values?.Modified ?? false);
            onModified?.(data.Values?.Modified ?? false);
            break;

          case "UI_Close":
          case "Action_Close":
            onClose?.();
            break;

          case "UI_Save":
            if (data.Values?.success) {
              setIsModified(false);
              onSave?.();
            }
            break;

          case "Action_Save":
            // Document was saved
            setIsModified(false);
            onSave?.();
            break;
        }
      } catch (_e) {
        // Not a JSON message, ignore
      }
    },
    [onClose, onSave, onModified],
  );

  // Set up message listener
  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Handle iframe load
  const handleIframeLoad = () => {
    // Give Collabora a moment to initialize
    setTimeout(() => {
      if (isLoading) {
        // If still loading after 10 seconds, show warning
        setTimeout(() => {
          if (isLoading) {
            console.warn("Collabora taking longer than expected to load");
          }
        }, 10000);
      }
    }, 1000);
  };

  // Handle iframe error
  const handleIframeError = () => {
    setError("Failed to load document editor. Please check your connection.");
    setIsLoading(false);
  };

  // Send PostMessage to Collabora (use specific origin, not wildcard)
  const postMessage = (message: Record<string, unknown>) => {
    if (iframeRef.current?.contentWindow) {
      const collaboraUrl = process.env.NEXT_PUBLIC_COLLABORA_URL;
      const targetOrigin = collaboraUrl ? new URL(collaboraUrl).origin : "*";
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify(message),
        targetOrigin,
      );
    }
  };

  // Trigger save
  const handleSave = () => {
    postMessage({
      MessageId: "Action_Save",
      Values: { DontTerminateEdit: true, DontSaveIfUnmodified: true },
    });
  };

  // Trigger close
  const handleClose = () => {
    if (isModified) {
      // Ask Collabora to save before closing
      postMessage({
        MessageId: "Action_Save",
        Values: { DontTerminateEdit: false, DontSaveIfUnmodified: false },
      });
      // Give it time to save, then close
      setTimeout(() => onClose?.(), 500);
    } else {
      onClose?.();
    }
  };

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate max-w-[200px]">
            {fileName}
          </span>
          {isModified && (
            <span className="text-xs text-muted-foreground">(unsaved)</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isModified && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              className="h-8"
            >
              <Save className="h-4 w-4 mr-1" />
              Save
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="h-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Editor iframe */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Loading document editor...
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="flex flex-col items-center gap-2 text-destructive">
              <AlertCircle className="h-8 w-8" />
              <span className="text-sm">{error}</span>
              <Button variant="outline" size="sm" onClick={() => onClose?.()}>
                Close
              </Button>
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={editorUrl}
          title={`Collabora Editor - ${fileName || "Document"}`}
          className="w-full h-full border-0"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          allow="clipboard-read; clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        />
      </div>
    </div>
  );
}

/**
 * Hook to generate Collabora editor URL
 */
export function useCollaboraEditor() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getEditorUrl = async (
    fileId: string,
    fileName: string,
    mimeType: string,
    threadId: string,
  ): Promise<string | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/collabora/editor-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, fileName, mimeType, threadId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to get editor URL");
      }

      const data = await response.json();
      return data.editorUrl;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { getEditorUrl, isLoading, error };
}

export default CollaboraEditor;
