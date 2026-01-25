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
  onACPMessageChunk,
  onACPPermissionRequest,
  onACPAgentError,
} from "@/lib/electron/acp-api";
import { generateUUID } from "lib/utils";
import { appStore } from "@/app/store";

interface UseACPChatOptions {
  threadId: string;
  agentId: string;
  onFinish?: (message: UIMessage) => void;
  onError?: (error: Error) => void;
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
}: UseACPChatOptions): UseACPChatReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<"initializing" | "ready" | "streaming" | "error">("initializing");
  const [error, setError] = useState<Error | null>(null);
  const [session, setSession] = useState<ACPSession | null>(null);
  const [pendingPermission, setPendingPermission] =
    useState<ACPPermissionRequest | null>(null);

  // Track current message being streamed
  const currentMessageRef = useRef<UIMessage | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);

  // Get working directory from store
  const getWorkingDirectory = useCallback(() => {
    const state = appStore.getState();
    return state.workingDirectory?.path || process.cwd?.() || "/";
  }, []);

  // Track session for cleanup
  const sessionRef = useRef<ACPSession | null>(null);

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
        }
      } catch (err) {
        console.error("[useACPChat] Failed to initialize session:", err);
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus("error");
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    // Reset status when starting new session
    setStatus("initializing");
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
  }, [agentId, getWorkingDirectory, onError]);

  // Subscribe to message chunks
  useEffect(() => {
    console.log("[useACPChat] Setting up message chunk listener for session:", session?.sessionId);
    const unsubscribe = onACPMessageChunk((chunk: ACPMessageChunk) => {
      console.log("[useACPChat] Received chunk:", JSON.stringify(chunk, null, 2));
      console.log("[useACPChat] Chunk sessionId:", chunk.sessionId, "vs our session:", session?.sessionId);
      // Only process chunks for our session
      if (chunk.sessionId !== session?.sessionId) {
        console.log("[useACPChat] Skipping chunk - session mismatch");
        return;
      }
      console.log("[useACPChat] Processing chunk type:", chunk.type, "content:", chunk.content);

      // Handle different chunk types
      if (chunk.type === "text") {
        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];

          if (
            lastMessage?.role === "assistant" &&
            lastMessage.id === currentMessageIdRef.current
          ) {
            // Append to existing message
            const textPart = lastMessage.parts.find((p) => p.type === "text");
            if (textPart && "text" in textPart) {
              return prev.map((msg, idx) =>
                idx === prev.length - 1
                  ? {
                      ...msg,
                      parts: msg.parts.map((p) =>
                        p.type === "text" && "text" in p
                          ? { ...p, text: p.text + (chunk.content || "") }
                          : p
                      ),
                    }
                  : msg
              );
            }
          }

          // Create new message
          const newMessageId = generateUUID();
          currentMessageIdRef.current = newMessageId;
          const textContent = typeof chunk.content === "string" ? chunk.content : "";
          const newMessage: UIMessage = {
            id: newMessageId,
            role: "assistant",
            parts: [{ type: "text", text: textContent }],
          };
          currentMessageRef.current = newMessage;
          return [...prev, newMessage];
        });
      } else if (chunk.type === "tool_call") {
        // Handle tool call (file edits, terminal commands, etc.)
        // Content is an ACPToolCallChunk object for tool_call type
        const toolContent = typeof chunk.content === "object" ? chunk.content : null;
        if (toolContent && "id" in toolContent) {
          setMessages((prev) => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage?.role === "assistant") {
              return prev.map((msg, idx) =>
                idx === prev.length - 1
                  ? {
                      ...msg,
                      parts: [
                        ...msg.parts,
                        {
                          type: "tool-invocation" as const,
                          toolInvocation: {
                            toolCallId: toolContent.id || generateUUID(),
                            toolName: toolContent.name || "unknown",
                            args: toolContent.input || {},
                            state: "input-available",
                          },
                        } as any,
                      ],
                    }
                  : msg
              );
            }
            return prev;
          });
        }
      } else if (chunk.type === "tool_result") {
        // Handle tool result
        // Content is an ACPToolCallChunk object for tool_result type
        const resultContent = typeof chunk.content === "object" ? chunk.content : null;
        if (resultContent && "id" in resultContent) {
          setMessages((prev) => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage?.role === "assistant") {
              return prev.map((msg, idx) => {
                if (idx !== prev.length - 1) return msg;
                return {
                  ...msg,
                  parts: msg.parts.map((p): typeof p => {
                    if (p.type === "tool-invocation" && "toolInvocation" in p) {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const toolPart = p as any;
                      if (toolPart.toolInvocation?.toolCallId === resultContent.id) {
                        return {
                          ...toolPart,
                          toolInvocation: {
                            ...toolPart.toolInvocation,
                            state: "output-available",
                            result: resultContent.output,
                          },
                        };
                      }
                    }
                    return p;
                  }),
                };
              });
            }
            return prev;
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
              return prev.map((msg, idx) =>
                idx === prev.length - 1
                  ? {
                      ...msg,
                      parts: [
                        ...msg.parts,
                        { type: "reasoning" as const, text: thinkingText },
                      ],
                    }
                  : msg
              );
            }
            // Create new message with thinking
            const newMessageId = generateUUID();
            currentMessageIdRef.current = newMessageId;
            const newMessage: UIMessage = {
              id: newMessageId,
              role: "assistant",
              parts: [{ type: "reasoning" as const, text: thinkingText }],
            };
            currentMessageRef.current = newMessage;
            return [...prev, newMessage];
          });
        }
      } else if (chunk.type === "error") {
        // Handle error messages - extract proper error text from various formats
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
      }

      // Check for done flag (can be set on any chunk type)
      if (chunk.done) {
        // Message complete
        setStatus("ready");
        if (currentMessageRef.current) {
          onFinish?.(currentMessageRef.current);
        }
        currentMessageRef.current = null;
        currentMessageIdRef.current = null;
      }
    });

    return unsubscribe;
  }, [session?.sessionId, onFinish]);

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
      (data: { agentId: string; error: Error }) => {
        if (data.agentId !== agentId) return;
        setError(data.error);
        setStatus("error");
        onError?.(data.error);
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

      try {
        await sendACPPrompt(agentId, session.sessionId, content);
      } catch (err) {
        console.error("[useACPChat] Failed to send prompt:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("error");
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [session, agentId, status, onError]
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
    (optionId: string, _rememberGlobally = false) => {
      if (pendingPermission) {
        // The actual response is handled by the parent component through the API
        setPendingPermission(null);
      }
    },
    [pendingPermission]
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
  };
}

export default useACPChat;
