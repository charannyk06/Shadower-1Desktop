"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileText, X, Check, Copy } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

interface InlineDocumentPreviewProps {
  content: string;
  type?: "markdown" | "code" | "text";
  language?: string;
  filename?: string;
  onRequestChanges?: (selectedText: string, instruction: string) => void;
  onSave?: (content: string, filename: string) => void;
  sendMessage?: (message: string) => void;
  className?: string;
}

/**
 * Inline document preview component for chat messages.
 * Allows users to view, edit, and request changes to generated documents.
 * Inspired by Conductor's "Writing" panel.
 */
export function InlineDocumentPreview({
  content,
  type = "text",
  language,
  filename,
  onRequestChanges,
  onSave,
  sendMessage,
  className,
}: InlineDocumentPreviewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [editedContent, setEditedContent] = useState(content);
  const [isEditing, setIsEditing] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [selectionPos, setSelectionPos] = useState({ top: 0, left: 0 });
  const [showChangePrompt, setShowChangePrompt] = useState(false);
  const [changeInstruction, setChangeInstruction] = useState("");
  const [copied, setCopied] = useState(false);

  // Handle text selection
  const handleTextSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim() && sel.rangeCount > 0) {
      // Wrap in try-catch as getRangeAt can throw if selection is invalid
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const containerRect = contentRef.current?.getBoundingClientRect();

        // Ensure both rects are valid before calculating position
        if (containerRect && rect.width > 0) {
          setSelection(sel.toString());
          setSelectionPos({
            top: Math.max(0, rect.top - containerRect.top - 40),
            left: Math.max(0, Math.min(rect.left - containerRect.left, containerRect.width - 200)),
          });
        }
      } catch {
        // Selection was invalid, clear it
        setSelection(null);
      }
    } else {
      setSelection(null);
    }
  }, []);

  // Handle "Ask for changes" button
  const handleAskForChanges = useCallback(() => {
    setShowChangePrompt(true);
  }, []);

  // Submit change request
  const handleSubmitChanges = useCallback(() => {
    if (!selection || !changeInstruction.trim()) return;

    const message = `Please modify this text:\n\n"${selection}"\n\nInstruction: ${changeInstruction}`;

    if (sendMessage) {
      sendMessage(message);
    } else if (onRequestChanges) {
      onRequestChanges(selection, changeInstruction);
    }

    setShowChangePrompt(false);
    setChangeInstruction("");
    setSelection(null);
  }, [selection, changeInstruction, sendMessage, onRequestChanges]);

  // Copy content
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editedContent);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy");
    }
  }, [editedContent]);

  // Save content
  const handleSave = useCallback(() => {
    if (onSave && filename) {
      onSave(editedContent, filename);
      toast.success("Saved");
    }
  }, [onSave, editedContent, filename]);

  // Close selection toolbar
  const handleCloseSelection = useCallback(() => {
    setSelection(null);
    setShowChangePrompt(false);
    setChangeInstruction("");
  }, []);

  return (
    <div className={cn("border border-white/10 rounded-lg overflow-hidden my-2 bg-[#0A0A0A]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-white/5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-white/50" />
          <span className="text-sm text-white/70">
            {filename || (type === "code" ? `Code${language ? ` (${language})` : ""}` : "Writing")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-white/50 hover:text-white hover:bg-white/10"
            onClick={handleCopy}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </Button>
          {isEditing ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-white/70 hover:text-white hover:bg-white/10"
              onClick={() => setIsEditing(false)}
            >
              Done
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-white/70 hover:text-white hover:bg-white/10"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="relative">
        <div
          ref={contentRef}
          className={cn(
            "p-4 text-sm text-white/90 min-h-[100px] max-h-[400px] overflow-auto",
            type === "code" ? "font-mono bg-[#0D0D0D]" : "font-sans",
            isEditing && "cursor-text"
          )}
          onMouseUp={handleTextSelection}
          contentEditable={isEditing}
          suppressContentEditableWarning
          onInput={(e) => setEditedContent(e.currentTarget.textContent || "")}
        >
          <pre className={cn(
            "whitespace-pre-wrap break-words",
            type === "code" && "text-xs"
          )}>
            {editedContent}
          </pre>
        </div>

        {/* Selection toolbar */}
        {selection && !showChangePrompt && (
          <div
            className="absolute bg-[#1a1a1a] border border-white/20 rounded-lg shadow-lg p-1 flex items-center gap-1 z-10"
            style={{ top: selectionPos.top, left: selectionPos.left }}
          >
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-white/80 hover:text-white hover:bg-white/10"
              onClick={handleAskForChanges}
            >
              Ask for changes
            </Button>
            <span className="text-white/30 text-xs px-1">⌘K</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-white/50 hover:text-white hover:bg-white/10"
              onClick={handleCloseSelection}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}

        {/* Change instruction input */}
        {showChangePrompt && (
          <div
            className="absolute bg-[#1a1a1a] border border-white/20 rounded-lg shadow-lg p-3 z-10 w-72"
            style={{ top: selectionPos.top, left: selectionPos.left }}
          >
            <div className="text-xs text-white/50 mb-2">Describe changes:</div>
            <textarea
              value={changeInstruction}
              onChange={(e) => setChangeInstruction(e.target.value)}
              placeholder="e.g., Make this more concise..."
              className="w-full h-20 bg-black/30 border border-white/10 rounded-md p-2 text-sm text-white/90 resize-none focus:outline-none focus:border-white/30"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 mt-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={handleCloseSelection}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleSubmitChanges}
                disabled={!changeInstruction.trim()}
              >
                Submit
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Footer with save option */}
      {onSave && filename && (
        <div className="px-3 py-2 border-t border-white/10 bg-white/5">
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs border-white/10 hover:bg-white/10"
            onClick={handleSave}
          >
            Save to {filename}
          </Button>
        </div>
      )}
    </div>
  );
}
