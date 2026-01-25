"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileText, X, Check, Copy, Edit3, Save, ArrowLeft, Undo2, Sparkles, Loader2 } from "lucide-react";
import { useCallback, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { Markdown } from "./markdown";
import { appStore } from "@/app/store";
import { aiApi, isElectronMode } from "@/lib/electron/ai-api";

// AI-powered text enhancement - enhances ONLY the selected text
async function enhanceTextWithAI(
  selectedText: string,
  instruction: string
): Promise<string> {
  const model = appStore.getState().chatModel;
  
  if (!model) {
    throw new Error("No AI model selected. Please select a model in settings.");
  }

  if (!isElectronMode()) {
    throw new Error("AI enhancement requires the desktop app.");
  }

  const systemPrompt = `You are a text editor. Enhance the given text according to the instruction.

RULES:
1. Output ONLY the enhanced text - nothing else
2. No explanations, no quotes, no prefixes
3. Keep similar length unless asked to expand/shorten
4. Preserve formatting style`;

  const userPrompt = `Text: "${selectedText}"

Instruction: ${instruction}

Enhanced text:`;

  try {
    const result = await aiApi.generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 2000,
    });

    let enhanced = result.trim();
    
    // Clean up common AI response patterns
    if (enhanced.startsWith('"') && enhanced.endsWith('"')) {
      enhanced = enhanced.slice(1, -1);
    }
    if (enhanced.startsWith("Enhanced text:")) {
      enhanced = enhanced.replace(/^Enhanced text:\s*/i, "");
    }

    return enhanced || selectedText;
  } catch (error: any) {
    console.error("AI enhancement error:", error);
    throw new Error(error.message || "Failed to enhance text");
  }
}

interface PendingEnhancement {
  originalText: string;
  enhancedText: string;
  startIndex: number;
  endIndex: number;
}

interface InlineDocumentPreviewProps {
  content: string;
  type?: "markdown" | "code" | "text";
  language?: string;
  filename?: string;
  onRequestChanges?: (selectedText: string, instruction: string) => void;
  onSave?: (content: string, filename: string) => void;
  sendMessage?: (message: string) => void;
  onContentChange?: (newContent: string) => void;
  onClose?: () => void;
  className?: string;
}

/**
 * Enhanced Writing panel component for chat messages.
 * Features professional inline editing with Accept/Undo for AI enhancements.
 */
export function InlineDocumentPreview({
  content,
  type = "text",
  language,
  filename,
  onRequestChanges: _onRequestChanges, // Legacy prop, kept for backwards compatibility
  onSave,
  sendMessage: _sendMessage, // Reserved for future AI integration
  onContentChange,
  onClose,
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
  
  // New state for inline enhancement
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [pendingEnhancement, setPendingEnhancement] = useState<PendingEnhancement | null>(null);
  const [selectionIndices, setSelectionIndices] = useState<{ start: number; end: number } | null>(null);
  
  // Store selection data when opening the prompt (so it's not lost)
  const [savedSelection, setSavedSelection] = useState<{
    text: string;
    indices: { start: number; end: number } | null;
  } | null>(null);
  

  // Track if content was modified locally (to prevent reset from prop)
  const contentModifiedRef = useRef(false);
  const prevContentRef = useRef(content);
  
  // Only sync from content prop when it ACTUALLY changes from external source
  useEffect(() => {
    const contentChanged = content !== prevContentRef.current;
    console.log("[ContentSync] Effect running:", {
      contentModified: contentModifiedRef.current,
      contentChanged,
      contentLength: content.length,
      prevContentLength: prevContentRef.current.length,
      editedContentLength: editedContent.length,
      isEditing,
      hasPending: !!pendingEnhancement
    });
    
    // If we modified content locally, don't reset
    if (contentModifiedRef.current) {
      console.log("[ContentSync] SKIPPING - content was modified locally");
      prevContentRef.current = content;
      return;
    }
    
    // Don't reset during editing or pending enhancement
    if (isEditing || pendingEnhancement) {
      console.log("[ContentSync] SKIPPING - editing or pending");
      return;
    }
    
    // Only sync if content prop actually changed
    if (contentChanged) {
      console.log("[ContentSync] Syncing from content prop");
      setEditedContent(content);
      prevContentRef.current = content;
    }
  }, [content, isEditing, pendingEnhancement, editedContent]);

  // Get selection indices - find selected text in content with smart matching
  const getSelectionIndices = useCallback((selectedText: string): { start: number; end: number } | null => {
    console.log("[getSelectionIndices] Looking for:", selectedText.slice(0, 60));
    
    // Strategy 1: Exact match
    let idx = editedContent.indexOf(selectedText);
    if (idx !== -1) {
      console.log("[getSelectionIndices] Found exact match at", idx);
      return { start: idx, end: idx + selectedText.length };
    }
    
    // Strategy 2: Trimmed match
    const trimmed = selectedText.trim();
    idx = editedContent.indexOf(trimmed);
    if (idx !== -1) {
      console.log("[getSelectionIndices] Found trimmed match at", idx);
      return { start: idx, end: idx + trimmed.length };
    }
    
    // Strategy 3: Line-by-line search
    // Split both into lines and find matching segments
    const selLines = selectedText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const contentLines = editedContent.split('\n');
    
    if (selLines.length > 0) {
      const firstSelLine = selLines[0];
      
      // Find which content line contains the first selected line
      for (let i = 0; i < contentLines.length; i++) {
        const contentLine = contentLines[i];
        // Check if content line contains the selected line (handles markdown prefix)
        if (contentLine.includes(firstSelLine) || 
            contentLine.replace(/^#+\s*/, '').includes(firstSelLine) ||
            contentLine.replace(/^\*+\s*/, '').includes(firstSelLine) ||
            contentLine.replace(/^[-*+]\s+/, '').includes(firstSelLine) ||
            contentLine.replace(/^\d+\.\s+/, '').includes(firstSelLine)) {
          
          // Calculate character position of this line
          let startPos = 0;
          for (let j = 0; j < i; j++) {
            startPos += contentLines[j].length + 1; // +1 for newline
          }
          
          // Find end position - if multiple lines selected, find last line
          let endLineIdx = i;
          if (selLines.length > 1) {
            const lastSelLine = selLines[selLines.length - 1];
            for (let k = i; k < contentLines.length && k < i + selLines.length + 2; k++) {
              const line = contentLines[k];
              if (line.includes(lastSelLine) || 
                  line.replace(/^#+\s*/, '').includes(lastSelLine) ||
                  line.replace(/^\*+\s*/, '').includes(lastSelLine)) {
                endLineIdx = k;
                break;
              }
            }
          }
          
          // Calculate end position
          let endPos = startPos;
          for (let j = i; j <= endLineIdx; j++) {
            endPos += contentLines[j].length + (j < endLineIdx ? 1 : 0);
          }
          
          console.log("[getSelectionIndices] Found line match, lines", i, "to", endLineIdx, "pos", startPos, "to", endPos);
          return { start: startPos, end: endPos };
        }
      }
    }
    
    // Strategy 4: Find first significant word sequence
    const words = trimmed.split(/\s+/).filter(w => w.length > 3);
    if (words.length >= 2) {
      const searchPhrase = words.slice(0, 3).join(' ');
      idx = editedContent.indexOf(searchPhrase);
      if (idx === -1) {
        // Try without first word (might be after markdown)
        const searchPhrase2 = words.slice(1, 4).join(' ');
        idx = editedContent.indexOf(searchPhrase2);
      }
      if (idx !== -1) {
        // Found start, estimate end
        const estimatedEnd = Math.min(idx + selectedText.length + 20, editedContent.length);
        console.log("[getSelectionIndices] Found phrase match at", idx);
        return { start: idx, end: estimatedEnd };
      }
    }
    
    console.warn("[getSelectionIndices] Could not find selection in content");
    return null;
  }, [editedContent]);

  // Handle text selection
  const handleTextSelection = useCallback(() => {
    // Don't allow selection during enhancement or if there's a pending change
    if (isEnhancing || pendingEnhancement) {
      console.log("[Selection] Blocked - enhancing or pending");
      return;
    }
    
    // Don't clear selection if we're showing the change prompt (user is typing)
    if (showChangePrompt || savedSelection) {
      console.log("[Selection] Preserved - showing prompt or have saved selection");
      return;
    }
    
    const sel = window.getSelection();
    const selectedText = sel?.toString().trim();
    
    console.log("[Selection] handleTextSelection called, selectedText:", selectedText?.slice(0, 30) || "empty");
    
    if (sel && selectedText && sel.rangeCount > 0) {
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const containerRect = contentRef.current?.getBoundingClientRect();

        if (containerRect && rect.width > 0) {
          setSelection(selectedText);
          const indices = getSelectionIndices(selectedText);
          setSelectionIndices(indices);
          console.log("[Selection] Set selection:", selectedText.slice(0, 30), "indices:", indices);
          
          const dialogWidth = 288; // w-72 for the prompt dialog
          const dialogHeight = 160; // approximate height of prompt dialog
          
          // Position near the selection end, ensuring fully visible
          let topPos = rect.bottom + 8;
          let leftPos = rect.right - dialogWidth / 2;
          
          // Keep within viewport bounds with padding
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const padding = 16;
          
          // Horizontal bounds
          if (leftPos + dialogWidth > viewportWidth - padding) {
            leftPos = viewportWidth - dialogWidth - padding;
          }
          if (leftPos < padding) {
            leftPos = padding;
          }
          
          // Vertical bounds - if dialog would go below viewport, show above selection
          if (topPos + dialogHeight > viewportHeight - padding) {
            topPos = rect.top - dialogHeight - 8;
          }
          // If still off screen (above viewport), just position at top
          if (topPos < padding) {
            topPos = padding;
          }
          
          console.log("[Selection] Position:", { topPos, leftPos, viewportHeight, rectBottom: rect.bottom });
          
          setSelectionPos({
            top: topPos,
            left: leftPos,
          });
        }
      } catch (e) {
        console.error("[Selection] Error:", e);
        setSelection(null);
        setSelectionIndices(null);
      }
    } else {
      // Only clear if we don't have text selected
      console.log("[Selection] Clearing selection (no text)");
      setSelection(null);
      setSelectionIndices(null);
    }
  }, [isEnhancing, pendingEnhancement, showChangePrompt, savedSelection, getSelectionIndices]);

  // Handle "Ask for changes" button
  const handleAskForChanges = useCallback(() => {
    console.log("[Enhance] handleAskForChanges called, selection:", selection?.slice(0, 30));
    
    // Save selection data before showing prompt
    if (selection) {
      // Compute indices now if we don't have them
      const indices = selectionIndices || getSelectionIndices(selection);
      setSavedSelection({
        text: selection,
        indices: indices,
      });
      console.log("[Enhance] Saved selection:", selection.slice(0, 30), "indices:", indices);
      setShowChangePrompt(true);
    } else {
      console.error("[Enhance] No selection to save!");
      toast.error("Please select some text first");
    }
  }, [selection, selectionIndices, getSelectionIndices]);

  // Submit change request - enhance only selected text
  const handleSubmitChanges = useCallback(async () => {
    const selText = savedSelection?.text || selection;
    const savedIndices = savedSelection?.indices || selectionIndices;
    
    if (!selText) {
      toast.error("Please select some text first");
      return;
    }
    
    if (!changeInstruction.trim()) {
      toast.error("Please enter an enhancement instruction");
      return;
    }

    setIsEnhancing(true);
    setShowChangePrompt(false);

    try {
      // Get enhanced version of ONLY the selected text
      const enhancedText = await enhanceTextWithAI(selText, changeInstruction);
      
      console.log("[Enhancement] Selected:", selText.slice(0, 50));
      console.log("[Enhancement] Enhanced:", enhancedText.slice(0, 50));
      console.log("[Enhancement] Saved indices:", savedIndices);
      
      let startIdx: number;
      let endIdx: number;
      let originalInMarkdown: string;
      
      // PRIORITY 1: Use pre-computed indices (these handle markdown stripping)
      if (savedIndices) {
        startIdx = savedIndices.start;
        endIdx = savedIndices.end;
        originalInMarkdown = editedContent.slice(startIdx, endIdx);
        console.log("[Enhancement] Using saved indices:", startIdx, "to", endIdx);
        console.log("[Enhancement] Original markdown text:", originalInMarkdown.slice(0, 50));
      } else {
        // FALLBACK: Try to find the text directly
        console.log("[Enhancement] No saved indices, trying direct search");
        
        // Try exact match first
        startIdx = editedContent.indexOf(selText);
        
        if (startIdx === -1) {
          // Try trimmed
          const trimmedSel = selText.trim();
          startIdx = editedContent.indexOf(trimmedSel);
        }
        
        if (startIdx === -1) {
          // Try first line
          const firstLine = selText.split('\n')[0].trim();
          if (firstLine.length > 5) {
            startIdx = editedContent.indexOf(firstLine);
          }
        }
        
        if (startIdx === -1) {
          toast.error("Could not locate selected text. Please try selecting again.");
          return;
        }
        
        endIdx = startIdx + selText.length;
        originalInMarkdown = selText;
      }
      
      // Ensure bounds are valid
      if (endIdx > editedContent.length) {
        endIdx = editedContent.length;
      }
      
      // Build new content by replacing the markdown portion
      const newContent = editedContent.slice(0, startIdx) + enhancedText + editedContent.slice(endIdx);
      
      console.log("[Enhancement] Replaced at index:", startIdx, "to", endIdx);
      console.log("[Enhancement] Original content length:", editedContent.length);
      console.log("[Enhancement] New content length:", newContent.length);
      
      // Store for Accept/Undo
      setPendingEnhancement({
        originalText: originalInMarkdown,
        enhancedText: enhancedText,
        startIndex: startIdx,
        endIndex: endIdx,
      });
      
      // Update content
      setEditedContent(newContent);
      
    } catch (error: any) {
      toast.error(error?.message || "Failed to enhance text");
      console.error("Enhancement error:", error);
    } finally {
      setIsEnhancing(false);
      setChangeInstruction("");
      setSelection(null);
      setSavedSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [savedSelection, selection, selectionIndices, changeInstruction, editedContent]);

  // Accept the enhancement
  const handleAcceptEnhancement = useCallback(() => {
    if (!pendingEnhancement) return;
    
    console.log("=== [Accept] START ===");
    console.log("[Accept] editedContent length:", editedContent.length);
    console.log("[Accept] editedContent preview:", editedContent.slice(0, 200));
    console.log("[Accept] original content prop length:", content.length);
    
    // Mark that we modified content locally (prevents useEffect from resetting)
    contentModifiedRef.current = true;
    console.log("[Accept] Set contentModifiedRef to TRUE");
    
    // Notify parent of content change
    if (onContentChange) {
      console.log("[Accept] Calling onContentChange NOW");
      onContentChange(editedContent);
      console.log("[Accept] onContentChange called");
    } else {
      console.log("[Accept] WARNING: No onContentChange callback!");
    }
    
    toast.success("Changes accepted");
    setPendingEnhancement(null);
    setSelectionIndices(null);
    console.log("=== [Accept] END ===");
  }, [pendingEnhancement, editedContent, onContentChange, content]);

  // Undo the enhancement
  const handleUndoEnhancement = useCallback(() => {
    if (!pendingEnhancement) return;
    
    // Restore original content
    const restoredContent = 
      editedContent.slice(0, pendingEnhancement.startIndex) + 
      pendingEnhancement.originalText + 
      editedContent.slice(pendingEnhancement.startIndex + pendingEnhancement.enhancedText.length);
    
    setEditedContent(restoredContent);
    setPendingEnhancement(null);
    setSelectionIndices(null);
    toast.info("Changes reverted");
  }, [pendingEnhancement, editedContent]);

  // Keyboard shortcuts for Accept/Undo
  useEffect(() => {
    if (!pendingEnhancement) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleAcceptEnhancement();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleUndoEnhancement();
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingEnhancement, handleAcceptEnhancement, handleUndoEnhancement]);

  // Copy content
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editedContent);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }, [editedContent]);

  // Save content
  const handleSave = useCallback(() => {
    if (onSave && filename) {
      onSave(editedContent, filename);
      toast.success(`Saved to ${filename}`);
    }
  }, [onSave, editedContent, filename]);

  // Close selection toolbar
  const handleCloseSelection = useCallback(() => {
    setSelection(null);
    setSelectionIndices(null);
    setSavedSelection(null);
    setShowChangePrompt(false);
    setChangeInstruction("");
    window.getSelection()?.removeAllRanges();
  }, []);

  // Render content with inline diff view (original strikethrough + new highlighted)
  const renderContentWithHighlight = (text: string) => {
    if (!pendingEnhancement) {
      return text;
    }

    const { startIndex, originalText, enhancedText } = pendingEnhancement;
    
    // Get the content before and after the change
    // Note: text already has the enhanced content, so we need to reconstruct
    const before = text.slice(0, startIndex);
    const after = text.slice(startIndex + enhancedText.length);

    return (
      <>
        {before}
        {/* Inline diff block */}
        <span className="inline">
          {/* Original text - strikethrough with red tint */}
          <span className="bg-red-500/15 text-red-300/80 line-through decoration-red-400/60 px-0.5 rounded-sm">
            {originalText}
          </span>
          {" "}
          {/* New text - highlighted with green/blue tint */}
          <span className="bg-emerald-500/20 text-emerald-200 border-b-2 border-emerald-400/60 px-0.5 rounded-sm">
            {enhancedText}
          </span>
          {/* Inline Accept/Undo buttons */}
          <span className="inline-flex items-center gap-1 ml-2 align-middle">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleUndoEnhancement();
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors cursor-pointer"
            >
              Undo
              <span className="text-white/40 font-mono">ESC</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAcceptEnhancement();
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors cursor-pointer"
            >
              Accept
              <span className="text-blue-200 font-mono">⌘↵</span>
            </button>
          </span>
        </span>
        {after}
      </>
    );
  };

  // Auto-resize textarea ref
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Auto-resize textarea when content changes
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const textarea = textareaRef.current;
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight, but with min/max bounds
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 300), 600);
      textarea.style.height = `${newHeight}px`;
    }
  }, [isEditing, editedContent]);

  // Render content based on type
  const renderContent = () => {
    if (isEditing) {
      return (
        <textarea
          ref={textareaRef}
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          className={cn(
            "w-full min-h-[300px] p-6 bg-transparent text-white/90 text-sm font-sans leading-relaxed",
            "border-0 outline-none resize-none focus:ring-0",
            type === "code" && "font-mono text-xs"
          )}
          style={{ 
            fontFamily: type === "code" ? "monospace" : "inherit",
            boxSizing: "border-box"
          }}
          autoFocus
        />
      );
    }

    // Check if content has markdown patterns (bold text, lists, etc.)
    const hasMarkdownPatterns = type === "markdown" || 
      /\*\*[^*]+\*\*/.test(editedContent) || 
      /^[-*]\s/gm.test(editedContent) || 
      /^\d+\.\s/gm.test(editedContent);

    if (hasMarkdownPatterns) {
      return (
        <div className="p-6 text-white/90">
          <style>{`
            .writing-panel-markdown {
              color: rgba(255, 255, 255, 0.9) !important;
              font-size: 0.875rem;
              line-height: 1.75;
            }
            .writing-panel-markdown h1,
            .writing-panel-markdown h2,
            .writing-panel-markdown h3,
            .writing-panel-markdown h4,
            .writing-panel-markdown h5,
            .writing-panel-markdown h6 {
              color: rgba(255, 255, 255, 0.95) !important;
              font-weight: 600 !important;
              font-size: 1rem !important;
              margin-top: 1.25em !important;
              margin-bottom: 0.5em !important;
            }
            .writing-panel-markdown p {
              margin-top: 0.75em !important;
              margin-bottom: 0.75em !important;
              line-height: 1.75 !important;
            }
            .writing-panel-markdown ul,
            .writing-panel-markdown ol {
              margin-top: 0.75em !important;
              margin-bottom: 0.75em !important;
              padding-left: 1.75em !important;
            }
            .writing-panel-markdown li {
              margin-top: 0.5em !important;
              margin-bottom: 0.5em !important;
              line-height: 1.75 !important;
              padding-left: 0.25em !important;
              display: list-item !important;
            }
            .writing-panel-markdown ul > li {
              list-style-type: disc !important;
            }
            .writing-panel-markdown ol > li {
              list-style-type: decimal !important;
            }
            .writing-panel-markdown ul > li::marker,
            .writing-panel-markdown ol > li::marker {
              color: rgba(255, 255, 255, 0.6) !important;
            }
            .writing-panel-markdown strong {
              color: rgba(255, 255, 255, 0.95) !important;
              font-weight: 600 !important;
            }
            .writing-panel-markdown code {
              background-color: rgba(255, 255, 255, 0.1) !important;
              padding: 0.125rem 0.375rem !important;
              border-radius: 0.25rem !important;
              font-size: 0.875em !important;
            }
            .writing-panel-markdown pre {
              background-color: rgba(0, 0, 0, 0.3) !important;
              padding: 1rem !important;
              border-radius: 0.5rem !important;
              overflow-x: auto !important;
              margin: 1em 0 !important;
            }
            .writing-panel-markdown blockquote {
              border-left: 4px solid rgba(255, 255, 255, 0.2) !important;
              padding-left: 1rem !important;
              margin-left: 0 !important;
              color: rgba(255, 255, 255, 0.7) !important;
            }
          `}</style>
          <div className="writing-panel-markdown">
            {pendingEnhancement ? (
              // Show content with highlighted change
              <div>
                {/* Content before change */}
                <Markdown>{editedContent.slice(0, pendingEnhancement.startIndex)}</Markdown>
                
                {/* The changed section - highlighted */}
                <div className="my-2 border-l-2 border-emerald-500 pl-3 py-1 bg-emerald-500/10 rounded-r">
                  <Markdown>{pendingEnhancement.enhancedText}</Markdown>
                </div>
                
                {/* Content after change */}
                <Markdown>{editedContent.slice(pendingEnhancement.startIndex + pendingEnhancement.enhancedText.length)}</Markdown>
                
                {/* Accept/Undo buttons */}
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/10">
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleUndoEnhancement(); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-md cursor-pointer"
                  >
                    Undo <span className="text-white/40 font-mono text-[10px]">ESC</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAcceptEnhancement(); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md cursor-pointer"
                  >
                    Accept <span className="text-blue-200 font-mono text-[10px]">⌘↵</span>
                  </button>
                </div>
              </div>
            ) : (
              <Markdown>{editedContent}</Markdown>
            )}
          </div>
        </div>
      );
    }

    if (type === "code") {
      return (
        <pre className="p-4 text-xs font-mono text-white/90 overflow-x-auto">
          <code>{pendingEnhancement ? renderContentWithHighlight(editedContent) : editedContent}</code>
        </pre>
      );
    }

    return (
      <div className="p-6 text-sm text-white/90 whitespace-pre-wrap break-words leading-relaxed">
        {pendingEnhancement ? renderContentWithHighlight(editedContent) : editedContent}
      </div>
    );
  };

  return (
    <div 
      className={cn(
        "group relative border border-white/10 rounded-xl overflow-hidden my-3",
        "bg-gradient-to-br from-[#0A0A0A] via-[#0D0D0D] to-[#0A0A0A]",
        "shadow-2xl shadow-black/40",
        "transition-all duration-300 hover:border-white/20 hover:shadow-black/60",
        pendingEnhancement && "ring-1 ring-blue-500/30",
        className
      )}
    >
      {/* Enhanced Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-white/[0.06] via-white/[0.03] to-transparent border-b border-white/10">
        <div className="flex items-center gap-3">
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/10 transition-all"
              onClick={onClose}
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          <div className="p-1.5 rounded-lg bg-white/5 border border-white/10 backdrop-blur-sm">
            <FileText className="w-4 h-4 text-white/70" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-white/90">
              {filename || (type === "code" ? `Code${language ? ` (${language})` : ""}` : "Writing")}
            </span>
            {type === "markdown" && (
              <span className="text-xs text-white/40">Markdown Document</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/10 transition-all"
            onClick={handleCopy}
            title="Copy"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </Button>
          {onSave && filename && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white/50 hover:text-white hover:bg-white/10 transition-all"
              onClick={handleSave}
              title="Save"
            >
              <Save className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 px-3 text-xs font-medium transition-all",
              isEditing
                ? "text-green-400 hover:text-green-300 hover:bg-green-400/10"
                : "text-white/70 hover:text-white hover:bg-white/10"
            )}
            onClick={() => setIsEditing(!isEditing)}
            disabled={!!pendingEnhancement || isEnhancing}
          >
            {isEditing ? (
              <>
                <Check className="w-3.5 h-3.5 mr-1.5" />
                Done
              </>
            ) : (
              <>
                <Edit3 className="w-3.5 h-3.5 mr-1.5" />
                Edit
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div className="relative">
        <div
          ref={contentRef}
          className={cn(
            "overflow-auto",
            "scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent",
            type === "code" && "bg-[#0D0D0D]",
            // Edit mode: larger area, no max height constraint
            isEditing ? "min-h-[300px] max-h-[600px]" : "min-h-[150px] max-h-[500px]",
            (isEnhancing || pendingEnhancement) && "select-none"
          )}
          onMouseUp={!isEditing && !isEnhancing && !pendingEnhancement ? handleTextSelection : undefined}
          onSelect={!isEditing && !isEnhancing && !pendingEnhancement ? handleTextSelection : undefined}
        >
          {renderContent()}
        </div>

        {/* Enhancing loader - minimal and professional */}
        {isEnhancing && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-40">
            <div className="flex items-center gap-2.5 bg-[#1a1a1a]/95 border border-white/10 rounded-lg px-4 py-2.5 shadow-xl">
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              <span className="text-sm text-white/80 font-medium">Enhancing...</span>
            </div>
          </div>
        )}

        {/* Selection toolbar - refined design */}
        {selection && !showChangePrompt && !isEnhancing && !pendingEnhancement && (
          <div
            className="fixed bg-[#1a1a1a]/95 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl p-1.5 flex items-center gap-1 z-[9999] pointer-events-auto"
            style={{ top: selectionPos.top, left: selectionPos.left }}
            onClick={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs text-white/80 hover:text-white hover:bg-white/10 font-medium cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log("[Toolbar] Enhance button clicked");
                handleAskForChanges();
              }}
            >
              <Sparkles className="w-3 h-3 mr-1.5 text-blue-400" />
              Enhance
            </Button>
            <div className="w-px h-4 bg-white/10" />
            <span className="text-white/30 text-[10px] px-1.5 font-mono">⌘K</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-white/40 hover:text-white hover:bg-white/10 cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCloseSelection();
              }}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}

        {/* Change instruction input - refined */}
        {showChangePrompt && !isEnhancing && (
          <div
            className="fixed bg-[#1a1a1a]/95 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl p-3 z-[9999] w-72 pointer-events-auto"
            style={{ top: selectionPos.top, left: selectionPos.left }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs text-white/70 font-medium">Describe enhancement</span>
            </div>
            <textarea
              value={changeInstruction}
              onChange={(e) => setChangeInstruction(e.target.value)}
              placeholder="e.g., Make this more professional..."
              className="w-full h-16 bg-black/40 border border-white/10 rounded-md p-2.5 text-sm text-white/90 resize-none focus:outline-none focus:border-blue-500/50 placeholder:text-white/30 transition-colors"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSubmitChanges();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  handleCloseSelection();
                }
              }}
            />
            <div className="flex items-center justify-between mt-2.5">
              <span className="text-[10px] text-white/30 font-mono">⌘↵ to submit</span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2.5 text-xs text-white/60 hover:text-white cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCloseSelection();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-3 text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSubmitChanges();
                  }}
                  disabled={!changeInstruction.trim()}
                >
                  Enhance
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Subtle indicator for pending enhancement */}
      {pendingEnhancement && (
        <div className="px-4 py-2 border-t border-white/10 bg-gradient-to-r from-blue-500/5 via-transparent to-transparent">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-xs text-white/50">Review changes inline • ESC to undo • ⌘↵ to accept</span>
          </div>
        </div>
      )}

      {/* Footer with save option */}
      {onSave && filename && !pendingEnhancement && (
        <div className="px-4 py-2.5 border-t border-white/10 bg-gradient-to-r from-white/[0.03] to-transparent">
          <Button
            variant="outline"
            size="sm"
            className="w-full h-9 text-xs border-white/10 hover:bg-white/10 hover:border-white/20 transition-all"
            onClick={handleSave}
          >
            <Save className="w-3.5 h-3.5 mr-2" />
            Save to {filename}
          </Button>
        </div>
      )}
    </div>
  );
}
