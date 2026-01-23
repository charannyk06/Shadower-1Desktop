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
    console.log(
      "[AI Transport] sendMessages called for chatId:",
      options.chatId,
    );
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
      const stream = this.sendViaIPC({
        messages,
        body,
        id: chatId,
        abortSignal,
      });
      console.log("[AI Transport] Returning IPC stream for chatId:", chatId);
      return stream;
    }

    // Fall back to HTTP for dev mode
    const httpStream = this.sendViaHTTP({ ...options, body });
    console.log("[AI Transport] Returning HTTP stream");
    return httpStream;
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
    let cleanupEnd: (() => void) | undefined;
    let cleanupError: (() => void) | undefined;
    let cleanupStep: (() => void) | undefined;
    let cleanupWarning: (() => void) | undefined;

    const cleanup = () => {
      cleanupChunk?.();
      cleanupEnd?.();
      cleanupError?.();
      cleanupStep?.();
      cleanupWarning?.();
    };

    let streamController: ReadableStreamDefaultController<UIMessageChunk> | null =
      null;
    let streamClosed = false;
    let chunkCounter = 0;

    // Track active reasoning parts to synthesize missing reasoning-start chunks
    // This prevents the "Received reasoning-delta for missing reasoning part" error
    const activeReasoningIds = new Set<string>();

    // Track active text parts to synthesize missing text-start chunks
    // This prevents text-delta chunks from being ignored when text-start is missing
    // (common with thinking models like qwen3 that use extractReasoningMiddleware)
    const activeTextIds = new Set<string>();

    // Async function that ONLY handles prepare/start calls
    // NO listener setup here - that's done synchronously in start()
    const startStreamingAsync = async (
      ctrl: ReadableStreamDefaultController<UIMessageChunk>,
    ) => {
      try {
        // Use the working directory passed via options (preferred) or fall back to store
        // Using options is more reliable as it avoids potential stale state in async callbacks
        const workingDirectory = this.options.workingDirectory ?? appStore.getState().workingDirectory;

        // Prepare the stream (sets up model, tools, but doesn't start streaming)
        console.log("[AI Transport] Preparing stream for thread:", id, "with working directory:", workingDirectory?.path || "not set");
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
          workingDirectory, // Pass the working directory to the AI
        });

        if (prepareResult?.error) {
          console.error("[AI Transport] Prepare failed:", prepareResult.error);
          cleanup();
          ctrl.error(new Error(prepareResult.error));
          return;
        }

        // Start the actual streaming (listeners are already registered!)
        console.log("[AI Transport] Starting stream for thread:", id);
        const startResult = await api.ai.startStream({ threadId: id });

        if (startResult?.error) {
          console.error("[AI Transport] Start failed:", startResult.error);
          cleanup();
          ctrl.error(new Error(startResult.error));
          return;
        }

        console.log(
          "[AI Transport] Stream started successfully for thread:",
          id,
        );
      } catch (error: any) {
        console.error("[AI Transport] Error in stream setup:", error);
        cleanup();
        if (!aborted) {
          try {
            ctrl.error(error);
          } catch {
            // Controller may already be errored
          }
        }
      }
    };

    const stream = new ReadableStream<UIMessageChunk>({
      start(ctrl) {
        console.log(
          "[AI Transport] ReadableStream start() called for thread:",
          id,
        );
        console.log("[AI Transport] Controller desiredSize:", ctrl.desiredSize);
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
        // This is CRITICAL - listeners must be attached before any async work
        // ipcRenderer.on() is synchronous, so listeners are ready immediately
        console.log("[AI Transport] Setting up IPC listeners for thread:", id);

        cleanupChunk = api.ai.onStreamChunk(
          (data: { threadId: string; chunk?: string }) => {
            if (aborted || data.threadId !== id) return;

            const chunkData = data.chunk || "";
            if (chunkData) {
              try {
                const parsed = JSON.parse(chunkData);
                chunkCounter++;
                // Log ALL chunks to debug the missing text-start issue
                const chunkType = parsed?.type;
                const chunkId = parsed?.id;
                console.log(
                  `[AI Transport] Chunk #${chunkCounter} type: "${chunkType}" id: "${chunkId}"`,
                );

                // CRITICAL DEBUG: Track text-start chunks specifically
                if (chunkType === "text-start") {
                  console.log(
                    `[AI Transport] *** TEXT-START CHUNK RECEIVED *** id: ${chunkId}`,
                  );
                }

                // Track finish chunk for debugging title generation issues
                if (chunkType === "finish") {
                  console.log(
                    `[AI Transport] *** FINISH CHUNK RECEIVED *** finishReason: ${parsed.finishReason}`,
                    JSON.stringify(parsed, null, 2),
                  );
                }

                // FIX: Ensure finish and finish-step chunks always have valid usage data to prevent
                // "Cannot read properties of undefined (reading 'inputTokens')" error
                // AI SDK v6 expects nested usage structure: { inputTokens: { total: number }, outputTokens: { total: number } }
                if (chunkType === "finish" || chunkType === "finish-step") {
                  if (!parsed.usage) {
                    parsed.usage = {
                      inputTokens: { total: 0 },
                      outputTokens: { total: 0 },
                    };
                    console.log(
                      `[AI Transport] Added default usage data to ${chunkType} chunk`,
                    );
                  } else {
                    // Ensure inputTokens has the nested structure
                    if (!parsed.usage.inputTokens) {
                      parsed.usage.inputTokens = { total: 0 };
                    } else if (typeof parsed.usage.inputTokens === "number") {
                      parsed.usage.inputTokens = { total: parsed.usage.inputTokens };
                    } else if (!parsed.usage.inputTokens.total) {
                      parsed.usage.inputTokens.total = 0;
                    }
                    // Ensure outputTokens has the nested structure
                    if (!parsed.usage.outputTokens) {
                      parsed.usage.outputTokens = { total: 0 };
                    } else if (typeof parsed.usage.outputTokens === "number") {
                      parsed.usage.outputTokens = { total: parsed.usage.outputTokens };
                    } else if (!parsed.usage.outputTokens.total) {
                      parsed.usage.outputTokens.total = 0;
                    }
                  }
                }

                // REASONING CHUNK FIX: Track reasoning-start and synthesize missing starts
                // The AI SDK throws an error if reasoning-delta arrives before reasoning-start
                // This can happen with some models or when chunks arrive out of order
                if (chunkType === "reasoning-start" && chunkId) {
                  activeReasoningIds.add(chunkId);
                  console.log(
                    `[AI Transport] *** REASONING-START CHUNK *** id: ${chunkId}`,
                  );
                } else if (chunkType === "reasoning-delta" && chunkId) {
                  // Check if we've seen the reasoning-start for this ID
                  if (!activeReasoningIds.has(chunkId)) {
                    // Synthesize a reasoning-start chunk BEFORE processing this delta
                    console.log(
                      `[AI Transport] *** SYNTHESIZING MISSING REASONING-START *** id: ${chunkId}`,
                    );
                    const syntheticStart = {
                      type: "reasoning-start",
                      id: chunkId,
                    };
                    if (streamController && !streamClosed) {
                      try {
                        streamController.enqueue(syntheticStart as UIMessageChunk);
                      } catch (e) {
                        console.error(
                          "[AI Transport] Failed to enqueue synthetic reasoning-start:",
                          e,
                        );
                      }
                    }
                    activeReasoningIds.add(chunkId);
                  }
                } else if (chunkType === "reasoning-end" && chunkId) {
                  // Clean up tracking for completed reasoning
                  activeReasoningIds.delete(chunkId);
                }

                // TEXT CHUNK FIX: Track text-start and synthesize missing starts
                // The AI SDK ignores text-delta if there's no text-start for that part
                // This can happen with thinking models using extractReasoningMiddleware
                if (chunkType === "text-start" && chunkId) {
                  activeTextIds.add(chunkId);
                  console.log(
                    `[AI Transport] *** TEXT-START TRACKED *** id: ${chunkId}`,
                  );
                } else if (chunkType === "text-delta" && chunkId) {
                  // Check if we've seen the text-start for this ID
                  if (!activeTextIds.has(chunkId)) {
                    // Synthesize a text-start chunk BEFORE processing this delta
                    console.log(
                      `[AI Transport] *** SYNTHESIZING MISSING TEXT-START *** id: ${chunkId}`,
                    );
                    const syntheticStart = {
                      type: "text-start",
                      id: chunkId,
                    };
                    if (streamController && !streamClosed) {
                      try {
                        streamController.enqueue(syntheticStart as UIMessageChunk);
                      } catch (e) {
                        console.error(
                          "[AI Transport] Failed to enqueue synthetic text-start:",
                          e,
                        );
                      }
                    }
                    activeTextIds.add(chunkId);
                  }
                } else if (chunkType === "text-end" && chunkId) {
                  // Clean up tracking for completed text
                  activeTextIds.delete(chunkId);
                }

                // Full structure for first 15 chunks and important chunk types
                if (
                  chunkCounter <= 15 ||
                  chunkType === "text-start" ||
                  chunkType === "text-delta" ||
                  chunkType === "start" ||
                  chunkType === "step-start"
                ) {
                  console.log(
                    `[AI Transport] Chunk #${chunkCounter} full structure:`,
                    JSON.stringify(parsed, null, 2),
                  );
                }
                if (streamController && !streamClosed) {
                  try {
                    console.log(
                      "[AI Transport] Before enqueue - desiredSize:",
                      streamController.desiredSize,
                    );
                    streamController.enqueue(parsed as UIMessageChunk);
                    console.log(
                      "[AI Transport] After enqueue - desiredSize:",
                      streamController.desiredSize,
                      "chunk type:",
                      parsed?.type,
                    );
                    if (chunkCounter === 1) {
                      console.log(
                        "[AI Transport] First chunk enqueued directly",
                      );
                    }
                  } catch (enqueueError: any) {
                    if (enqueueError.name !== "RangeError") {
                      console.error(
                        "[AI Transport] Failed to enqueue chunk:",
                        enqueueError,
                      );
                    }
                  }
                } else {
                  console.warn(
                    "[AI Transport] Cannot enqueue - controller:",
                    !!streamController,
                    "closed:",
                    streamClosed,
                  );
                }
              } catch (e) {
                console.error(
                  "[AI Transport] Failed to parse chunk:",
                  e,
                  "chunk:",
                  chunkData,
                );
              }
            } else {
              console.warn(
                "[AI Transport] Received empty chunk for thread:",
                id,
              );
            }
          },
        );

        cleanupEnd = api.ai.onStreamEnd(
          (data: { threadId: string; usage?: any; finishReason?: string }) => {
            if (data.threadId !== id) return;
            console.log(
              "[AI Transport] Stream ended for thread:",
              id,
              "finishReason:",
              data.finishReason,
            );
            // Don't close the stream immediately - give time for the finish chunk to be processed
            // The finish chunk triggers onFinish callback in useChat, and we need to ensure
            // it's fully processed before closing the stream
            setTimeout(() => {
              cleanup();
              streamClosed = true;
              if (!aborted && streamController) {
                try {
                  streamController.close();
                } catch {
                  // Controller may already be closed
                }
              }
            }, 100); // Small delay to ensure finish chunk is processed
          },
        );

        cleanupError = api.ai.onStreamError(
          (data: { threadId: string; error: string }) => {
            if (data.threadId !== id) return;
            console.error(
              "[AI Transport] Stream error for thread:",
              id,
              data.error,
            );
            cleanup();
            try {
              ctrl.error(new Error(data.error));
            } catch {
              // Controller may already be errored
            }
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
              console.warn("[AI Transport] Stream warning:", data.message);
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

        // STEP 3: NOW start async prepare/start (listeners are guaranteed ready!)
        // This is intentionally non-blocking - the stream is returned immediately
        // but listeners are already attached to receive chunks
        startStreamingAsync(ctrl);
      },

      pull(ctrl) {
        console.log(
          "[AI Transport] Stream pull() called - consumer is reading, desiredSize:",
          ctrl.desiredSize,
        );
      },

      cancel() {
        console.log("[AI Transport] Stream cancelled for thread:", id);
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
