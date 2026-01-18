import { E2BSandboxService, SandboxEvent } from "lib/ai/sandbox/e2b-service";
import { validateSession } from "lib/api/auth-helpers";
import {
  createLimitExceededResponse,
  validateSandboxLimit,
} from "lib/api/limit-helpers";
import { SERVICE_CREDIT_COSTS, trackSandboxExecution } from "lib/billing";
import { subscriptionRepository } from "lib/db/repository";

type SandboxAction =
  | "runCode"
  | "runShell"
  | "readFile"
  | "writeFile"
  | "listDir"
  | "deleteFile"
  // Legacy action names for backwards compatibility
  | "execute_code"
  | "run_shell"
  | "read_file"
  | "write_file"
  | "list_dir"
  | "delete_file"
  | "code"
  | "shell"
  | "read"
  | "write"
  | "list"
  | "delete";

type NormalizedAction =
  | "runCode"
  | "runShell"
  | "readFile"
  | "writeFile"
  | "listDir"
  | "deleteFile";

// Normalize legacy action names to new camelCase names
function normalizeAction(action: SandboxAction): NormalizedAction {
  const mapping: Record<string, NormalizedAction> = {
    // Current camelCase names (primary)
    runCode: "runCode",
    runShell: "runShell",
    readFile: "readFile",
    writeFile: "writeFile",
    listDir: "listDir",
    deleteFile: "deleteFile",
    // snake_case names
    execute_code: "runCode",
    run_shell: "runShell",
    read_file: "readFile",
    write_file: "writeFile",
    list_dir: "listDir",
    delete_file: "deleteFile",
    // Legacy single-word names
    code: "runCode",
    shell: "runShell",
    read: "readFile",
    write: "writeFile",
    list: "listDir",
    delete: "deleteFile",
  };
  return mapping[action] || "runCode";
}

interface SandboxRequest {
  action: SandboxAction;
  // For code execution
  code?: string;
  language?: "python" | "javascript" | "typescript";
  // For shell commands
  command?: string;
  // For file operations
  path?: string;
  content?: string;
  // Thread context for persistence
  threadId?: string;
}

export async function POST(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    // Check billing limits before processing
    const limitError = await validateSandboxLimit(auth.userId);
    if (limitError) {
      console.warn(
        `[Billing] Sandbox limit exceeded for user ${auth.userId}: ${limitError.usage}/${limitError.limit}`,
      );
      return createLimitExceededResponse(limitError);
    }

    const body: SandboxRequest = await req.json();
    const action = body.action || "runCode"; // Default to runCode for backwards compatibility

    const sandbox = E2BSandboxService.getInstance();
    const userId = auth.userId;
    const threadId = body.threadId;

    // Normalize action names (support both old and new naming)
    const normalizedAction = normalizeAction(action);

    // Handle streaming actions (runCode, runShell)
    if (normalizedAction === "runCode" || normalizedAction === "runShell") {
      return handleStreamingAction(
        sandbox,
        body,
        normalizedAction,
        userId,
        threadId,
      );
    }

    // Handle non-streaming actions (readFile, writeFile, listDir, deleteFile)
    return handleFileAction(sandbox, body, normalizedAction, userId, threadId);
  } catch (error: any) {
    console.error("Sandbox API Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Handle streaming actions (code execution, shell commands)
 */
function handleStreamingAction(
  sandbox: E2BSandboxService,
  body: SandboxRequest,
  action: "runCode" | "runShell",
  userId: string,
  threadId?: string,
): Response {
  const encoder = new TextEncoder();
  const startTime = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const onEvent = (event: SandboxEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

        // Track usage when execution finishes
        if (event.type === "finish") {
          const executionMs = Date.now() - startTime;
          console.log(
            `[Billing] Recording sandbox ${action} for user ${userId}`,
          );

          trackSandboxExecution({
            userId,
            executionMs,
          }).catch(console.error);

          subscriptionRepository
            .recordUsageEvent({
              userId,
              eventType: "sandbox_execution",
              amount: "1",
              metadata: {
                action,
                language: body.language,
                executionMs,
                creditsConsumed: SERVICE_CREDIT_COSTS.sandboxPerExecution,
              },
            })
            .then(() => console.log("[Billing] Sandbox execution recorded"))
            .catch((err) =>
              console.error("[Billing] Failed to record sandbox:", err),
            );
        }
      };

      try {
        if (action === "runCode") {
          if (!body.code) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ type: "error", value: "Code is required" }) +
                  "\n",
              ),
            );
            controller.close();
            return;
          }

          const language = body.language || "python";

          if (threadId) {
            await sandbox.runCodeWithContext(
              body.code,
              language,
              threadId,
              userId,
              onEvent,
            );
          } else {
            await sandbox.runCodeWithCallback(body.code, language, onEvent);
          }
        } else if (action === "runShell") {
          if (!body.command) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "error",
                  value: "Command is required",
                }) + "\n",
              ),
            );
            controller.close();
            return;
          }

          if (threadId) {
            const result = await sandbox.runCommandWithContext(
              body.command,
              threadId,
              userId,
              onEvent,
            );
            // Send final result
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ type: "command_result", value: result }) +
                  "\n",
              ),
            );
          } else {
            const result = await sandbox.runCommand(body.command, onEvent);
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ type: "command_result", value: result }) +
                  "\n",
              ),
            );
          }

          // Send finish event for shell commands
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "finish" }) + "\n"),
          );
        }

        controller.close();
      } catch (error: any) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: "error", value: error.message }) + "\n",
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Handle non-streaming file operations
 */
async function handleFileAction(
  sandbox: E2BSandboxService,
  body: SandboxRequest,
  action: "readFile" | "writeFile" | "listDir" | "deleteFile",
  userId: string,
  threadId?: string,
): Promise<Response> {
  if (!threadId) {
    return Response.json(
      { error: "Thread context (threadId) is required for file operations" },
      { status: 400 },
    );
  }

  const startTime = Date.now();

  // Track billing for file operations
  const trackFileOperation = async () => {
    const executionMs = Date.now() - startTime;
    console.log(`[Billing] Recording sandbox ${action} for user ${userId}`);

    trackSandboxExecution({
      userId,
      executionMs,
    }).catch(console.error);

    subscriptionRepository
      .recordUsageEvent({
        userId,
        eventType: "sandbox_execution",
        amount: "1",
        metadata: {
          action,
          executionMs,
          creditsConsumed: SERVICE_CREDIT_COSTS.sandboxPerExecution,
        },
      })
      .then(() => console.log("[Billing] Sandbox file operation recorded"))
      .catch((err) =>
        console.error(
          "[Billing] Failed to record sandbox file operation:",
          err,
        ),
      );
  };

  try {
    switch (action) {
      case "readFile": {
        if (!body.path) {
          return Response.json({ error: "Path is required" }, { status: 400 });
        }
        const result = await sandbox.readFileWithContext(
          body.path,
          threadId,
          userId,
        );
        trackFileOperation(); // Track billing
        return Response.json({
          success: true,
          action: "readFile",
          content: result.content,
          size: result.size,
          url: result.url, // Include URL so file shows in Theater Panel
        });
      }

      case "writeFile": {
        if (!body.path) {
          return Response.json({ error: "Path is required" }, { status: 400 });
        }
        if (body.content === undefined) {
          return Response.json(
            { error: "Content is required" },
            { status: 400 },
          );
        }
        const writeResult = await sandbox.writeFileWithContext(
          body.path,
          body.content,
          threadId,
          userId,
        );
        trackFileOperation(); // Track billing
        return Response.json({
          success: true,
          action: "writeFile",
          url: writeResult.url,
          filename: writeResult.filename,
          message: `File written: ${body.path}`,
          size: body.content.length,
        });
      }

      case "listDir": {
        const path = body.path || "/home/user";
        const files = await sandbox.listDirectoryWithContext(
          path,
          threadId,
          userId,
        );
        trackFileOperation(); // Track billing
        return Response.json({
          success: true,
          action: "listDir",
          files,
        });
      }

      case "deleteFile": {
        if (!body.path) {
          return Response.json({ error: "Path is required" }, { status: 400 });
        }
        await sandbox.deleteFileWithContext(body.path, threadId, userId);
        trackFileOperation(); // Track billing
        return Response.json({
          success: true,
          action: "deleteFile",
          message: `File deleted: ${body.path}`,
        });
      }

      default:
        return Response.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (error: any) {
    console.error(`Sandbox file operation error (${action}):`, error);
    return Response.json(
      {
        success: false,
        action,
        error: error.message,
      },
      { status: 500 },
    );
  }
}
