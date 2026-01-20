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
      return this.sendViaIPC({ messages, body, id: chatId, abortSignal });
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

    const cleanup = () => {
      cleanupChunk?.();
      cleanupEnd?.();
      cleanupError?.();
    };

    const stream = new ReadableStream<UIMessageChunk>({
      start(ctrl) {
        // Set up abort handler
        abortSignal?.addEventListener("abort", () => {
          aborted = true;
          api.ai?.abort?.(id);
          cleanup();
          try {
            ctrl.close();
          } catch {
            // Controller may already be closed
          }
        });

        // Set up IPC listeners
        cleanupChunk = api.ai.onStreamChunk(
          (data: { threadId: string; chunk?: string }) => {
            if (aborted || data.threadId !== id) return;

            // Parse the JSON chunk and emit as UIMessageChunk
            const chunkData = data.chunk || "";
            if (chunkData) {
              try {
                const parsed = JSON.parse(chunkData);
                ctrl.enqueue(parsed as UIMessageChunk);
              } catch (e) {
                console.warn("[AI Transport] Failed to parse chunk:", e);
              }
            }
          },
        );

        cleanupEnd = api.ai.onStreamEnd(
          (data: { threadId: string; usage?: any; finishReason?: string }) => {
            if (data.threadId !== id) return;
            cleanup();
            if (!aborted) {
              try {
                ctrl.close();
              } catch {
                // Controller may already be closed
              }
            }
          },
        );

        cleanupError = api.ai.onStreamError(
          (data: { threadId: string; error: string }) => {
            if (data.threadId !== id) return;
            cleanup();
            try {
              ctrl.error(new Error(data.error));
            } catch {
              // Controller may already be errored
            }
          },
        );

        // Start the stream request
        api.ai
          .stream({
            threadId: id,
            messages,
            chatModel: requestBody.chatModel,
            toolChoice: requestBody.toolChoice,
            allowedAppDefaultToolkit: requestBody.allowedAppDefaultToolkit,
            allowedMcpServers: requestBody.allowedMcpServers,
            mentions: requestBody.mentions,
            message: requestBody.message,
            imageTool: requestBody.imageTool,
            attachments: requestBody.attachments,
          })
          .then((result: { error?: string }) => {
            if (result?.error) {
              cleanup();
              try {
                ctrl.error(new Error(result.error));
              } catch {
                // Controller may already be errored
              }
            }
          })
          .catch((error: Error) => {
            cleanup();
            if (!aborted) {
              try {
                ctrl.error(error);
              } catch {
                // Controller may already be errored
              }
            }
          });
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
   * Parse SSE stream into UIMessageChunks
   */
  private parseSSEStream(
    stream: ReadableStream<Uint8Array>,
  ): ReadableStream<UIMessageChunk> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    return new ReadableStream<UIMessageChunk>({
      async pull(controller) {
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
