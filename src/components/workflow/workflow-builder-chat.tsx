"use client";

import { appStore } from "@/app/store";
import { SelectModel } from "@/components/select-model";
import { useChatModels } from "@/hooks/queries/use-chat-models";
import { useWorkflowToolList } from "@/hooks/queries/use-workflow-tool-list";
import { UIMessage, useChat } from "@ai-sdk/react";
import { Edge } from "@xyflow/react";
import { DefaultChatTransport } from "ai";
import { ChatModel } from "app-types/chat";
import { motion } from "framer-motion";
import { getWorkflowErrorMessage } from "lib/ai/workflow/workflow-error-handler";
import { NodeKind, UINode } from "lib/ai/workflow/workflow.interface";
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CornerRightUpIcon,
  Loader2,
  Sparkles,
  Trash2,
  User,
  Workflow,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Textarea } from "ui/textarea";
import { NodeIcon } from "./node-icon";

interface WorkflowBuilderChatProps {
  onClose: () => void;
  workflowId: string;
  currentWorkflowState: { nodes: UINode[]; edges: Edge[] };
  onApply: (
    nodes: UINode[],
    edges: Edge[],
    action: "replace" | "append" | "update",
  ) => void;
}

// Type for tool result
interface WorkflowToolResult {
  success: boolean;
  action: "replace" | "append" | "update";
  nodes: UINode[];
  edges: Edge[];
  message: string;
  error?: string;
  validationWarnings?: string[];
}

// Storage keys for chat history and applied state
const getChatStorageKey = (workflowId: string) =>
  `workflow-builder-chat-${workflowId}`;
const getAppliedStorageKey = (workflowId: string) =>
  `workflow-builder-applied-${workflowId}`;

// Generic localStorage helpers to reduce duplication
function getLocalStorageItem<T>(key: string, defaultValue: T): T {
  if (typeof globalThis.window === "undefined") return defaultValue;
  try {
    const stored = globalThis.window.localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored) as T;
    }
  } catch (e) {
    console.error(`[WorkflowBuilder] Failed to load ${key}:`, e);
  }
  return defaultValue;
}

function setLocalStorageItem<T>(
  key: string,
  value: T,
  errorPrefix: string,
): void {
  if (typeof globalThis.window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`[WorkflowBuilder] Failed to save ${errorPrefix}:`, e);
  }
}

function removeLocalStorageItem(key: string, errorPrefix: string): void {
  if (typeof window === "undefined") return;
  try {
    globalThis.window.localStorage.removeItem(key);
  } catch (e) {
    console.error(`[WorkflowBuilder] Failed to clear ${errorPrefix}:`, e);
  }
}

// Load messages from localStorage - filter out incomplete assistant messages
function loadStoredMessages(workflowId: string): UIMessage[] {
  const messages = getLocalStorageItem<UIMessage[]>(
    getChatStorageKey(workflowId),
    [],
  );
  // Filter out assistant messages that have no useful content (stale/incomplete)
  const filtered = messages.filter((m: UIMessage) => {
    if (m.role !== "assistant") return true;
    // Check if assistant message has any content
    const hasText = m.parts?.some((p: any) => p.type === "text" && p.text);
    // AI SDK v5 uses type: "tool-{toolName}" format
    const hasTool = m.parts?.some(
      (p: any) =>
        p.type?.startsWith("tool-") || // AI SDK v5 format
        p.type === "tool-result" ||
        p.type === "tool-call" ||
        p.type === "tool-invocation" ||
        p.toolInvocation ||
        p.toolName,
    );
    return hasText || hasTool;
  });

  // CRITICAL: Clean up orphaned reasoning references
  // Messages stored in localStorage may have reasoningId references pointing to missing reasoning items
  // This causes errors when the AI SDK processes them
  // Handles both message-level reasoningId and function_call/tool-call parts with reasoningId
  return filtered.map((msg: any) => {
    // First, collect all valid reasoning IDs from parts
    const validReasoningIds = new Set<string>();
    if (msg.parts && Array.isArray(msg.parts)) {
      msg.parts.forEach((p: any) => {
        if (p.type === "reasoning" && p.reasoningId) {
          validReasoningIds.add(p.reasoningId);
        }
      });
    }

    // Remove reasoningId from message if it doesn't have a corresponding reasoning part
    let cleanedMsg = { ...msg };
    if (cleanedMsg.reasoningId && typeof cleanedMsg.reasoningId === "string") {
      if (!validReasoningIds.has(cleanedMsg.reasoningId)) {
        // Remove orphaned reasoning reference
        const { reasoningId, ...rest } = cleanedMsg;
        cleanedMsg = rest;
      }
    }

    // Clean up parts that reference non-existent reasoning items
    // This includes function_call, tool-call, and any other part types with reasoningId
    if (cleanedMsg.parts && Array.isArray(cleanedMsg.parts)) {
      const cleanedParts = cleanedMsg.parts.filter((p: any) => {
        // For reasoning parts, keep them if they have a valid reasoningId
        if (p.type === "reasoning") {
          return p.reasoningId && validReasoningIds.has(p.reasoningId);
        }

        // For all other parts (including function_call, tool-call, etc.),
        // check if they reference a reasoning ID that doesn't exist
        if (p.reasoningId && typeof p.reasoningId === "string") {
          // Only keep if the referenced reasoning exists
          return validReasoningIds.has(p.reasoningId);
        }

        // Keep parts without reasoningId references
        return true;
      });

      if (cleanedParts.length !== cleanedMsg.parts.length) {
        cleanedMsg = { ...cleanedMsg, parts: cleanedParts };
      }
    }

    return cleanedMsg;
  });
}

// Save messages to localStorage
function saveMessages(workflowId: string, messages: UIMessage[]): void {
  setLocalStorageItem(getChatStorageKey(workflowId), messages, "messages");
}

// Clear messages from localStorage
function clearStoredMessages(workflowId: string): void {
  removeLocalStorageItem(getChatStorageKey(workflowId), "messages");
}

// Load applied message IDs from localStorage
function loadAppliedIds(workflowId: string): Set<string> {
  const ids = getLocalStorageItem<string[]>(
    getAppliedStorageKey(workflowId),
    [],
  );
  return new Set(ids);
}

// Save applied message IDs to localStorage
function saveAppliedIds(workflowId: string, appliedIds: Set<string>): void {
  setLocalStorageItem(
    getAppliedStorageKey(workflowId),
    [...appliedIds],
    "applied IDs",
  );
}

// Clear applied IDs from localStorage
function clearAppliedIds(workflowId: string): void {
  removeLocalStorageItem(getAppliedStorageKey(workflowId), "applied IDs");
}

/**
 * Safely formats markdown text to HTML.
 * Only allows specific safe HTML elements to prevent XSS.
 */
function formatMarkdown(text: string): string {
  // First, escape any existing HTML to prevent XSS
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  return (
    escaped
      // Bold: **text** or __text__ - use bounded quantifier to prevent ReDoS
      .replaceAll(/\*\*([^*]{1,500})\*\*/g, "<strong>$1</strong>")
      .replaceAll(/__([^_]{1,500})__/g, "<strong>$1</strong>")
      // Italic: *text* or _text_ (but not within words)
      .replaceAll(/(?<!\w)\*([^*]{1,500})\*(?!\w)/g, "<em>$1</em>")
      .replaceAll(/(?<!\w)_([^_]{1,500})_(?!\w)/g, "<em>$1</em>")
      // Code: `code`
      .replace(
        /`([^`]{1,500})`/g,
        '<code class="bg-background/50 px-1 rounded text-[10px]">$1</code>',
      )
      // Bullet points: - item or * item at line start
      .replaceAll(/^[-*]\s{1,10}(.{1,500})$/gm, "<li>$1</li>")
      // Wrap consecutive <li> in <ul> - use bounded quantifier to prevent ReDoS
      .replace(
        /(<li>[^<]{0,1000}<\/li>(?:\s{0,10}<li>[^<]{0,1000}<\/li>){0,50})/g,
        '<ul class="list-disc pl-4">$1</ul>',
      )
      // Paragraph breaks (double newline)
      .replaceAll(/\n{2,10}/g, "</p><p>")
      // Single line breaks
      .replace(/\n/g, "<br/>")
      // Wrap in paragraph if not already
      .replace(/^(?!<)/, "<p>")
      .replace(/(?!>)$/, "</p>")
  );
}

// Map string kind to NodeKind enum
function getNodeKindEnum(kind: string): NodeKind {
  switch (kind) {
    case "input":
      return NodeKind.Input;
    case "output":
      return NodeKind.Output;
    case "llm":
      return NodeKind.LLM;
    case "tool":
      return NodeKind.Tool;
    case "condition":
      return NodeKind.Condition;
    case "http":
      return NodeKind.Http;
    case "template":
      return NodeKind.Template;
    case "code":
      return NodeKind.Code;
    case "note":
      return NodeKind.Note;
    default:
      return NodeKind.Tool;
  }
}

// Compact workflow preview component
function WorkflowPreview({ nodes, edges }: { nodes: UINode[]; edges: Edge[] }) {
  const [expanded, setExpanded] = useState(true);

  if (!nodes || nodes.length === 0) return null;

  const sortedNodes = [...nodes].sort(
    (a, b) => (a?.position?.x ?? 0) - (b?.position?.x ?? 0),
  );

  return (
    <div className="rounded border border-border/50 bg-background/50 overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-muted/50 transition-colors"
      >
        <Workflow className="size-3 text-muted-foreground" />
        <span className="font-medium flex-1 text-left">Preview</span>
        <Badge variant="secondary" className="text-[9px] h-4 px-1">
          {nodes.length}
        </Badge>
        {expanded ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {sortedNodes.map((node, idx) => (
            <div
              key={node.id}
              className="flex items-center gap-1.5 py-1 px-1.5 rounded bg-muted/30"
            >
              <span className="text-[9px] text-muted-foreground w-3">
                {idx + 1}
              </span>
              <NodeIcon
                type={getNodeKindEnum(node.data.kind)}
                className="size-5 shrink-0"
                iconClassName="size-3"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate text-[11px]">
                  {node.data.name}
                </div>
              </div>
            </div>
          ))}
          {edges.length > 0 && (
            <div className="text-[9px] text-muted-foreground text-center pt-1 border-t border-border/30">
              {edges.length} connections
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkflowBuilderChat({
  onClose,
  workflowId,
  currentWorkflowState,
  onApply,
}: WorkflowBuilderChatProps) {
  // isValidating is true during initial fetch even with fallbackData
  const {
    data: tools,
    isLoading: toolsLoading,
    isValidating,
  } = useWorkflowToolList();

  // Wait for initial fetch to complete (isValidating covers the case where fallbackData makes isLoading false)
  const isInitialLoading =
    toolsLoading || (isValidating && (!tools || tools.length === 0));

  if (isInitialLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="w-sm h-[85vh] bg-card border rounded-lg shadow-lg flex flex-col items-center justify-center"
      >
        <Loader2 className="size-5 animate-spin text-primary mb-2" />
        <div className="text-muted-foreground text-xs">Loading tools...</div>
      </motion.div>
    );
  }

  return (
    <WorkflowBuilderChatInner
      onClose={onClose}
      workflowId={workflowId}
      currentWorkflowState={currentWorkflowState}
      onApply={onApply}
      tools={tools ?? []}
    />
  );
}

function WorkflowBuilderChatInner({
  onClose,
  workflowId,
  currentWorkflowState,
  onApply,
  tools,
}: WorkflowBuilderChatProps & { tools: any[] }) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [appliedIds, setAppliedIds] = useState<Set<string>>(() =>
    loadAppliedIds(workflowId),
  );

  const storedModel = appStore.getState().chatModel;
  const [generateModel, setGenerateModel] = useState<ChatModel>(
    storedModel || { model: "gemini-3-flash-preview", provider: "google" },
  );

  // Fetch available models for pre-validation
  const { data: providers } = useChatModels();

  // Clean messages callback to remove orphaned reasoning references
  // MUST be defined before transport useMemo
  // Handles both message-level reasoningId and function_call/tool-call parts with reasoningId
  const cleanMessages = useCallback((msgs: UIMessage[]): UIMessage[] => {
    return msgs.map((msg: any) => {
      // First, collect all valid reasoning IDs from parts and nested structures
      const validReasoningIds = new Set<string>();
      if (msg.parts && Array.isArray(msg.parts)) {
        msg.parts.forEach((p: any) => {
          // Collect reasoning IDs from reasoning parts
          if (p.type === "reasoning" && p.reasoningId) {
            validReasoningIds.add(p.reasoningId);
          }
          // Also check for reasoning IDs in nested structures (function_call, tool-call, etc.)
          if (p.reasoningId && typeof p.reasoningId === "string") {
            // Don't add it yet - we'll validate it exists elsewhere
          }
        });
      }

      // Second pass: collect reasoning IDs from all parts (including function_call, tool-call, etc.)
      if (msg.parts && Array.isArray(msg.parts)) {
        msg.parts.forEach((p: any) => {
          if (p.type === "reasoning" && p.reasoningId) {
            validReasoningIds.add(p.reasoningId);
          }
        });
      }

      // Remove reasoningId from message if it doesn't have a corresponding reasoning part
      let cleanedMsg = { ...msg };
      if (
        cleanedMsg.reasoningId &&
        typeof cleanedMsg.reasoningId === "string"
      ) {
        if (!validReasoningIds.has(cleanedMsg.reasoningId)) {
          // Remove orphaned reasoning reference
          const { reasoningId, ...rest } = cleanedMsg;
          cleanedMsg = rest;
        }
      }

      // Clean up parts that reference non-existent reasoning items
      // This includes function_call, tool-call, and any other part types with reasoningId
      if (cleanedMsg.parts && Array.isArray(cleanedMsg.parts)) {
        const cleanedParts = cleanedMsg.parts.filter((p: any) => {
          // For reasoning parts, keep them if they have a valid reasoningId
          if (p.type === "reasoning") {
            return p.reasoningId && validReasoningIds.has(p.reasoningId);
          }

          // For all other parts (including function_call, tool-call, etc.),
          // check if they reference a reasoning ID that doesn't exist
          if (p.reasoningId && typeof p.reasoningId === "string") {
            // Only keep if the referenced reasoning exists
            return validReasoningIds.has(p.reasoningId);
          }

          // Keep parts without reasoningId references
          return true;
        });

        if (cleanedParts.length !== cleanedMsg.parts.length) {
          cleanedMsg = { ...cleanedMsg, parts: cleanedParts };
        }
      }

      return cleanedMsg;
    });
  }, []);

  // Create a custom transport that intercepts and cleans stream responses
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/workflow/generate",
        body: {
          availableTools: tools,
          currentWorkflowState,
          chatModel: generateModel,
        },
        // CRITICAL: Clean messages before sending to prevent reasoning errors
        prepareSendMessagesRequest: ({ messages }) => {
          // Clean all messages before sending to API
          const cleanedMessages = cleanMessages(messages);
          return {
            body: {
              availableTools: tools,
              currentWorkflowState,
              chatModel: generateModel,
              messages: cleanedMessages,
            },
          };
        },
      }),
    [tools, currentWorkflowState, generateModel, cleanMessages],
  );

  // CRITICAL: Clean localStorage messages BEFORE useChat loads them
  // useChat loads messages synchronously from localStorage based on the id prop
  // Strategy: Clear localStorage if orphaned reasoning detected, start fresh
  const chatId = `workflow-builder-${workflowId}`;
  const storageKey = getChatStorageKey(workflowId);

  // CRITICAL: Clean localStorage messages BEFORE useChat loads them
  // useChat loads messages synchronously from localStorage based on the id prop
  // We must clean them before the hook initializes to prevent reasoning errors
  // Use a ref to track if we've checked for this workflowId
  const checkedRef = useRef<string | null>(null);
  let cleanedInitialMessages: UIMessage[] = [];

  // Clean messages synchronously before useChat initializes
  if (checkedRef.current !== workflowId && typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const storedMessages = JSON.parse(stored) as UIMessage[];

        // Always clean messages
        cleanedInitialMessages = loadStoredMessages(workflowId); // This function cleans messages

        // CRITICAL: Update localStorage with cleaned messages BEFORE useChat loads them
        // This prevents useChat from loading dirty messages
        if (
          JSON.stringify(cleanedInitialMessages) !==
          JSON.stringify(storedMessages)
        ) {
          localStorage.setItem(
            storageKey,
            JSON.stringify(cleanedInitialMessages),
          );
          console.log(
            `[WorkflowBuilder] Cleaned and updated messages in localStorage for workflow ${workflowId}`,
          );
        }
      }
      checkedRef.current = workflowId;
    } catch {
      // On any error, try to load cleaned messages anyway
      try {
        cleanedInitialMessages = loadStoredMessages(workflowId);
        // Update localStorage even on error to ensure it's clean
        if (cleanedInitialMessages.length > 0) {
          localStorage.setItem(
            storageKey,
            JSON.stringify(cleanedInitialMessages),
          );
        }
      } catch {
        // If that fails, clear localStorage to prevent errors
        try {
          localStorage.removeItem(storageKey);
        } catch {
          // Ignore
        }
        cleanedInitialMessages = [];
      }
      checkedRef.current = workflowId;
    }
  } else if (
    checkedRef.current === workflowId &&
    typeof window !== "undefined"
  ) {
    // If we've already checked, load cleaned messages
    try {
      cleanedInitialMessages = loadStoredMessages(workflowId);
    } catch {
      cleanedInitialMessages = [];
    }
  }

  // Wrap setMessages to always clean messages before setting them
  const setMessagesRef = useRef<
    | ((messages: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])) => void)
    | null
  >(null);

  const {
    messages,
    sendMessage,
    status,
    stop,
    setMessages: originalSetMessages,
  } = useChat({
    id: chatId,
    transport,
    // CRITICAL: Clean messages after they're received from the stream
    // This prevents orphaned reasoning references from causing errors
    onFinish: (message) => {
      if (
        message &&
        typeof message === "object" &&
        "id" in message &&
        "role" in message &&
        "parts" in message
      ) {
        // Clean the message before it's added to the messages array
        const cleaned = cleanMessages([message as UIMessage]);
        if (cleaned.length > 0 && cleaned[0] !== message) {
          // Replace the message with cleaned version
          originalSetMessages((prev) => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            if (
              lastIndex >= 0 &&
              updated[lastIndex].id === (message as UIMessage).id
            ) {
              updated[lastIndex] = cleaned[0];
            }
            return updated;
          });
        }
      }
    },
    onError: (error) => {
      console.error("[WorkflowBuilder] Error:", error);
      console.error("[WorkflowBuilder] Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // CRITICAL: If this is a reasoning error (for message or function_call items), clean localStorage and reload messages
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes(
          "was provided without its required 'reasoning' item",
        ) ||
        (errorMessage.includes("function_call") &&
          errorMessage.includes("reasoning"))
      ) {
        console.warn(
          "[WorkflowBuilder] Reasoning error detected - cleaning localStorage and reloading messages",
        );

        // Clean localStorage messages and reload them
        if (typeof window !== "undefined") {
          try {
            const cleaned = loadStoredMessages(workflowId); // Clean messages

            // Update localStorage with cleaned messages
            if (cleaned.length > 0) {
              localStorage.setItem(storageKey, JSON.stringify(cleaned));

              // Reload messages from cleaned localStorage
              requestAnimationFrame(() => {
                originalSetMessages(cleaned);
                console.log(
                  `[WorkflowBuilder] Reloaded ${cleaned.length} cleaned messages from localStorage`,
                );
              });
            } else {
              // No cleaned messages, clear localStorage and reset
              try {
                localStorage.removeItem(storageKey);
              } catch {
                // Ignore
              }
              requestAnimationFrame(() => {
                originalSetMessages([]);
              });
            }
          } catch (e) {
            console.error("[WorkflowBuilder] Failed to clean localStorage:", e);
            // Fallback: clear localStorage and reset messages
            try {
              localStorage.removeItem(storageKey);
              requestAnimationFrame(() => {
                originalSetMessages([]);
              });
            } catch {
              // Ignore
            }
          }
        }

        // Reset checked ref so we'll clean again on next render
        checkedRef.current = null;

        // Don't show error toast for reasoning errors - we're handling it automatically
        return;
      }

      // Use shared error handling utility
      toast.error(getWorkflowErrorMessage(error));
    },
  });

  // Store the original setMessages for use in effects
  useEffect(() => {
    setMessagesRef.current = originalSetMessages;
  }, [originalSetMessages]);

  // Wrapped setMessages that always cleans messages before setting
  const setMessages = useCallback(
    (messagesOrUpdater: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])) => {
      if (typeof messagesOrUpdater === "function") {
        originalSetMessages((prev) => {
          const updated = messagesOrUpdater(prev);
          return cleanMessages(updated);
        });
      } else {
        originalSetMessages(cleanMessages(messagesOrUpdater));
      }
    },
    [originalSetMessages, cleanMessages],
  );

  // CRITICAL: Clean messages whenever they change to prevent reasoning errors
  // This ensures messages are always clean before being processed by the AI SDK
  const messagesRef = useRef<string>("");
  useEffect(() => {
    if (messages.length > 0 && hasLoadedRef.current && setMessagesRef.current) {
      const cleaned = cleanMessages(messages);
      // Create a simple hash to detect changes
      const messagesHash = JSON.stringify(
        messages.map((m) => ({
          id: m.id,
          reasoningId: (m as any).reasoningId,
          partsCount: m.parts?.length || 0,
        })),
      );

      // Only update if messages have changed and cleaning actually changed something
      if (messagesHash !== messagesRef.current) {
        const needsUpdate = cleaned.some((msg, idx) => {
          const original = messages[idx];
          if (!original) return true;
          // Compare reasoningId
          if ((original as any).reasoningId !== (msg as any).reasoningId)
            return true;
          // Compare parts length
          if ((original.parts?.length || 0) !== (msg.parts?.length || 0))
            return true;
          return false;
        });

        if (needsUpdate) {
          messagesRef.current = JSON.stringify(
            cleaned.map((m) => ({
              id: m.id,
              reasoningId: (m as any).reasoningId,
              partsCount: m.parts?.length || 0,
            })),
          );
          setMessagesRef.current(cleaned);
        } else {
          messagesRef.current = messagesHash;
        }
      }
    }
  }, [messages, cleanMessages]);

  // CRITICAL: Clean localStorage messages BEFORE useChat loads them
  // useChat loads messages from localStorage internally based on the id prop
  // We need to clean them before the hook initializes
  useEffect(() => {
    const storedMessages = getLocalStorageItem<UIMessage[]>(
      getChatStorageKey(workflowId),
      [],
    );
    if (storedMessages.length > 0) {
      // Clean messages and save them back to localStorage immediately
      // This ensures useChat loads clean messages
      const cleaned = loadStoredMessages(workflowId); // This function already cleans
      if (JSON.stringify(cleaned) !== JSON.stringify(storedMessages)) {
        saveMessages(workflowId, cleaned);
      }
    }
  }, [workflowId]);

  // Load stored messages on mount (after cleaning localStorage)
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      // Messages are already cleaned and provided via initialMessages
      // Just ensure localStorage is updated with cleaned version
      if (typeof window !== "undefined") {
        try {
          const cleaned = loadStoredMessages(workflowId);
          if (cleaned.length > 0) {
            localStorage.setItem(storageKey, JSON.stringify(cleaned));
          }
        } catch {
          // Ignore errors
        }
      }
    }
  }, [workflowId, storageKey]);

  // Clean messages before saving to prevent storing orphaned reasoning references
  const cleanMessagesForStorage = useCallback(
    (msgs: UIMessage[]): UIMessage[] => {
      return msgs.map((msg: any) => {
        // Remove reasoningId if reasoning item doesn't exist
        if (msg.reasoningId && typeof msg.reasoningId === "string") {
          const hasReasoningItem = msg.parts?.some(
            (p: any) =>
              p.type === "reasoning" && p.reasoningId === msg.reasoningId,
          );
          if (!hasReasoningItem) {
            const { reasoningId, ...cleanedMsg } = msg;
            return cleanedMsg;
          }
        }
        // Clean up parts that reference non-existent reasoning items
        if (msg.parts && Array.isArray(msg.parts)) {
          const reasoningIds = new Set<string>();
          msg.parts.forEach((p: any) => {
            if (p.type === "reasoning" && p.reasoningId) {
              reasoningIds.add(p.reasoningId);
            }
          });
          const cleanedParts = msg.parts.filter((p: any) => {
            if (p.reasoningId && typeof p.reasoningId === "string") {
              return reasoningIds.has(p.reasoningId);
            }
            return true;
          });
          if (cleanedParts.length !== msg.parts.length) {
            return { ...msg, parts: cleanedParts };
          }
        }
        return msg;
      });
    },
    [],
  );

  // Save messages to localStorage when they change (after cleaning)
  useEffect(() => {
    if (messages.length > 0 && hasLoadedRef.current) {
      const cleaned = cleanMessagesForStorage(messages);
      saveMessages(workflowId, cleaned);
    }
  }, [messages, workflowId, cleanMessagesForStorage]);

  // Save appliedIds to localStorage when they change
  useEffect(() => {
    if (appliedIds.size > 0) {
      saveAppliedIds(workflowId, appliedIds);
    }
  }, [appliedIds, workflowId]);

  const isLoading = status === "streaming" || status === "submitted";

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isLoading) return;

      // Pre-validate model for workflow generation
      if (providers) {
        const providerModels = providers.find(
          (p) => p.provider === generateModel.provider,
        );
        const modelInfo = providerModels?.models.find(
          (m) => m.name === generateModel.model,
        );

        if (modelInfo?.workflowGenerationSupport === "none") {
          let reason = "is not compatible with workflow generation";
          if (modelInfo.toolCallUnsupportedReason === "reasoning-model") {
            reason = "is a reasoning model that cannot use tools";
          } else if (modelInfo.toolCallUnsupportedReason === "built-in-tools") {
            reason =
              "has built-in tools that conflict with workflow generation";
          }

          toast.error(`${generateModel.model} ${reason}`, {
            description: "Select a different model for workflow generation",
            action: {
              label: "Use Gemini Flash",
              onClick: () =>
                setGenerateModel({
                  model: "gemini-3-flash-preview",
                  provider: "google",
                }),
            },
          });
          return;
        }
      }

      sendMessage({ role: "user", parts: [{ type: "text", text: input }] });
      setInput("");
    },
    [input, isLoading, sendMessage, providers, generateModel, setGenerateModel],
  );

  const handleApply = useCallback(
    (result: WorkflowToolResult, messageId: string) => {
      if (!result?.nodes) {
        console.warn(
          "[WorkflowBuilder] Attempted to apply workflow with no nodes",
        );
        return;
      }
      console.log(
        `[WorkflowBuilder] Applying workflow: ${result.nodes.length} nodes, ${result.edges?.length || 0} edges`,
      );
      if (result.validationWarnings && result.validationWarnings.length > 0) {
        console.warn(
          "[WorkflowBuilder] Applying workflow with validation warnings:",
          result.validationWarnings,
        );
      }
      onApply(result.nodes, result.edges || [], result.action);
      setAppliedIds((prev) => new Set([...prev, messageId]));
      toast.success(result.message || "Workflow applied!");
    },
    [onApply],
  );

  const handleClearChat = useCallback(() => {
    setMessages([]);
    clearStoredMessages(workflowId);
    setAppliedIds(new Set());
    clearAppliedIds(workflowId);
    toolResultCache.current.clear(); // Clear cache when chat is cleared
    toast.success("Chat cleared");
  }, [setMessages, workflowId]);

  // Clear cache for removed messages
  useEffect(() => {
    const messageIds = new Set(messages.map((m) => m.id));
    // Remove cache entries for messages that no longer exist
    for (const [cachedId] of toolResultCache.current) {
      if (!messageIds.has(cachedId)) {
        toolResultCache.current.delete(cachedId);
      }
    }
  }, [messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Memoize tool results per message to prevent recalculation
  const toolResultCache = useRef<
    Map<string, { state: string; result?: WorkflowToolResult } | null>
  >(new Map());

  // Extract tool result from message parts
  // AI SDK v6 uses type: "tool-invocation" with toolName and state properties
  // OR type: "tool-{toolName}" format
  // Memoized to prevent unnecessary recalculations
  const getToolResult = useCallback(
    (
      parts: any[],
      messageId?: string,
    ): { state: string; result?: WorkflowToolResult } | null => {
      // Use cache if messageId provided and parts haven't changed
      if (messageId && toolResultCache.current.has(messageId)) {
        const cached = toolResultCache.current.get(messageId);
        if (cached) {
          // Verify parts haven't changed by checking if output exists
          const hasOutput = parts?.some((p: any) => p.output !== undefined);
          const cachedHasOutput = cached.result !== undefined;
          if (hasOutput === cachedHasOutput) {
            return cached;
          }
        }
      }
      if (!parts || !Array.isArray(parts)) {
        return null;
      }

      for (const part of parts) {
        // Check for tool-update_workflow_graph format (type: "tool-{toolName}")
        if (part.type === "tool-update_workflow_graph") {
          const output = part.output?.value || part.output;
          const isOutputReady =
            part.state === "output-available" ||
            part.state?.startsWith("output") ||
            part.state === "result" ||
            output !== undefined;

          if (isOutputReady && output) {
            const result = { state: "result" as const, result: output };
            if (messageId) {
              toolResultCache.current.set(messageId, result);
            }
            return result;
          }
          const result = { state: "call" as const, result: undefined };
          if (messageId) {
            toolResultCache.current.set(messageId, result);
          }
          return result;
        }

        // AI SDK v6 format: type is "tool-invocation" with toolName property
        // Check for update_workflow_graph tool specifically
        if (
          part.type === "tool-invocation" &&
          part.toolName === "update_workflow_graph"
        ) {
          // Check for output - AI SDK v6 may wrap in .value or have directly
          const output = part.output?.value || part.output;

          // Check state - various states indicate output is ready
          const isOutputReady =
            part.state === "output-available" ||
            part.state?.startsWith("output") ||
            part.state === "result" ||
            output !== undefined;

          if (isOutputReady && output) {
            const result = { state: "result" as const, result: output };
            if (messageId) {
              toolResultCache.current.set(messageId, result);
            }
            return result;
          }

          // "input-streaming" or "input-available" means still processing
          if (
            part.state === "input-streaming" ||
            part.state === "input-available" ||
            part.state === "call" ||
            part.state === "partial-call"
          ) {
            const result = { state: "call" as const, result: undefined };
            if (messageId) {
              toolResultCache.current.set(messageId, result);
            }
            return result;
          }

          // If we have a tool part but no output yet, it's still in call state
          const result = { state: "call" as const, result: undefined };
          if (messageId) {
            toolResultCache.current.set(messageId, result);
          }
          return result;
        }

        // Also check for tool-invocation without toolName check (fallback)
        if (part.type === "tool-invocation") {
          const result = part.result || part.output?.value || part.output;
          const state =
            part.state === "output-available" ||
            part.state?.startsWith("output") ||
            result
              ? "result"
              : "call";
          // Only return if we have a result and it's our tool
          if (
            state === "result" &&
            result &&
            part.toolName === "update_workflow_graph"
          ) {
            const toolResult = { state, result };
            if (messageId) {
              toolResultCache.current.set(messageId, toolResult);
            }
            return toolResult;
          }
          const callResult = { state: "call" as const, result: undefined };
          if (messageId) {
            toolResultCache.current.set(messageId, callResult);
          }
          return callResult;
        }

        // Check for type starting with "tool-" (legacy or alternative format)
        if (part.type?.startsWith("tool-")) {
          const toolName = part.type.replace("tool-", "");
          if (toolName === "update_workflow_graph") {
            const output = part.output?.value || part.output;
            const isOutputReady =
              part.state === "output-available" ||
              part.state?.startsWith("output") ||
              part.state === "result" ||
              output !== undefined;

            if (isOutputReady && output) {
              const result = { state: "result" as const, result: output };
              if (messageId) {
                toolResultCache.current.set(messageId, result);
              }
              return result;
            }
            const result = { state: "call" as const, result: undefined };
            if (messageId) {
              toolResultCache.current.set(messageId, result);
            }
            return result;
          }
        }

        // Legacy formats for backwards compatibility
        if (part.type === "tool-result") {
          const result = { state: "result" as const, result: part.result };
          if (messageId) {
            toolResultCache.current.set(messageId, result);
          }
          return result;
        }
        if (part.type === "tool-call") {
          const result = { state: "call" as const, result: undefined };
          if (messageId) {
            toolResultCache.current.set(messageId, result);
          }
          return result;
        }
        if (part.toolInvocation) {
          const result =
            part.toolInvocation.result ||
            part.toolInvocation.output?.value ||
            part.toolInvocation.output;
          const state =
            part.toolInvocation.state === "output-available" ||
            part.toolInvocation.state?.startsWith("output") ||
            result
              ? "result"
              : "call";
          const toolResult = { state, result };
          if (messageId) {
            toolResultCache.current.set(messageId, toolResult);
          }
          return toolResult;
        }
        if (part.toolName === "update_workflow_graph" || part.toolCallId) {
          if (part.result !== undefined || part.output !== undefined) {
            const output = part.output?.value || part.output;
            const result = {
              state: "result" as const,
              result: part.result || output,
            };
            if (messageId) {
              toolResultCache.current.set(messageId, result);
            }
            return result;
          }
          const result = { state: "call" as const, result: undefined };
          if (messageId) {
            toolResultCache.current.set(messageId, result);
          }
          return result;
        }
      }

      const result = null;
      if (messageId) {
        toolResultCache.current.set(messageId, result);
      }
      return result;
    },
    [],
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="w-sm h-[85vh] bg-card border rounded-lg shadow-lg flex flex-col"
    >
      {/* Header - fixed at top */}
      <div className="flex-none flex items-center justify-between px-3 py-2 border-b bg-card">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="font-semibold text-sm">Workflow Builder</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleClearChat}
              title="Clear chat"
            >
              <Trash2 className="size-3.5 text-muted-foreground" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages - scrollable area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0">
        <div className="p-3 space-y-3">
          {/* Empty state */}
          {messages.length === 0 && !isLoading && (
            <div className="text-center py-6 space-y-3">
              <Bot className="size-8 mx-auto text-muted-foreground/50" />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Hi! I'm your workflow assistant
                </p>
                <p className="text-xs text-muted-foreground">
                  Tell me what you want to automate and I'll help you build it
                </p>
              </div>
              <div className="text-[10px] text-muted-foreground/70 space-y-0.5">
                <p>Try: "Summarize my recent emails"</p>
                <p>Or: "Create a draft response workflow"</p>
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((m) => {
            const toolInfo =
              m.role === "assistant" ? getToolResult(m.parts, m.id) : null;

            const userText =
              m.role === "user"
                ? (
                    m.parts?.find((p: any) => p.type === "text") as {
                      text?: string;
                    }
                  )?.text || ""
                : "";

            return (
              <div key={m.id} className="space-y-2">
                {/* User message */}
                {m.role === "user" && userText && (
                  <div className="flex justify-end">
                    <div className="flex items-start gap-2 max-w-[90%]">
                      <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-xs">
                        {userText}
                      </div>
                      <div className="size-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                        <User className="size-3 text-primary-foreground" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Assistant message */}
                {m.role === "assistant" &&
                  (() => {
                    // Check if this message is currently streaming
                    const isCurrentlyStreaming =
                      isLoading && messages[messages.length - 1]?.id === m.id;
                    // Get text content from parts
                    const textContent =
                      m.parts
                        ?.filter((p: any) => p.type === "text" && p.text)
                        .map((p: any) => p.text)
                        .join("") || "";
                    const hasTextContent = textContent.length > 0;
                    // Check if workflow is complete (tool result available)
                    const isComplete =
                      toolInfo &&
                      (toolInfo.state === "result" ||
                        toolInfo.state === "output-available");

                    return (
                      <div className="flex justify-start">
                        <div className="flex items-start gap-2 max-w-[95%]">
                          <div className="size-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <Bot className="size-3" />
                          </div>
                          <div className="bg-muted rounded-lg px-3 py-2 space-y-2 min-w-[200px]">
                            {/* Text content - collapsible after completion */}
                            {hasTextContent &&
                              (isComplete ? (
                                // Collapsed thinking after workflow is ready
                                <details className="group">
                                  <summary className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors list-none">
                                    <ChevronRight className="size-3 group-open:rotate-90 transition-transform" />
                                    <span>AI Thinking</span>
                                  </summary>
                                  <div
                                    className="text-xs prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ul]:pl-4 [&>ul>li]:my-0.5 mt-2 pt-2 border-t border-border/50"
                                    dangerouslySetInnerHTML={{
                                      __html: formatMarkdown(textContent),
                                    }}
                                  />
                                </details>
                              ) : (
                                // Show text normally while streaming
                                <div
                                  className="text-xs prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ul]:pl-4 [&>ul>li]:my-0.5"
                                  dangerouslySetInnerHTML={{
                                    __html: formatMarkdown(textContent),
                                  }}
                                />
                              ))}

                            {/* Show streaming indicator alongside text */}
                            {isCurrentlyStreaming &&
                              hasTextContent &&
                              !toolInfo && (
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                                  <Loader2 className="size-2.5 animate-spin" />
                                  <span>typing...</span>
                                </div>
                              )}

                            {/* Building status - only when tool is being called */}
                            {toolInfo &&
                              toolInfo.state !== "result" &&
                              toolInfo.state !== "output-available" && (
                                <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                                  <Loader2 className="size-3 animate-spin" />
                                  <span>Building workflow...</span>
                                </div>
                              )}

                            {/* Completed status */}
                            {toolInfo &&
                              (toolInfo.state === "result" ||
                                toolInfo.state === "output-available") && (
                                <>
                                  <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                                    <CheckCircle2 className="size-3" />
                                    <span>Workflow ready!</span>
                                  </div>

                                  {/* Preview */}
                                  {toolInfo.result?.nodes && (
                                    <WorkflowPreview
                                      nodes={toolInfo.result.nodes}
                                      edges={toolInfo.result.edges || []}
                                    />
                                  )}

                                  {/* Apply button */}
                                  {toolInfo.result?.nodes && (
                                    <div className="pt-1">
                                      {appliedIds.has(m.id) ? (
                                        <div className="flex items-center justify-center gap-1 text-green-600 dark:text-green-400 text-xs py-1.5">
                                          <Check className="size-3" />
                                          <span>Applied!</span>
                                        </div>
                                      ) : (
                                        <Button
                                          size="sm"
                                          className="w-full h-7 text-xs"
                                          onClick={() =>
                                            handleApply(toolInfo.result!, m.id)
                                          }
                                        >
                                          <Sparkles className="size-3 mr-1" />
                                          Apply to Canvas
                                        </Button>
                                      )}
                                    </div>
                                  )}

                                  {/* Validation Warnings */}
                                  {toolInfo.result?.success &&
                                    toolInfo.result?.validationWarnings &&
                                    toolInfo.result.validationWarnings.length >
                                      0 && (
                                      <div className="space-y-1 pt-1 border-t border-border/50">
                                        <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                          ⚠️ Validation Warnings:
                                        </div>
                                        <ul className="text-[10px] text-amber-600 dark:text-amber-400 space-y-0.5 list-disc list-inside">
                                          {toolInfo.result.validationWarnings
                                            .slice(0, 5)
                                            .map((warning) => (
                                              <li key={warning}>{warning}</li>
                                            ))}
                                          {toolInfo.result.validationWarnings
                                            .length > 5 && (
                                            <li className="text-muted-foreground">
                                              ...and{" "}
                                              {toolInfo.result
                                                .validationWarnings.length -
                                                5}{" "}
                                              more
                                            </li>
                                          )}
                                        </ul>
                                      </div>
                                    )}

                                  {/* Error */}
                                  {toolInfo.result &&
                                    !toolInfo.result.success && (
                                      <div className="text-xs text-destructive space-y-1">
                                        <div className="font-medium">
                                          {toolInfo.result.message ||
                                            "Failed to build workflow. Please try again."}
                                        </div>
                                        {toolInfo.result.error && (
                                          <div className="text-[10px] text-muted-foreground">
                                            {toolInfo.result.error}
                                          </div>
                                        )}
                                        {toolInfo.result.validationWarnings &&
                                          toolInfo.result.validationWarnings
                                            .length > 0 && (
                                            <div className="text-[10px] space-y-0.5">
                                              <div className="font-medium">
                                                Issues found:
                                              </div>
                                              <ul className="list-disc list-inside space-y-0.5">
                                                {toolInfo.result.validationWarnings
                                                  .slice(0, 3)
                                                  .map((warning) => (
                                                    <li key={warning}>
                                                      {warning}
                                                    </li>
                                                  ))}
                                              </ul>
                                            </div>
                                          )}
                                      </div>
                                    )}
                                </>
                              )}

                            {/* Tool call in progress but streaming stopped - possible error */}
                            {toolInfo &&
                              toolInfo.state === "call" &&
                              !isCurrentlyStreaming && (
                                <div className="text-xs text-amber-600 dark:text-amber-400">
                                  <span>
                                    Workflow generation may have timed out. Try
                                    again with a simpler request.
                                  </span>
                                </div>
                              )}

                            {/* No content yet - show waiting indicator or error */}
                            {!hasTextContent &&
                              !toolInfo &&
                              (isCurrentlyStreaming ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="size-3 animate-spin" />
                                  <span>Building workflow...</span>
                                </div>
                              ) : (
                                // Not streaming and no content - this is a stale/failed message
                                <div className="text-xs text-muted-foreground">
                                  <span className="text-amber-600">
                                    No response received. Try sending your
                                    message again.
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
              </div>
            );
          })}

          {/* Show loading for new assistant response - waiting for first token */}
          {isLoading &&
            messages.length > 0 &&
            messages[messages.length - 1]?.role === "user" && (
              <div className="flex justify-start">
                <div className="flex items-start gap-2">
                  <div className="size-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <Bot className="size-3" />
                  </div>
                  <div className="bg-muted rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
        </div>
      </div>

      {/* Input - fixed at bottom */}
      <div className="flex-none p-3 border-t bg-card">
        <form onSubmit={handleSubmit} className="space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What would you like to automate?"
            disabled={isLoading}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            className="text-xs resize-none min-h-[50px]"
          />
          <div className="flex items-center justify-between gap-2">
            <SelectModel
              showProvider
              onSelect={setGenerateModel}
              currentModel={generateModel}
            />
            {isLoading ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={stop}
                className="h-7 text-xs px-2"
              >
                <X className="size-3 mr-1" />
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!input.trim()}
                size="sm"
                className="h-7 text-xs px-2"
              >
                Build
                <CornerRightUpIcon className="size-3 ml-1" />
              </Button>
            )}
          </div>
        </form>
      </div>
    </motion.div>
  );
}

export default WorkflowBuilderChat;
