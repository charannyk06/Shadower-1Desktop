/**
 * Electron IPC-based transport for workflow generation
 * Handles streaming communication between the renderer and main process
 * for AI-powered workflow generation with tool calling support
 */

import type {
  ChatTransport,
  UIMessage,
  UIMessageChunk,
  ChatRequestOptions,
} from "ai";

export interface WorkflowTransportConfig {
  availableTools: any[];
  currentWorkflowState: { nodes: any[]; edges: any[] };
  chatModel: { provider: string; model: string };
}

/**
 * Custom transport for workflow generation that uses Electron IPC
 * instead of HTTP fetch. This enables full streaming with tool calling
 * for agentic workflow creation.
 */
export class ElectronWorkflowTransport implements ChatTransport<UIMessage> {
  private config: WorkflowTransportConfig;
  private currentSessionId: string | null = null;
  private cleanupFunctions: Array<() => void> = [];

  constructor(config: WorkflowTransportConfig) {
    this.config = config;
  }

  /**
   * Update the transport configuration
   */
  updateConfig(config: Partial<WorkflowTransportConfig>) {
    this.config = { ...this.config, ...config };
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
    const { messages, abortSignal, chatId } = options;

    // Clean up any existing listeners
    this.cleanup();

    const api = (window as any).electronAPI?.ai;
    if (!api?.workflowGenerate) {
      throw new Error("Electron workflow API not available");
    }

    // Track abort and cleanup functions
    let aborted = false;
    let cleanupChunk: (() => void) | undefined;
    let cleanupEnd: (() => void) | undefined;
    let cleanupError: (() => void) | undefined;
    let cleanupStep: (() => void) | undefined;

    const cleanup = () => {
      cleanupChunk?.();
      cleanupEnd?.();
      cleanupError?.();
      cleanupStep?.();
    };

    let streamController: ReadableStreamDefaultController<UIMessageChunk> | null =
      null;
    let streamClosed = false;

    // Async function to start the workflow generation
    const startWorkflowAsync = async (
      ctrl: ReadableStreamDefaultController<UIMessageChunk>,
    ) => {
      try {
        // Convert UIMessage parts to a format suitable for the main process
        const serializedMessages = messages.map((m) => {
          // Extract text content from parts
          let textContent = "";
          if (m.parts) {
            for (const part of m.parts) {
              if (part.type === "text" && "text" in part) {
                textContent += (part as any).text;
              }
            }
          }
          return {
            id: m.id,
            role: m.role,
            content: textContent,
            parts: m.parts,
          };
        });

        // Start workflow generation
        const result = await api.workflowGenerate({
          messages: serializedMessages,
          availableTools: this.config.availableTools,
          currentWorkflowState: this.config.currentWorkflowState,
          chatModel: this.config.chatModel,
        });

        if (result.error) {
          console.error(
            "[Workflow Transport] Generation failed:",
            result.error,
          );
          cleanup();
          ctrl.error(new Error(result.error));
          return;
        }

        this.currentSessionId = result.sessionId || null;
        console.log(
          "[Workflow Transport] Started session:",
          this.currentSessionId,
        );
      } catch (error: any) {
        console.error("[Workflow Transport] Error starting workflow:", error);
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
      start: (ctrl) => {
        console.log(
          "[Workflow Transport] Stream start() called for chatId:",
          chatId,
        );
        streamController = ctrl;

        // Set up abort handler
        abortSignal?.addEventListener("abort", () => {
          aborted = true;
          if (this.currentSessionId) {
            api.workflowAbort?.(this.currentSessionId);
          }
          cleanup();
          try {
            ctrl.close();
            streamClosed = true;
          } catch {
            // Controller may already be closed
          }
        });

        // Register IPC listeners SYNCHRONOUSLY before starting async work
        cleanupChunk = api.onWorkflowChunk?.(
          (data: { sessionId: string; chunk: string }) => {
            if (aborted || data.sessionId !== this.currentSessionId) return;

            const chunkData = data.chunk || "";
            if (chunkData) {
              try {
                const parsed = JSON.parse(chunkData);
                console.log(
                  "[Workflow Transport] Received chunk type:",
                  parsed?.type,
                );
                if (streamController && !streamClosed) {
                  try {
                    streamController.enqueue(parsed as UIMessageChunk);
                  } catch (enqueueError: any) {
                    if (enqueueError.name !== "RangeError") {
                      console.error(
                        "[Workflow Transport] Failed to enqueue chunk:",
                        enqueueError,
                      );
                    }
                  }
                }
              } catch (e) {
                console.error(
                  "[Workflow Transport] Failed to parse chunk:",
                  e,
                  "chunk:",
                  chunkData,
                );
              }
            }
          },
        );

        cleanupEnd = api.onWorkflowEnd?.(
          (data: { sessionId: string; finishReason?: string }) => {
            if (data.sessionId !== this.currentSessionId) return;
            console.log(
              "[Workflow Transport] Stream ended, finishReason:",
              data.finishReason,
            );
            cleanup();
            streamClosed = true;
            if (!aborted && streamController) {
              try {
                streamController.close();
              } catch {
                // Controller may already be closed
              }
            }
          },
        );

        cleanupError = api.onWorkflowError?.(
          (data: { sessionId: string; error: string }) => {
            if (data.sessionId !== this.currentSessionId) return;
            console.error("[Workflow Transport] Stream error:", data.error);
            cleanup();
            try {
              ctrl.error(new Error(data.error));
            } catch {
              // Controller may already be errored
            }
          },
        );

        cleanupStep = api.onWorkflowStep?.(
          (data: {
            sessionId: string;
            stepType: string;
            toolCallCount: number;
          }) => {
            if (data.sessionId !== this.currentSessionId) return;
            console.log(
              "[Workflow Transport] Step:",
              data.stepType,
              "tools:",
              data.toolCallCount,
            );
          },
        );

        // Store cleanup functions
        if (cleanupChunk) this.cleanupFunctions.push(cleanupChunk);
        if (cleanupEnd) this.cleanupFunctions.push(cleanupEnd);
        if (cleanupError) this.cleanupFunctions.push(cleanupError);
        if (cleanupStep) this.cleanupFunctions.push(cleanupStep);

        // Start async workflow generation (listeners are already registered!)
        startWorkflowAsync(ctrl);
      },

      pull(_ctrl) {
        // Consumer is reading, nothing special needed
      },

      cancel: () => {
        console.log("[Workflow Transport] Stream cancelled");
        aborted = true;
        cleanup();
        if (this.currentSessionId) {
          api.workflowAbort?.(this.currentSessionId);
        }
      },
    });

    return stream;
  }

  /**
   * Reconnect to an existing stream (not supported for workflow transport)
   */
  async reconnectToStream(
    _options: {
      chatId: string;
    } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    // Workflow transport doesn't support reconnection
    return null;
  }

  /**
   * Clean up IPC listeners
   */
  private cleanup() {
    for (const fn of this.cleanupFunctions) {
      try {
        fn();
      } catch {
        // Ignore cleanup errors
      }
    }
    this.cleanupFunctions = [];
    this.currentSessionId = null;
  }
}

/**
 * Create a workflow transport instance with the given configuration
 */
export function createWorkflowTransport(
  config: WorkflowTransportConfig,
): ElectronWorkflowTransport {
  return new ElectronWorkflowTransport(config);
}
