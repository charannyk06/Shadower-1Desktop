"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import type {
  ACPSession,
  ACPMessageChunk,
  ACPPermissionRequest,
} from "@/types/acp";
import {
  createACPSession,
  sendACPPrompt,
  cancelACPPrompt,
  startACPAgent,
  setACPSessionModel,
  setACPSessionConfigOption,
  setACPSessionMode,
  onACPMessageChunk,
  onACPPermissionRequest,
  onACPAgentError,
} from "@/lib/electron/acp-api";
import { generateUUID } from "lib/utils";
import { getActiveWorkingDirectory } from "@/app/store";

interface UseACPChatOptions {
  threadId: string;
  agentId: string;
  onFinish?: (message: UIMessage) => void;
  onError?: (error: Error) => void;
  onUserMessage?: (message: UIMessage) => void;
}

interface UseACPChatReturn {
  messages: UIMessage[];
  status: "initializing" | "ready" | "streaming" | "error";
  error: Error | null;
  session: ACPSession | null;
  pendingPermission: ACPPermissionRequest | null;
  sendMessage: (content: string) => Promise<void>;
  stop: () => void;
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  respondToPermission: (optionId: string, rememberGlobally?: boolean) => void;
  setSessionModel: (modelId: string) => Promise<void>;
  setSessionConfigOption: (configId: string, value: string) => Promise<void>;
  setSessionMode: (modeId: string) => Promise<void>;
}

/**
 * Helper to process a single chunk and update messages state
 * Returns the updated message if it's an assistant message that should be tracked
 */
function processChunkIntoMessages(
  chunk: ACPMessageChunk,
  currentMessageIdRef: React.MutableRefObject<string | null>,
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>,
  onMessageUpdate: (message: UIMessage) => void
): void {
  if (chunk.type === "text") {
    setMessages((prev) => {
      const lastMessage = prev[prev.length - 1];
      const textContent = typeof chunk.content === "string" ? chunk.content : "";

      // Ignore empty text chunks to avoid creating blank messages
      if (!textContent) {
        return prev;
      }

      if (
        lastMessage?.role === "assistant" &&
        lastMessage.id === currentMessageIdRef.current
      ) {
        // Append to existing message
        const textPart = lastMessage.parts.find((p) => p.type === "text");
        if (textPart && "text" in textPart) {
          const updatedMessage: UIMessage = {
            ...lastMessage,
            parts: lastMessage.parts.map((p) =>
              p.type === "text" && "text" in p
                ? { ...p, text: p.text + textContent }
                : p
            ),
          };
          // Notify about the updated message for ref tracking
          onMessageUpdate(updatedMessage);
          return [...prev.slice(0, -1), updatedMessage];
        }
      }

      // Create new message
      const newMessageId = generateUUID();
      currentMessageIdRef.current = newMessageId;
      const newMessage: UIMessage = {
        id: newMessageId,
        role: "assistant",
        parts: [{ type: "text", text: textContent }],
      };
      // Notify about the new message for ref tracking
      onMessageUpdate(newMessage);
      return [...prev, newMessage];
    });
  } else if (chunk.type === "tool_call") {
    // Handle tool call (file edits, terminal commands, etc.)
    const toolContent = typeof chunk.content === "object" ? chunk.content : null;
    if (toolContent && "id" in toolContent) {
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        const toolName = (toolContent as any).name || "unknown";
        const toolCallId = (toolContent as any).id || generateUUID();

        // Create ToolUIPart in the format expected by AI SDK and rendering components
        // The type must be `tool-${toolName}` for isToolUIPart to recognize it
        const toolPart = {
          type: `tool-${toolName}` as const,
          toolCallId,
          toolName,
          input: (toolContent as any).input || {},
          state: "input-available" as const,
        } as any;

        if (lastMessage?.role === "assistant") {
          const updatedMessage: UIMessage = {
            ...lastMessage,
            parts: [...lastMessage.parts, toolPart],
          };
          onMessageUpdate(updatedMessage);
          return [...prev.slice(0, -1), updatedMessage];
        }

        // No assistant message yet - create one to attach the tool call
        const newMessageId = generateUUID();
        currentMessageIdRef.current = newMessageId;
        const newMessage: UIMessage = {
          id: newMessageId,
          role: "assistant",
          parts: [toolPart],
        };
        onMessageUpdate(newMessage);
        return [...prev, newMessage];
      });
    }
  } else if (chunk.type === "tool_result") {
    // Handle tool result
    const resultContent = typeof chunk.content === "object" ? chunk.content : null;
    if (resultContent && "id" in resultContent) {
      const toolCallId = (resultContent as any).id;
      const toolOutput = (resultContent as any).output;
      const toolState = (resultContent as any).state;

      setMessages((prev) => {
        // Find the most recent assistant message that contains this tool call
        let targetIndex = -1;
        for (let i = prev.length - 1; i >= 0; i -= 1) {
          const message = prev[i];
          if (message.role !== "assistant") continue;
          const hasTool = message.parts.some(
            (p) =>
              // Check for tool part with matching toolCallId
              typeof p.type === "string" &&
              p.type.startsWith("tool-") &&
              (p as any).toolCallId === toolCallId,
          );
          if (hasTool) {
            targetIndex = i;
            break;
          }
        }

        if (targetIndex === -1) return prev;

        const targetMessage = prev[targetIndex];
        const updatedMessage: UIMessage = {
          ...targetMessage,
          parts: targetMessage.parts.map((p): typeof p => {
            // Check if this is a tool part with matching toolCallId
            if (
              typeof p.type === "string" &&
              p.type.startsWith("tool-") &&
              (p as any).toolCallId === toolCallId
            ) {
              // Determine the correct state
              const newState =
                toolState === "failed" || toolState === "error"
                  ? "output-error"
                  : "output-available";

              return {
                ...p,
                state: newState,
                output: toolOutput,
              } as any;
            }
            return p;
          }),
        };

        if (targetMessage.id === currentMessageIdRef.current) {
          onMessageUpdate(updatedMessage);
        }

        return [
          ...prev.slice(0, targetIndex),
          updatedMessage,
          ...prev.slice(targetIndex + 1),
        ];
      });
    }
  } else if (chunk.type === "thinking") {
    // Handle thinking/reasoning (show as special text)
    const thinkingText = typeof chunk.content === "string" ? chunk.content : "";
    if (thinkingText) {
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (
          lastMessage?.role === "assistant" &&
          lastMessage.id === currentMessageIdRef.current
        ) {
          // Append thinking to existing message
          const updatedMessage: UIMessage = {
            ...lastMessage,
            parts: [
              ...lastMessage.parts,
              { type: "reasoning" as const, text: thinkingText },
            ],
          };
          onMessageUpdate(updatedMessage);
          return [...prev.slice(0, -1), updatedMessage];
        }
        // Create new message with thinking
        const newMessageId = generateUUID();
        currentMessageIdRef.current = newMessageId;
        const newMessage: UIMessage = {
          id: newMessageId,
          role: "assistant",
          parts: [{ type: "reasoning" as const, text: thinkingText }],
        };
        onMessageUpdate(newMessage);
        return [...prev, newMessage];
      });
    }
  }
}

/**
 * React hook for ACP (Agent Client Protocol) chat communication
 * Handles session management, streaming responses, and permission requests
 */
export function useACPChat({
  threadId,
  agentId,
  onFinish,
  onError,
  onUserMessage,
}: UseACPChatOptions): UseACPChatReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<"initializing" | "ready" | "streaming" | "error">("initializing");
  const [error, setError] = useState<Error | null>(null);
  const [session, setSession] = useState<ACPSession | null>(null);
  const [pendingPermission, setPendingPermission] =
    useState<ACPPermissionRequest | null>(null);

  // Track current message being streamed - this ref is updated on EVERY chunk
  const currentMessageRef = useRef<UIMessage | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);

  // Buffer for chunks that arrive before session is ready
  const chunkBufferRef = useRef<ACPMessageChunk[]>([]);

  // Track if we're currently processing buffered chunks to avoid recursion
  const processingBufferRef = useRef(false);

  // Get working directory from store
  const getWorkingDirectory = useCallback(() => {
    const directory = getActiveWorkingDirectory(threadId);
    return directory?.path || process.cwd?.() || "/";
  }, [threadId]);

  // Track session for cleanup
  const sessionRef = useRef<ACPSession | null>(null);

  // Callback to update currentMessageRef when messages change
  const handleMessageUpdate = useCallback((message: UIMessage) => {
    currentMessageRef.current = message;
  }, []);

  // Process a single chunk (used by both direct processing and buffer processing)
  const processChunk = useCallback((chunk: ACPMessageChunk) => {
    console.log("[useACPChat] Processing chunk type:", chunk.type, "content:", chunk.content);

    // Ignore echoed user chunks to prevent duplicate messages
    if (chunk.type === "text" && chunk.role === "user") {
      return;
    }

    // Handle error chunks
    if (chunk.type === "error") {
      let errorText: string;
      if (typeof chunk.content === "string") {
        errorText = chunk.content;
      } else if (typeof chunk.content === "object" && chunk.content !== null) {
        const errObj = chunk.content as unknown as Record<string, unknown>;
        if (typeof errObj.message === "string") {
          errorText = errObj.message;
        } else if (typeof errObj.error === "string") {
          errorText = errObj.error;
        } else {
          errorText = JSON.stringify(chunk.content);
        }
      } else {
        errorText = "An error occurred";
      }
      console.error("[useACPChat] Error chunk received:", errorText);
      setError(new Error(errorText));
      setStatus("error");
      onError?.(new Error(errorText));
      return;
    }

    // Process the chunk into messages
    processChunkIntoMessages(chunk, currentMessageIdRef, setMessages, handleMessageUpdate);

    // Check for done flag (can be set on any chunk type)
    if (chunk.done) {
      console.log("[useACPChat] Stream done, currentMessageRef:", currentMessageRef.current?.id);
      setStatus("ready");
      if (currentMessageRef.current) {
        console.log("[useACPChat] Calling onFinish with complete message, parts count:", currentMessageRef.current.parts.length);
        onFinish?.(currentMessageRef.current);
      }
      currentMessageRef.current = null;
      currentMessageIdRef.current = null;
    }
  }, [handleMessageUpdate, onFinish, onError]);

  // Reset ACP state when thread changes (avoid leaking messages between chats)
  useEffect(() => {
    setMessages([]);
    setError(null);
    setStatus(agentId ? "initializing" : "ready");
    setSession(null);
    sessionRef.current = null;
    currentMessageRef.current = null;
    currentMessageIdRef.current = null;
    chunkBufferRef.current = [];
  }, [threadId, agentId]);

  // Process buffered chunks when session becomes available
  const processBufferedChunks = useCallback((sessionId: string) => {
    if (processingBufferRef.current) return;
    if (chunkBufferRef.current.length === 0) return;

    processingBufferRef.current = true;
    console.log(`[useACPChat] Processing ${chunkBufferRef.current.length} buffered chunks for session ${sessionId}`);

    const bufferedChunks = chunkBufferRef.current;
    chunkBufferRef.current = [];

    // Filter and process chunks that match our session
    for (const chunk of bufferedChunks) {
      if (chunk.sessionId === sessionId) {
        processChunk(chunk);
      } else {
        console.log("[useACPChat] Discarding buffered chunk - session mismatch:", chunk.sessionId, "vs", sessionId);
      }
    }

    processingBufferRef.current = false;
  }, [processChunk]);

  // Initialize session when agentId changes
  useEffect(() => {
    let mounted = true;

    async function initSession() {
      console.log("[useACPChat] initSession called, agentId:", agentId);
      if (!agentId) {
        console.log("[useACPChat] No agentId, skipping session init");
        return;
      }

      try {
        // Start the agent if not running
        console.log("[useACPChat] Starting agent:", agentId);
        await startACPAgent(agentId);
        console.log("[useACPChat] Agent started, creating session...");

        // Create a new session
        const workDir = getWorkingDirectory();
        console.log("[useACPChat] Working directory:", workDir);
        const newSession = await createACPSession(agentId, workDir);
        console.log("[useACPChat] Session created:", newSession.sessionId);

        if (mounted) {
          setSession(newSession);
          sessionRef.current = newSession;
          setError(null);
          setStatus("ready");
          console.log("[useACPChat] Session state updated, status set to ready");

          // Process any chunks that were buffered while waiting for session
          // Use setTimeout to ensure state has settled
          setTimeout(() => {
            if (mounted && newSession.sessionId) {
              processBufferedChunks(newSession.sessionId);
            }
          }, 0);
        }
      } catch (err) {
        console.error("[useACPChat] Failed to initialize session:", err);
        if (mounted) {
          chunkBufferRef.current = [];
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus("error");
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    // Reset status when starting new session
    setStatus("initializing");
    // Clear any buffered chunks from previous session
    chunkBufferRef.current = [];
    initSession();

    // Cleanup: Cancel any ongoing prompts when unmounting
    return () => {
      mounted = false;
      // Cancel ongoing prompt if any
      if (sessionRef.current && agentId) {
        console.log("[useACPChat] Cleanup: Cancelling session", sessionRef.current.sessionId);
        cancelACPPrompt(agentId, sessionRef.current.sessionId).catch((err) => {
          // Ignore cancellation errors on unmount
          console.log("[useACPChat] Cleanup cancellation:", err);
        });
      }
      sessionRef.current = null;
    };
  }, [agentId, threadId, getWorkingDirectory, onError, processBufferedChunks]);

  // Subscribe to message chunks - this effect does NOT depend on session
  // to ensure we never miss chunks during initialization
  useEffect(() => {
    console.log("[useACPChat] Setting up message chunk listener");

    const unsubscribe = onACPMessageChunk((chunk: ACPMessageChunk) => {
      console.log("[useACPChat] Received chunk:", JSON.stringify(chunk, null, 2));

      // Get current session from ref (more reliable than state during initialization)
      const currentSession = sessionRef.current;

      // If session not ready yet, buffer the chunk
      if (!currentSession?.sessionId) {
        console.log("[useACPChat] Session not ready, buffering chunk");
        chunkBufferRef.current.push(chunk);
        return;
      }

      // Only process chunks for our session
      if (chunk.sessionId !== currentSession.sessionId) {
        console.log("[useACPChat] Skipping chunk - session mismatch:", chunk.sessionId, "vs", currentSession.sessionId);
        return;
      }

      processChunk(chunk);
    });

    return unsubscribe;
  }, [processChunk]); // Only depend on processChunk, not session

  // Subscribe to permission requests
  useEffect(() => {
    const unsubscribe = onACPPermissionRequest(
      (request: ACPPermissionRequest) => {
        // Only process requests for our agent
        if (request.agentId !== agentId) return;
        setPendingPermission(request);
      }
    );

    return unsubscribe;
  }, [agentId]);

  // Subscribe to agent errors
  useEffect(() => {
    const unsubscribe = onACPAgentError(
      (data: { agentId: string; error: string }) => {
        if (data.agentId !== agentId) return;
        const error = new Error(data.error);
        setError(error);
        setStatus("error");
        onError?.(error);
      }
    );

    return unsubscribe;
  }, [agentId, onError]);

  // Send a message to the ACP agent
  const sendMessage = useCallback(
    async (content: string) => {
      if (!session) {
        const errorMsg = status === "initializing"
          ? "Session is still initializing. Please wait a moment."
          : "No active session";
        setError(new Error(errorMsg));
        return;
      }

      setStatus("streaming");
      setError(null);

      // Add user message
      const userMessage: UIMessage = {
        id: generateUUID(),
        role: "user",
        parts: [{ type: "text", text: content }],
      };
      setMessages((prev) => [...prev, userMessage]);

      // Notify about user message for persistence
      onUserMessage?.(userMessage);

      try {
        await sendACPPrompt(agentId, session.sessionId, content);
      } catch (err) {
        console.error("[useACPChat] Failed to send prompt:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("error");
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [session, agentId, status, onError, onUserMessage]
  );

  // Stop the current stream
  const stop = useCallback(() => {
    if (session) {
      cancelACPPrompt(agentId, session.sessionId).catch(console.error);
    }
    setStatus("ready");
  }, [session, agentId]);

  // Respond to a permission request
  const respondToPermission = useCallback(
    (_optionId: string, _rememberGlobally = false) => {
      if (pendingPermission) {
        // The actual response is handled by the parent component through the API
        setPendingPermission(null);
      }
    },
    [pendingPermission]
  );

  const setSessionModel = useCallback(
    async (modelId: string) => {
      if (!session) return;
      await setACPSessionModel(agentId, session.sessionId, modelId);
      setSession((prev) =>
        prev?.models
          ? {
              ...prev,
              models: {
                ...prev.models,
                currentModelId: modelId,
              },
            }
          : prev,
      );
    },
    [agentId, session],
  );

  const setSessionConfigOption = useCallback(
    async (configId: string, value: string) => {
      if (!session) return;
      const response = await setACPSessionConfigOption(
        agentId,
        session.sessionId,
        configId,
        value,
      );
      if (response?.configOptions) {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                configOptions: response.configOptions ?? null,
              }
            : prev,
        );
      }
    },
    [agentId, session],
  );

  const setSessionMode = useCallback(
    async (modeId: string) => {
      if (!session) return;
      await setACPSessionMode(agentId, session.sessionId, modeId);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              currentMode: modeId,
            }
          : prev,
      );
    },
    [agentId, session],
  );

  return {
    messages,
    status,
    error,
    session,
    pendingPermission,
    sendMessage,
    stop,
    setMessages,
    respondToPermission,
    setSessionModel,
    setSessionConfigOption,
    setSessionMode,
  };
}

export default useACPChat;
