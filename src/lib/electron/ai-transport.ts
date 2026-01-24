/**
 * Electron IPC Transport for AI SDK useChat
 *
 * This transport sends chat requests through Electron IPC instead of HTTP,
 * enabling:
 * - No localhost ports exposed (secure desktop app)
 * - 2x faster than HTTP (IPC is direct)
 * - Works with cloud AND local models
 * - Browser can't access the AI stream
 *
 * How it works:
 * - Renderer: useChat() -> ElectronIPCTransport -> IPC -> Main Process
 * - Main: Receives request -> streamText() -> IPC stream chunks back
 * - Renderer: Receives chunks -> useChat() displays them
 */

import type {
  ChatTransport,
  UIMessage,
  UIMessageChunk,
  ChatRequestOptions,
} from "ai";
import type { ChatApiSchemaRequestBody } from "app-types/chat";
import { appStore } from "@/app/store";

// Type for prepare request function
type PrepareSendMessagesRequestFn = (params: {
  messages: UIMessage[];
  body: Record<string, unknown>;
  id: string;
}) => { body: Record<string, unknown> };

// Type for the transport options
export interface ElectronIPCTransportOptions {
  api?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  body?: Record<string, unknown>;
  prepareSendMessagesRequest?: PrepareSendMessagesRequestFn;
  /**
   * Working directory to use for file operations.
   * Pass this explicitly to avoid potential stale state issues when reading from the store
   * during async callbacks.
   */
  workingDirectory?: { path: string; name: string };
}

/**
 * Check if we're running in Electron with IPC support
 */
export function isElectronWithIPC(): boolean {
  if (typeof window === "undefined") return false;
  const api = (window as any).electronAPI;
  return !!(api && typeof api.ai?.stream === "function");
}

/**
 * Check if Electron IPC transport should be used
 *
 * ALWAYS use IPC when running in Electron - no HTTP fallback!
 * This is a desktop app, not a web app. IPC is:
 * - Faster (no HTTP overhead)
 * - More secure (no localhost ports exposed)
 * - Works in both dev and production
 */
export function shouldUseElectronTransport(): boolean {
  if (typeof window === "undefined") return false;

  // If we have Electron IPC available, ALWAYS use it
  // This is a desktop app - we don't need HTTP fallback
  return isElectronWithIPC();
}

/**
 * Custom transport for AI SDK that uses Electron IPC instead of HTTP
 *
 * Implements ChatTransport interface directly for maximum compatibility
 * with AI SDK v6's transport system.
 */
export class ElectronIPCTransport implements ChatTransport<UIMessage> {
  private options: ElectronIPCTransportOptions;
  private api: string;
  private prepareSendMessagesRequest?: PrepareSendMessagesRequestFn;

  constructor(options: ElectronIPCTransportOptions = {}) {
    this.options = options;
    this.api = options.api || "/api/chat";
    this.prepareSendMessagesRequest = options.prepareSendMessagesRequest;
  }

  /**
   * Send messages - the main method required by ChatTransport
   */
  async sendMessages(
    options: {
      trigger: "submit-message" | "regenerate-message";
      chatId: string;
      messageId: string | undefined;
      messages: UIMessage[];
      abortSignal: AbortSignal | undefined;
    } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal, body: optionsBody, chatId } = options;

    // Prepare the body using the provided function if available
    let body: Record<string, unknown> = {
      ...(this.options.body || {}),
      ...(optionsBody || {}),
    };

    if (this.prepareSendMessagesRequest) {
      const prepared = this.prepareSendMessagesRequest({
        messages,
        body,
        id: chatId,
      });
      body = prepared.body;
    }

    // In Electron production (static export), use IPC
    if (shouldUseElectronTransport()) {
      return this.sendViaIPC({
        messages,
        body,
        id: chatId,
        abortSignal,
      });
    }

    // Fall back to HTTP for dev mode
    return this.sendViaHTTP({ ...options, body });
  }

  /**
   * Reconnect to an existing stream (not supported for IPC transport)
   */
  async reconnectToStream(
    _options: {
      chatId: string;
    } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    // IPC transport doesn't support reconnection
    // The stream is managed by the main process
    return null;
  }

  /**
   * Send via HTTP (for dev mode with Next.js hot reload)
   */
  private async sendViaHTTP(options: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
    body?: Record<string, unknown>;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal, body } = options;

    const response = await fetch(this.api, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.options.headers,
      },
      credentials: this.options.credentials,
      body: JSON.stringify({
        messages,
        ...body,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    // Parse the SSE stream into UIMessageChunks
    return this.parseSSEStream(response.body);
  }

  /**
   * Send via Electron IPC - pure IPC, no HTTP
   *
   * CRITICAL: Listeners MUST be registered SYNCHRONOUSLY in start() callback
   * before any async work begins. This prevents the race condition where
   * chunks arrive before listeners are attached.
   *
   * Flow:
   * 1. start() is called synchronously when stream is created
   * 2. Register ALL IPC listeners synchronously (they attach immediately)
   * 3. THEN call async prepare/start functions (non-blocking)
   * 4. Chunks arrive via IPC and are enqueued to the stream
   */
  private sendViaIPC({
    messages,
    body,
    id,
    abortSignal,
  }: {
    messages: UIMessage[];
    body: Record<string, unknown>;
    id: string;
    abortSignal?: AbortSignal;
  }): ReadableStream<UIMessageChunk> {
    const api = (window as any).electronAPI;
    const requestBody = body as ChatApiSchemaRequestBody;

    // Track abort and cleanup functions
    let aborted = false;
    let cleanupChunk: (() => void) | undefined;
    let cleanupChunkBatch: (() => void) | undefined;
    let cleanupEnd: (() => void) | undefined;
    let cleanupError: (() => void) | undefined;
    let cleanupStep: (() => void) | undefined;
    let cleanupWarning: (() => void) | undefined;

    const cleanup = () => {
      cleanupChunk?.();
      cleanupChunkBatch?.();
      cleanupEnd?.();
      cleanupError?.();
      cleanupStep?.();
      cleanupWarning?.();
    };

    let streamController: ReadableStreamDefaultController<UIMessageChunk> | null =
      null;
    let streamClosed = false;

    // Track active reasoning parts to synthesize missing reasoning-start chunks
    // This prevents the "Received reasoning-delta for missing reasoning part" error
    const activeReasoningIds = new Set<string>();

    // Track active text parts to synthesize missing text-start chunks
    // This prevents text-delta chunks from being ignored when text-start is missing
    // (common with thinking models like qwen3 that use extractReasoningMiddleware)
    const activeTextIds = new Set<string>();

    // Async function that handles prepare/start calls
    const startStreamingAsync = async (
      ctrl: ReadableStreamDefaultController<UIMessageChunk>,
    ) => {
      try {
        const workingDirectory = this.options.workingDirectory ?? appStore.getState().workingDirectory;

        // Prepare the stream
        const prepareResult = await api.ai.stream({
          threadId: id,
          messages,
          chatModel: requestBody.chatModel,
          toolChoice: requestBody.toolChoice,
          chatMode: requestBody.chatMode,
          allowedAppDefaultToolkit: requestBody.allowedAppDefaultToolkit,
          allowedMcpServers: requestBody.allowedMcpServers,
          mentions: requestBody.mentions,
          message: requestBody.message,
          imageTool: requestBody.imageTool,
          attachments: requestBody.attachments,
          workingDirectory,
        });

        if (prepareResult?.error) {
          cleanup();
          ctrl.error(new Error(prepareResult.error));
          return;
        }

        // Start the actual streaming
        const startResult = await api.ai.startStream({ threadId: id });

        if (startResult?.error) {
          cleanup();
          ctrl.error(new Error(startResult.error));
          return;
        }
      } catch (error: any) {
        cleanup();
        if (!aborted) {
          try {
            ctrl.error(error);
          } catch {}
        }
      }
    };

    const stream = new ReadableStream<UIMessageChunk>({
      start(ctrl) {
        streamController = ctrl;

        // STEP 1: Set up abort handler SYNCHRONOUSLY
        abortSignal?.addEventListener("abort", () => {
          aborted = true;
          api.ai?.abort?.(id);
          cleanup();
          try {
            ctrl.close();
            streamClosed = true;
          } catch {
            // Controller may already be closed
          }
        });

        // STEP 2: Register ALL IPC listeners SYNCHRONOUSLY
        // ipcRenderer.on() is synchronous, so listeners are ready immediately

        cleanupChunk = api.ai.onStreamChunk(
          (data: { threadId: string; chunk?: string }) => {
            if (aborted || data.threadId !== id) return;

            const chunkData = data.chunk || "";
            if (!chunkData) return;

            try {
              const parsed = JSON.parse(chunkData);
              const chunkType = parsed?.type;
              const chunkId = parsed?.id;

              // Ensure finish chunks have valid usage data
              if (chunkType === "finish" || chunkType === "finish-step") {
                if (!parsed.usage) {
                  parsed.usage = {
                    inputTokens: { total: 0 },
                    outputTokens: { total: 0 },
                  };
                } else {
                  if (!parsed.usage.inputTokens) {
                    parsed.usage.inputTokens = { total: 0 };
                  } else if (typeof parsed.usage.inputTokens === "number") {
                    parsed.usage.inputTokens = { total: parsed.usage.inputTokens };
                  }
                  if (!parsed.usage.outputTokens) {
                    parsed.usage.outputTokens = { total: 0 };
                  } else if (typeof parsed.usage.outputTokens === "number") {
                    parsed.usage.outputTokens = { total: parsed.usage.outputTokens };
                  }
                }
              }

              // Handle reasoning chunks - synthesize missing starts
              if (chunkType === "reasoning-start" && chunkId) {
                activeReasoningIds.add(chunkId);
              } else if (chunkType === "reasoning-delta" && chunkId) {
                if (!activeReasoningIds.has(chunkId)) {
                  if (streamController && !streamClosed) {
                    try {
                      streamController.enqueue({ type: "reasoning-start", id: chunkId } as UIMessageChunk);
                    } catch {}
                  }
                  activeReasoningIds.add(chunkId);
                }
              } else if (chunkType === "reasoning-end" && chunkId) {
                activeReasoningIds.delete(chunkId);
              }

              // Handle text chunks - synthesize missing starts
              if (chunkType === "text-start" && chunkId) {
                activeTextIds.add(chunkId);
              } else if (chunkType === "text-delta" && chunkId) {
                if (!activeTextIds.has(chunkId)) {
                  if (streamController && !streamClosed) {
                    try {
                      streamController.enqueue({ type: "text-start", id: chunkId } as UIMessageChunk);
                    } catch {}
                  }
                  activeTextIds.add(chunkId);
                }
              } else if (chunkType === "text-end" && chunkId) {
                activeTextIds.delete(chunkId);
              }

              // Enqueue the chunk
              if (streamController && !streamClosed) {
                try {
                  streamController.enqueue(parsed as UIMessageChunk);
                } catch {}
              }
            } catch {
              // Skip invalid chunks
            }
          },
        );

        // PERFORMANCE: Handle batched chunks for faster streaming
        if (api.ai.onStreamChunkBatch) {
          cleanupChunkBatch = api.ai.onStreamChunkBatch(
            (data: { threadId: string; chunks: any[] }) => {
              if (aborted || data.threadId !== id) return;

              for (const chunk of data.chunks) {
                try {
                  const chunkType = chunk?.type;
                  const chunkId = chunk?.id;

                  // Handle usage data for finish chunks
                  if (chunkType === "finish" || chunkType === "finish-step") {
                    if (!chunk.usage) {
                      chunk.usage = {
                        inputTokens: { total: 0 },
                        outputTokens: { total: 0 },
                      };
                    } else {
                      if (!chunk.usage.inputTokens) {
                        chunk.usage.inputTokens = { total: 0 };
                      } else if (typeof chunk.usage.inputTokens === "number") {
                        chunk.usage.inputTokens = { total: chunk.usage.inputTokens };
                      }
                      if (!chunk.usage.outputTokens) {
                        chunk.usage.outputTokens = { total: 0 };
                      } else if (typeof chunk.usage.outputTokens === "number") {
                        chunk.usage.outputTokens = { total: chunk.usage.outputTokens };
                      }
                    }
                  }

                  // Handle reasoning chunks
                  if (chunkType === "reasoning-start" && chunkId) {
                    activeReasoningIds.add(chunkId);
                  } else if (chunkType === "reasoning-delta" && chunkId) {
                    if (!activeReasoningIds.has(chunkId)) {
                      if (streamController && !streamClosed) {
                        try {
                          streamController.enqueue({ type: "reasoning-start", id: chunkId } as any);
                        } catch {}
                      }
                      activeReasoningIds.add(chunkId);
                    }
                  } else if (chunkType === "reasoning-end" && chunkId) {
                    activeReasoningIds.delete(chunkId);
                  }

                  // Handle text chunks
                  if (chunkType === "text-start" && chunkId) {
                    activeTextIds.add(chunkId);
                  } else if (chunkType === "text-delta" && chunkId) {
                    if (!activeTextIds.has(chunkId)) {
                      if (streamController && !streamClosed) {
                        try {
                          streamController.enqueue({ type: "text-start", id: chunkId } as any);
                        } catch {}
                      }
                      activeTextIds.add(chunkId);
                    }
                  } else if (chunkType === "text-end" && chunkId) {
                    activeTextIds.delete(chunkId);
                  }

                  // Enqueue the chunk
                  if (streamController && !streamClosed) {
                    try {
                      streamController.enqueue(chunk as any);
                    } catch {}
                  }
                } catch {
                  // Skip invalid chunks
                }
              }
            },
          );
        }

        cleanupEnd = api.ai.onStreamEnd(
          (data: { threadId: string; usage?: any; finishReason?: string }) => {
            if (data.threadId !== id) return;
            // Small delay to ensure finish chunk is processed
            setTimeout(() => {
              cleanup();
              streamClosed = true;
              if (!aborted && streamController) {
                try {
                  streamController.close();
                } catch {}
              }
            }, 50);
          },
        );

        cleanupError = api.ai.onStreamError(
          (data: { threadId: string; error: string }) => {
            if (data.threadId !== id) return;
            cleanup();
            try {
              ctrl.error(new Error(data.error));
            } catch {}
          },
        );

        if (api.ai.onStreamStep) {
          cleanupStep = api.ai.onStreamStep(
            (data: {
              threadId: string;
              stepType: string;
              toolCallCount: number;
            }) => {
              if (data.threadId !== id) return;
            },
          );
        }

        // Listen for warnings (e.g., tool format not supported)
        if (api.ai.onStreamWarning) {
          cleanupWarning = api.ai.onStreamWarning(
            (data: { threadId: string; message: string; type?: string }) => {
              if (data.threadId !== id) return;
              // Import toast dynamically to avoid circular deps
              import("sonner").then(({ toast }) => {
                toast.warning("Model Limitation", {
                  description: data.message,
                  duration: 8000,
                });
              });
            },
          );
        }

        // STEP 3: Start async prepare/start (listeners are guaranteed ready!)
        startStreamingAsync(ctrl);
      },

      pull() {
        // No-op: stream is push-based via IPC
      },

      cancel() {
        aborted = true;
        cleanup();
        api.ai?.abort?.(id);
      },
    });

    return stream;
  }

  /**
   * Ensure finish/finish-step chunks have valid usage data
   * Prevents "Cannot read properties of undefined (reading 'inputTokens')" error
   *
   * AI SDK v6 expects nested usage structure:
   * {
   *   inputTokens: { total: number, noCache?: number, cacheRead?: number, cacheWrite?: number },
   *   outputTokens: { total: number, reasoning?: number }
   * }
   */
  private ensureUsageData(parsed: any): void {
    if (parsed?.type === "finish" || parsed?.type === "finish-step") {
      if (!parsed.usage) {
        // Create the full nested structure that AI SDK v6 expects
        parsed.usage = {
          inputTokens: { total: 0 },
          outputTokens: { total: 0 },
        };
      } else {
        // Ensure inputTokens has the nested structure
        if (!parsed.usage.inputTokens) {
          parsed.usage.inputTokens = { total: 0 };
        } else if (typeof parsed.usage.inputTokens === "number") {
          // Convert flat number to nested structure
          parsed.usage.inputTokens = { total: parsed.usage.inputTokens };
        } else if (!parsed.usage.inputTokens.total) {
          parsed.usage.inputTokens.total = 0;
        }

        // Ensure outputTokens has the nested structure
        if (!parsed.usage.outputTokens) {
          parsed.usage.outputTokens = { total: 0 };
        } else if (typeof parsed.usage.outputTokens === "number") {
          // Convert flat number to nested structure
          parsed.usage.outputTokens = { total: parsed.usage.outputTokens };
        } else if (!parsed.usage.outputTokens.total) {
          parsed.usage.outputTokens.total = 0;
        }
      }
    }
  }

  /**
   * Parse SSE stream into UIMessageChunks
   */
  private parseSSEStream(
    stream: ReadableStream<Uint8Array>,
  ): ReadableStream<UIMessageChunk> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    return new ReadableStream<UIMessageChunk>({
      pull: async (controller) => {
        try {
          const { done, value } = await reader.read();

          if (done) {
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const jsonStr = line.slice(6);
              if (jsonStr === "[DONE]") {
                controller.close();
                return;
              }
              try {
                const parsed = JSON.parse(jsonStr);
                // FIX: Ensure usage data exists on finish chunks
                this.ensureUsageData(parsed);
                controller.enqueue(parsed as UIMessageChunk);
              } catch {
                // Skip invalid JSON
              }
            }
          }
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        reader.cancel();
      },
    });
  }
}

/**
 * Get the appropriate transport based on environment
 */
export function getTransport(
  options?: ElectronIPCTransportOptions,
): ElectronIPCTransport {
  return new ElectronIPCTransport(options);
}

/**
 * Create transport with custom options
 * Use this in chat-bot.tsx to create the transport with options
 */
export function createChatTransport(
  options?: ElectronIPCTransportOptions,
): ElectronIPCTransport {
  return new ElectronIPCTransport(options);
}
