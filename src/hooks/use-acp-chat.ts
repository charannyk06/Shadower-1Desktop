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
  onACPSessionRecreated,
  setACPAutoResume,
  getACPAgenticLoopStatus,
  type AgenticLoopStatus,
} from "@/lib/electron/acp-api";
import { generateUUID } from "lib/utils";
import {
  getActiveWorkingDirectory,
  appStore,
  resolveWorkingDirectory,
} from "@/app/store";
import { useShallow } from "zustand/shallow";

interface UseACPChatOptions {
  threadId: string;
  agentId: string;
  /** Enable auto-resume (agentic loop) - agent continues until task is complete */
  autoResume?: boolean;
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
  /** Agentic loop status - shows if agent is actively working */
  agenticLoopStatus: AgenticLoopStatus | null;
  sendMessage: (content: string) => Promise<void>;
  stop: () => void;
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  respondToPermission: (optionId: string, rememberGlobally?: boolean) => void;
  setSessionModel: (modelId: string) => Promise<void>;
  setSessionConfigOption: (configId: string, value: string) => Promise<void>;
  setSessionMode: (modeId: string) => Promise<void>;
  /** Toggle auto-resume (agentic loop) mode */
  setAutoResume: (enabled: boolean) => Promise<void>;
}

/**
 * Apply a single chunk to a messages array (pure function, no state updates)
 * Returns the updated messages array
 */
function applyChunkToMessages(
  chunk: ACPMessageChunk,
  messages: UIMessage[],
  currentMessageIdRef: React.MutableRefObject<string | null>,
  onMessageUpdate: (message: UIMessage) => void,
): UIMessage[] {
  if (chunk.type === "text") {
    const lastMessage = messages[messages.length - 1];
    const textContent = typeof chunk.content === "string" ? chunk.content : "";

    // Ignore empty text chunks
    if (!textContent) {
      return messages;
    }

    if (
      lastMessage?.role === "assistant" &&
      lastMessage.id === currentMessageIdRef.current
    ) {
      // Append to last text part or create new one
      const lastPart = lastMessage.parts[lastMessage.parts.length - 1];
      let updatedMessage: UIMessage;

      if (lastPart && lastPart.type === "text" && "text" in lastPart) {
        updatedMessage = {
          ...lastMessage,
          parts: lastMessage.parts.map((p, i) =>
            i === lastMessage.parts.length - 1 && p.type === "text"
              ? {
                  ...p,
                  text:
                    (p as { type: "text"; text: string }).text + textContent,
                }
              : p,
          ),
        };
      } else {
        updatedMessage = {
          ...lastMessage,
          parts: [
            ...lastMessage.parts,
            { type: "text" as const, text: textContent },
          ],
        };
      }
      onMessageUpdate(updatedMessage);
      return [...messages.slice(0, -1), updatedMessage];
    }

    // Create new assistant message
    const newMessageId = generateUUID();
    currentMessageIdRef.current = newMessageId;
    const newMessage: UIMessage = {
      id: newMessageId,
      role: "assistant",
      parts: [{ type: "text" as const, text: textContent }],
    };
    onMessageUpdate(newMessage);
    return [...messages, newMessage];
  }

  if (chunk.type === "tool_call") {
    const toolContent =
      typeof chunk.content === "object" ? chunk.content : null;
    if (toolContent && "id" in toolContent) {
      const lastMessage = messages[messages.length - 1];
      const toolName = (toolContent as any).name || "unknown";
      const toolCallId = (toolContent as any).id || generateUUID();

      // Extract input properly - handle both object and undefined cases
      // Gemini models may send arguments as a JSON string - parse it
      let toolInput: Record<string, unknown> = {};
      if (
        toolContent &&
        typeof toolContent === "object" &&
        "input" in toolContent
      ) {
        let inputValue = (toolContent as any).input;
        // Parse JSON strings (Gemini sends args as JSON strings)
        if (typeof inputValue === "string") {
          try {
            inputValue = JSON.parse(inputValue);
          } catch {
            // keep as string
          }
        }
        if (inputValue !== null && inputValue !== undefined) {
          if (typeof inputValue === "object" && !Array.isArray(inputValue)) {
            toolInput = inputValue as Record<string, unknown>;
          } else {
            // If input is not an object, wrap it
            toolInput = { value: inputValue };
          }
        }
      }

      const toolPart = {
        type: `tool-${toolName}` as const,
        toolCallId,
        toolName,
        input: toolInput,
        state: "input-available" as const,
      } as any;

      if (lastMessage?.role === "assistant") {
        const updatedMessage: UIMessage = {
          ...lastMessage,
          parts: [...lastMessage.parts, toolPart],
        };
        onMessageUpdate(updatedMessage);
        return [...messages.slice(0, -1), updatedMessage];
      }

      const newMessageId = generateUUID();
      currentMessageIdRef.current = newMessageId;
      const newMessage: UIMessage = {
        id: newMessageId,
        role: "assistant",
        parts: [toolPart],
      };
      onMessageUpdate(newMessage);
      return [...messages, newMessage];
    }
  }

  if (chunk.type === "tool_result") {
    const resultContent =
      typeof chunk.content === "object" ? chunk.content : null;
    if (resultContent && "id" in resultContent) {
      const toolCallId = (resultContent as any).id;
      const toolOutput = (resultContent as any).output;
      const toolState = (resultContent as any).state;

      // Find the message that contains this tool call
      let targetIndex = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message.role !== "assistant") continue;
        const hasTool = message.parts.some(
          (p) =>
            typeof p.type === "string" &&
            p.type.startsWith("tool-") &&
            (p as any).toolCallId === toolCallId,
        );
        if (hasTool) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex === -1) return messages;

      const targetMessage = messages[targetIndex];
      const updatedMessage: UIMessage = {
        ...targetMessage,
        parts: targetMessage.parts.map((p): typeof p => {
          if (
            typeof p.type === "string" &&
            p.type.startsWith("tool-") &&
            (p as any).toolCallId === toolCallId
          ) {
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

      // Always track the updated message for persistence, regardless of whether
      // it's the "current" message. This ensures tool results are saved even when
      // they update an earlier message in the conversation.
      onMessageUpdate(updatedMessage);

      return [
        ...messages.slice(0, targetIndex),
        updatedMessage,
        ...messages.slice(targetIndex + 1),
      ];
    }
  }

  if (chunk.type === "thinking") {
    const thinkingText = typeof chunk.content === "string" ? chunk.content : "";
    if (thinkingText) {
      const lastMessage = messages[messages.length - 1];
      if (
        lastMessage?.role === "assistant" &&
        lastMessage.id === currentMessageIdRef.current
      ) {
        // Find existing reasoning part to accumulate into
        const existingReasoningIndex = lastMessage.parts.findIndex(
          (p) => p.type === "reasoning",
        );

        let updatedParts;
        if (existingReasoningIndex !== -1) {
          updatedParts = lastMessage.parts.map((p, i) =>
            i === existingReasoningIndex && p.type === "reasoning"
              ? {
                  ...p,
                  text:
                    (p as { type: "reasoning"; text: string }).text +
                    thinkingText,
                }
              : p,
          );
        } else {
          updatedParts = [
            ...lastMessage.parts,
            { type: "reasoning" as const, text: thinkingText },
          ];
        }

        const updatedMessage: UIMessage = {
          ...lastMessage,
          parts: updatedParts,
        };
        onMessageUpdate(updatedMessage);
        return [...messages.slice(0, -1), updatedMessage];
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
      return [...messages, newMessage];
    }
  }

  // Feature 1: Handle plan updates
  if ((chunk.type as string) === "plan") {
    const planContent =
      typeof chunk.content === "object" && chunk.content !== null
        ? (chunk.content as {
            planId?: string;
            title?: string;
            steps?: Array<{
              id: string;
              description: string;
              status: string;
            }>;
            status?: string;
          })
        : null;

    if (planContent && planContent.steps) {
      const lastMessage = messages[messages.length - 1];
      // Create a plan part - this can be rendered as a special UI component
      const planPart = {
        type: "plan" as const,
        planId: planContent.planId || generateUUID(),
        title: planContent.title,
        steps: planContent.steps,
        status: planContent.status || "pending",
      } as any;

      if (
        lastMessage?.role === "assistant" &&
        lastMessage.id === currentMessageIdRef.current
      ) {
        // Update existing plan part or add new one
        const existingPlanIndex = lastMessage.parts.findIndex(
          (p) =>
            (p.type as string) === "plan" &&
            (p as any).planId === planPart.planId,
        );

        let updatedParts;
        if (existingPlanIndex !== -1) {
          updatedParts = lastMessage.parts.map((p, i) =>
            i === existingPlanIndex ? planPart : p,
          );
        } else {
          updatedParts = [...lastMessage.parts, planPart];
        }

        const updatedMessage: UIMessage = {
          ...lastMessage,
          parts: updatedParts,
        };
        onMessageUpdate(updatedMessage);
        return [...messages.slice(0, -1), updatedMessage];
      }

      // Create new message with plan
      const newMessageId = generateUUID();
      currentMessageIdRef.current = newMessageId;
      const newMessage: UIMessage = {
        id: newMessageId,
        role: "assistant",
        parts: [planPart],
      };
      onMessageUpdate(newMessage);
      return [...messages, newMessage];
    }
  }

  // Feature 3: Handle terminal output
  if ((chunk.type as string) === "terminal_output") {
    const terminalContent =
      typeof chunk.content === "object" && chunk.content !== null
        ? (chunk.content as { terminalId?: string; data?: string })
        : null;

    if (terminalContent && terminalContent.data) {
      const lastMessage = messages[messages.length - 1];
      const terminalId = terminalContent.terminalId || "terminal";

      if (
        lastMessage?.role === "assistant" &&
        lastMessage.id === currentMessageIdRef.current
      ) {
        // Find existing terminal part to append to
        const existingTerminalIndex = lastMessage.parts.findIndex(
          (p) =>
            (p.type as string) === "terminal_output" &&
            (p as any).terminalId === terminalId,
        );

        let updatedParts;
        if (existingTerminalIndex !== -1) {
          updatedParts = lastMessage.parts.map((p, i) =>
            i === existingTerminalIndex
              ? {
                  ...p,
                  data: ((p as any).data || "") + terminalContent.data,
                }
              : p,
          );
        } else {
          updatedParts = [
            ...lastMessage.parts,
            {
              type: "terminal_output" as const,
              terminalId,
              data: terminalContent.data,
            } as any,
          ];
        }

        const updatedMessage: UIMessage = {
          ...lastMessage,
          parts: updatedParts,
        };
        onMessageUpdate(updatedMessage);
        return [...messages.slice(0, -1), updatedMessage];
      }
    }
  }

  // Feature 3: Handle terminal exit
  if ((chunk.type as string) === "terminal_exit") {
    const exitContent =
      typeof chunk.content === "object" && chunk.content !== null
        ? (chunk.content as {
            terminalId?: string;
            exitCode?: number;
            signal?: string;
          })
        : null;

    if (exitContent) {
      const lastMessage = messages[messages.length - 1];
      const terminalId = exitContent.terminalId || "terminal";

      if (
        lastMessage?.role === "assistant" &&
        lastMessage.id === currentMessageIdRef.current
      ) {
        // Find existing terminal part and update it with exit info
        const existingTerminalIndex = lastMessage.parts.findIndex(
          (p) =>
            (p.type as string) === "terminal_output" &&
            (p as any).terminalId === terminalId,
        );

        if (existingTerminalIndex !== -1) {
          const updatedParts = lastMessage.parts.map((p, i) =>
            i === existingTerminalIndex
              ? {
                  ...p,
                  exitCode: exitContent.exitCode,
                  signal: exitContent.signal,
                  completed: true,
                }
              : p,
          );

          const updatedMessage: UIMessage = {
            ...lastMessage,
            parts: updatedParts,
          };
          onMessageUpdate(updatedMessage);
          return [...messages.slice(0, -1), updatedMessage];
        }
      }
    }
  }

  // Feature 4: Handle commands update (store in message metadata)
  // Commands updates are typically handled at the session level, not per message
  // We'll skip adding them to messages but log them for debugging
  if (chunk.type === "commands_update") {
    console.log("[useACPChat] Commands update received:", chunk.content);
    // Commands are handled at the service level via events
    return messages;
  }

  // Feature 6: Handle session info update
  // Session info updates are typically handled at the session level
  if (chunk.type === "session_info") {
    console.log("[useACPChat] Session info update received:", chunk.content);
    // Session info is handled at the service level via events
    return messages;
  }

  return messages;
}

/**
 * React hook for ACP (Agent Client Protocol) chat communication
 * Handles session management, streaming responses, and permission requests.
 *
 * AGENTIC BEHAVIOR: When autoResume is enabled (default), the agent will
 * automatically continue working until the task is complete. This is what
 * makes it truly "agentic" - following Zed's patterns where agents keep
 * running in the background until they reach "end_turn".
 */
export function useACPChat({
  threadId,
  agentId,
  autoResume = true, // Enable agentic behavior by default
  onFinish,
  onError,
  onUserMessage,
}: UseACPChatOptions): UseACPChatReturn {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<
    "initializing" | "ready" | "streaming" | "error"
  >("initializing");
  const [error, setError] = useState<Error | null>(null);
  const [session, setSession] = useState<ACPSession | null>(null);
  const [pendingPermission, setPendingPermission] =
    useState<ACPPermissionRequest | null>(null);
  const [agenticLoopStatus, setAgenticLoopStatus] =
    useState<AgenticLoopStatus | null>(null);

  // Track current message being streamed - this ref is updated on EVERY chunk
  const currentMessageRef = useRef<UIMessage | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);

  // Track ALL assistant messages updated during streaming for persistence
  // This ensures tool results for non-current messages are also saved
  const updatedMessagesMapRef = useRef<Map<string, UIMessage>>(new Map());

  // Stable ref for onFinish so watchdog/belt-and-suspenders can call it
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  // Watchdog: track last chunk time and streaming start for stuck-state recovery
  const lastChunkTimeRef = useRef<number>(0);
  const streamingStartTimeRef = useRef<number>(0);

  // Flush all tracked messages and reset streaming refs.
  // Shared by done-chunk handler, error handler, belt-and-suspenders, and watchdog.
  const flushAndReset = useCallback((targetStatus: "ready" | "error") => {
    const unsaved = Array.from(updatedMessagesMapRef.current.values());
    for (const msg of unsaved) {
      if (msg.role === "assistant") onFinishRef.current?.(msg);
    }
    updatedMessagesMapRef.current.clear();
    currentMessageRef.current = null;
    currentMessageIdRef.current = null;
    setStatus(targetStatus);
  }, []);

  // Buffer for chunks that arrive before session is ready
  const chunkBufferRef = useRef<ACPMessageChunk[]>([]);

  // Track if we're currently processing buffered chunks to avoid recursion
  const processingBufferRef = useRef(false);

  // Batch queue for incoming chunks to prevent race conditions
  const chunkBatchQueueRef = useRef<ACPMessageChunk[]>([]);
  const batchProcessingScheduledRef = useRef(false);

  // Get working directory from store
  const getWorkingDirectory = useCallback(() => {
    const directory = getActiveWorkingDirectory(threadId);
    return directory?.path || process.cwd?.() || "/";
  }, [threadId]);

  // Subscribe to working directory state from store for change detection
  const [
    globalWorkingDirectory,
    workingDirectoryMode,
    threadWorkingDirectories,
  ] = appStore(
    useShallow((state) => [
      state.workingDirectory,
      state.workingDirectoryMode,
      state.threadWorkingDirectories,
    ]),
  );

  // Compute current resolved working directory
  const currentWorkingDirectory = resolveWorkingDirectory(
    {
      workingDirectory: globalWorkingDirectory,
      workingDirectoryMode,
      threadWorkingDirectories,
    },
    threadId,
  );

  // Track the working directory that the session was created with
  const sessionWorkingDirectoryRef = useRef<string | null>(null);

  // Track session for cleanup
  const sessionRef = useRef<ACPSession | null>(null);

  // Callback to update currentMessageRef and track all updated messages for persistence
  const handleMessageUpdate = useCallback((message: UIMessage) => {
    currentMessageRef.current = message;
    // Track every updated assistant message so we can persist ALL of them on finish
    updatedMessagesMapRef.current.set(message.id, message);
  }, []);

  // Process batched chunks in a single setMessages call to prevent race conditions
  const processBatchedChunks = useCallback(() => {
    if (chunkBatchQueueRef.current.length === 0) {
      batchProcessingScheduledRef.current = false;
      return;
    }

    // Get all queued chunks and clear the queue
    const chunksToProcess = chunkBatchQueueRef.current;
    chunkBatchQueueRef.current = [];
    batchProcessingScheduledRef.current = false;

    // Track if we have a done chunk
    let hasDoneChunk = false;

    // Process all chunks in a single setMessages call
    setMessages((prev) => {
      let messages = [...prev];

      for (const chunk of chunksToProcess) {
        // Ignore echoed user chunks
        if (chunk.type === "text" && chunk.role === "user") {
          continue;
        }

        // Check for done flag BEFORE skipping error chunks
        // This ensures we capture done even on error chunks
        if (chunk.done) {
          console.log(
            "[useACPChat] Chunk has done flag:",
            chunk.type,
            chunk.sessionId,
          );
          hasDoneChunk = true;
        }

        // Handle error chunks outside of state update
        if (chunk.type === "error") {
          continue; // Will be handled separately
        }

        // Apply chunk to messages array
        messages = applyChunkToMessages(
          chunk,
          messages,
          currentMessageIdRef,
          handleMessageUpdate,
        );
      }

      return messages;
    });

    // Handle error chunks - but do NOT skip done handling
    // Previously, the error handler returned early, which meant accumulated
    // messages (text + tool calls) were never saved when an error occurred.
    let hasError = false;
    for (const chunk of chunksToProcess) {
      if (chunk.type === "error") {
        let errorText: string;
        if (typeof chunk.content === "string") {
          errorText = chunk.content;
        } else if (
          typeof chunk.content === "object" &&
          chunk.content !== null
        ) {
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
        onError?.(new Error(errorText));
        hasError = true;
        break; // Process done handling below instead of returning
      }
    }

    // Always handle done flag, even if there was an error
    // This ensures accumulated messages (text + tool calls) are persisted
    if (hasDoneChunk) {
      console.log(
        "[useACPChat] Stream done, saving all updated messages. Count:",
        updatedMessagesMapRef.current.size,
      );
      flushAndReset(hasError ? "error" : "ready");
    } else if (hasError) {
      // Error without done flag - still clean up refs to prevent stale state
      flushAndReset("error");
    }
  }, [handleMessageUpdate, onFinish, onError, flushAndReset]);

  // Process a single chunk - adds to batch queue for processing
  const processChunk = useCallback(
    (chunk: ACPMessageChunk) => {
      console.log("[useACPChat] Queueing chunk type:", chunk.type);

      // Update watchdog timestamp on every chunk
      lastChunkTimeRef.current = Date.now();

      // Add chunk to batch queue
      chunkBatchQueueRef.current.push(chunk);

      // Schedule batch processing if not already scheduled
      if (!batchProcessingScheduledRef.current) {
        batchProcessingScheduledRef.current = true;
        // Use queueMicrotask to batch chunks that arrive in the same event loop tick
        queueMicrotask(processBatchedChunks);
      }
    },
    [processBatchedChunks],
  );

  // Reset ACP state when thread changes (avoid leaking messages between chats)
  useEffect(() => {
    setMessages([]);
    setError(null);
    setStatus(agentId ? "initializing" : "ready");
    setSession(null);
    sessionRef.current = null;
    currentMessageRef.current = null;
    currentMessageIdRef.current = null;
    updatedMessagesMapRef.current.clear();
    chunkBufferRef.current = [];
    chunkBatchQueueRef.current = [];
    batchProcessingScheduledRef.current = false;
  }, [threadId, agentId]);

  // Process buffered chunks when session becomes available
  const processBufferedChunks = useCallback(
    (sessionId: string) => {
      if (processingBufferRef.current) return;
      if (chunkBufferRef.current.length === 0) return;

      processingBufferRef.current = true;
      console.log(
        `[useACPChat] Processing ${chunkBufferRef.current.length} buffered chunks for session ${sessionId}`,
      );

      const bufferedChunks = chunkBufferRef.current;
      chunkBufferRef.current = [];

      // Filter and process chunks that match our session
      for (const chunk of bufferedChunks) {
        if (chunk.sessionId === sessionId) {
          processChunk(chunk);
        } else {
          console.log(
            "[useACPChat] Discarding buffered chunk - session mismatch:",
            chunk.sessionId,
            "vs",
            sessionId,
          );
        }
      }

      processingBufferRef.current = false;
    },
    [processChunk],
  );

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
        const newSession = await createACPSession(agentId, workDir, undefined, threadId);
        console.log("[useACPChat] Session created:", newSession.sessionId);

        if (mounted) {
          setSession(newSession);
          sessionRef.current = newSession;
          // Track the working directory the session was created with
          sessionWorkingDirectoryRef.current = workDir;
          setError(null);
          setStatus("ready");
          console.log(
            "[useACPChat] Session state updated, status set to ready, workDir:",
            workDir,
          );

          // Configure auto-resume (agentic behavior) based on option
          // This is what makes the agent truly agentic - it keeps working until done
          if (autoResume) {
            setACPAutoResume(agentId, newSession.sessionId, true).catch((err) =>
              console.warn("[useACPChat] Failed to enable auto-resume:", err),
            );
          }

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
        console.log(
          "[useACPChat] Cleanup: Cancelling session",
          sessionRef.current.sessionId,
        );
        cancelACPPrompt(agentId, sessionRef.current.sessionId).catch((err) => {
          // Ignore cancellation errors on unmount
          console.log("[useACPChat] Cleanup cancellation:", err);
        });
      }
      sessionRef.current = null;
    };
  }, [
    agentId,
    threadId,
    autoResume,
    getWorkingDirectory,
    onError,
    processBufferedChunks,
  ]);

  // Watch for working directory changes in "local" mode
  // When the working directory changes mid-conversation, recreate the session
  // so the model is aware of the new context
  // In "worktree" mode, each thread has its own directory, so we don't recreate
  useEffect(() => {
    // Only apply in "local" mode - worktree mode has per-thread directories that shouldn't change
    if (workingDirectoryMode !== "local") {
      return;
    }

    // Skip if no session yet or session is still initializing
    if (!session || status === "initializing") {
      return;
    }

    // Skip if no agent
    if (!agentId) {
      return;
    }

    const newWorkDir = currentWorkingDirectory?.path;
    const oldWorkDir = sessionWorkingDirectoryRef.current;

    // Check if working directory has actually changed
    if (!newWorkDir || newWorkDir === oldWorkDir) {
      return;
    }

    console.log(
      "[useACPChat] Working directory changed in local mode:",
      oldWorkDir,
      "->",
      newWorkDir,
    );

    // Recreate the session with the new working directory
    // This ensures the model is aware of the new context
    let mounted = true;

    const recreateSession = async () => {
      try {
        console.log(
          "[useACPChat] Recreating session with new working directory:",
          newWorkDir,
        );

        // Cancel any ongoing prompt before recreating
        if (sessionRef.current) {
          await cancelACPPrompt(agentId, sessionRef.current.sessionId).catch(
            () => {
              // Ignore errors when cancelling
            },
          );
        }

        // Create new session with updated working directory
        const newSession = await createACPSession(agentId, newWorkDir, undefined, threadId);

        if (mounted) {
          setSession(newSession);
          sessionRef.current = newSession;
          sessionWorkingDirectoryRef.current = newWorkDir;
          console.log(
            "[useACPChat] Session recreated with new working directory:",
            newSession.sessionId,
          );

          // Re-enable auto-resume if it was enabled
          if (autoResume) {
            setACPAutoResume(agentId, newSession.sessionId, true).catch((err) =>
              console.warn(
                "[useACPChat] Failed to enable auto-resume after session recreate:",
                err,
              ),
            );
          }
        }
      } catch (err) {
        console.error(
          "[useACPChat] Failed to recreate session after working directory change:",
          err,
        );
        if (mounted) {
          setError(
            err instanceof Error
              ? err
              : new Error("Failed to update working directory context"),
          );
        }
      }
    };

    recreateSession();

    return () => {
      mounted = false;
    };
  }, [
    workingDirectoryMode,
    currentWorkingDirectory?.path,
    session,
    status,
    agentId,
    autoResume,
  ]);

  // Subscribe to message chunks - this effect does NOT depend on session
  // to ensure we never miss chunks during initialization
  useEffect(() => {
    console.log("[useACPChat] Setting up message chunk listener");

    const unsubscribe = onACPMessageChunk((chunk: ACPMessageChunk) => {
      console.log(
        "[useACPChat] Received chunk:",
        JSON.stringify(chunk, null, 2),
      );

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
        console.log(
          "[useACPChat] Skipping chunk - session mismatch:",
          chunk.sessionId,
          "vs",
          currentSession.sessionId,
        );
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
      },
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
      },
    );

    return unsubscribe;
  }, [agentId, onError]);

  // Subscribe to session-recreated events to update session reference.
  // This prevents chunk filtering from discarding chunks after backend session recreation.
  // Deps intentionally omit setSession (stable useState setter) and sessionRef (ref).
  useEffect(() => {
    const unsubscribe = onACPSessionRecreated(
      (data: { agentId: string; oldSessionId: string; newSession: ACPSession }) => {
        if (data.agentId !== agentId) return;
        // Check if the old session matches ours
        if (sessionRef.current?.sessionId === data.oldSessionId) {
          console.log(
            `[useACPChat] Session recreated: ${data.oldSessionId} -> ${data.newSession.sessionId}`,
          );
          setSession(data.newSession);
          sessionRef.current = data.newSession;
        }
      },
    );

    return unsubscribe;
  }, [agentId]);

  // Send a message to the ACP agent
  const sendMessage = useCallback(
    async (content: string) => {
      if (!session) {
        const errorMsg =
          status === "initializing"
            ? "Session is still initializing. Please wait a moment."
            : "No active session";
        setError(new Error(errorMsg));
        return;
      }

      setStatus("streaming");
      setError(null);

      // Reset watchdog timestamps
      const now = Date.now();
      streamingStartTimeRef.current = now;
      lastChunkTimeRef.current = now;

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
        // Belt-and-suspenders: sendACPPrompt resolves after backend returns,
        // which is after done:true should have been emitted. If status is still
        // streaming (done chunk was lost), force ready and save accumulated messages.
        // In the happy path the done-chunk handler already ran during the await,
        // so this is intentionally redundant — it only takes effect when the done
        // chunk was lost.
        if (updatedMessagesMapRef.current.size > 0) {
          console.log(
            "[useACPChat] Belt-and-suspenders: saving",
            updatedMessagesMapRef.current.size,
            "unsaved messages after sendACPPrompt resolved",
          );
          flushAndReset("ready");
        } else {
          setStatus((prev) => (prev === "streaming" ? "ready" : prev));
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        // If session not found, try to recreate it and retry
        if (
          errorMessage.includes("Session") &&
          errorMessage.includes("not found")
        ) {
          console.log(
            "[useACPChat] Session not found, recreating session and retrying...",
          );
          try {
            const workDir = getWorkingDirectory();
            const newSession = await createACPSession(agentId, workDir, undefined, threadId);
            console.log(
              "[useACPChat] Recreated session:",
              newSession.sessionId,
            );
            setSession(newSession);
            sessionRef.current = newSession;
            // Track the working directory the session was created with
            sessionWorkingDirectoryRef.current = workDir;
            // Retry the prompt with the new session
            await sendACPPrompt(agentId, newSession.sessionId, content);
            if (updatedMessagesMapRef.current.size > 0) {
              flushAndReset("ready");
            } else {
              setStatus((prev) => (prev === "streaming" ? "ready" : prev));
            }
            return;
          } catch (recreateErr) {
            console.error(
              "[useACPChat] Failed to recreate session:",
              recreateErr,
            );
            setError(
              recreateErr instanceof Error
                ? recreateErr
                : new Error(String(recreateErr)),
            );
            setStatus("error");
            onError?.(
              recreateErr instanceof Error
                ? recreateErr
                : new Error(String(recreateErr)),
            );
            return;
          }
        }
        console.error("[useACPChat] Failed to send prompt:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("error");
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [session, agentId, status, onError, onUserMessage, getWorkingDirectory, flushAndReset],
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
    [pendingPermission],
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

  // Function to toggle auto-resume (agentic loop) mode
  const setAutoResumeCallback = useCallback(
    async (enabled: boolean) => {
      if (!session) return;
      await setACPAutoResume(agentId, session.sessionId, enabled);
      // Update local status
      setAgenticLoopStatus((prev) =>
        prev ? { ...prev, autoResume: enabled } : null,
      );
      console.log(
        `[useACPChat] Auto-resume ${enabled ? "enabled" : "disabled"}`,
      );
    },
    [agentId, session],
  );

  // Poll agentic loop status while streaming (to show progress)
  useEffect(() => {
    if (status !== "streaming" || !session) {
      return;
    }

    let mounted = true;

    const pollStatus = async () => {
      if (!mounted || !session) return;

      const loopStatus = await getACPAgenticLoopStatus(
        agentId,
        session.sessionId,
      );
      if (mounted && loopStatus) {
        setAgenticLoopStatus(loopStatus);
      }
    };

    // Poll every 2 seconds while streaming
    const interval = setInterval(pollStatus, 2000);
    pollStatus(); // Initial poll

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [status, session, agentId]);

  // Watchdog: recover from stuck "streaming" state
  // If no chunks arrive for 60s or total streaming exceeds 10 min, force ready
  useEffect(() => {
    if (status !== "streaming") return;

    const CHUNK_TIMEOUT_MS = 60_000; // 60s without a chunk
    const MAX_STREAMING_MS = 10 * 60_000; // 10 min total

    const interval = setInterval(() => {
      const now = Date.now();
      const lastChunk = lastChunkTimeRef.current;
      const streamStart = streamingStartTimeRef.current;

      if (lastChunk && now - lastChunk > CHUNK_TIMEOUT_MS) {
        console.warn(
          `[useACPChat] Watchdog: No chunks received for ${Math.round((now - lastChunk) / 1000)}s, forcing ready`,
        );
        flushAndReset("ready");
        return;
      }

      if (streamStart && now - streamStart > MAX_STREAMING_MS) {
        console.warn(
          `[useACPChat] Watchdog: Streaming exceeded ${MAX_STREAMING_MS / 60_000} min, forcing ready`,
        );
        flushAndReset("ready");
        return;
      }
    }, 5_000); // Check every 5s

    return () => clearInterval(interval);
  }, [status, flushAndReset]);

  return {
    messages,
    status,
    error,
    session,
    pendingPermission,
    agenticLoopStatus,
    sendMessage,
    stop,
    setMessages,
    respondToPermission,
    setSessionModel,
    setSessionConfigOption,
    setSessionMode,
    setAutoResume: setAutoResumeCallback,
  };
}

export default useACPChat;
