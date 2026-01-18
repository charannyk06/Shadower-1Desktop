import { Tool, tool as createTool } from "ai";
import { JSONSchema7 } from "json-schema";
import {
  CommandResult,
  E2BSandboxService,
  FileInfo,
  SandboxEvent,
} from "lib/ai/sandbox/e2b-service";
import { SERVICE_CREDIT_COSTS, trackSandboxExecution } from "lib/billing";
import {
  e2bCostTracker,
  QuotaExceededError,
} from "lib/billing/e2b-cost-tracker";
import { subscriptionRepository } from "lib/db/repository";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";

// Maximum output size to prevent context overflow (approx 2k tokens)
const MAX_OUTPUT_SIZE = 8000;
const MAX_LOG_LINES = 50;

/**
 * Truncates sandbox output to prevent context overflow and agent confusion
 */
function truncateSandboxResult(result: SandboxResult): SandboxResult {
  const truncated = { ...result };

  // Truncate logs array
  if (truncated.logs && truncated.logs.length > MAX_LOG_LINES) {
    const removed = truncated.logs.length - MAX_LOG_LINES;
    truncated.logs = [
      {
        type: "info",
        value: `[... ${removed} earlier log entries truncated ...]`,
      },
      ...truncated.logs.slice(-MAX_LOG_LINES),
    ];
  }

  // Truncate stdout
  if (truncated.stdout && truncated.stdout.length > MAX_OUTPUT_SIZE) {
    truncated.stdout =
      truncated.stdout.substring(0, MAX_OUTPUT_SIZE) +
      `\n\n[... output truncated, ${truncated.stdout.length - MAX_OUTPUT_SIZE} more characters ...]`;
  }

  // Truncate stderr
  if (truncated.stderr && truncated.stderr.length > MAX_OUTPUT_SIZE) {
    truncated.stderr =
      truncated.stderr.substring(0, MAX_OUTPUT_SIZE) +
      `\n\n[... error output truncated, ${truncated.stderr.length - MAX_OUTPUT_SIZE} more characters ...]`;
  }

  // Truncate file content
  if (truncated.content && truncated.content.length > MAX_OUTPUT_SIZE) {
    truncated.content =
      truncated.content.substring(0, MAX_OUTPUT_SIZE) +
      `\n\n[... content truncated, ${truncated.content.length - MAX_OUTPUT_SIZE} more characters ...]`;
  }

  // Truncate error message
  if (truncated.error && truncated.error.length > MAX_OUTPUT_SIZE) {
    truncated.error =
      truncated.error.substring(0, MAX_OUTPUT_SIZE) +
      `\n\n[... error truncated ...]`;
  }

  return truncated;
}

/**
 * Unified sandbox tool schema
 * Combines code execution, shell commands, and file operations
 */
export const unifiedSandboxSchema: JSONSchema7 = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "runCode",
        "runShell",
        "readFile",
        "writeFile",
        "listDir",
        "deleteFile",
      ],
      description: `The action to perform. IMPORTANT: Each action requires specific parameters:
- runCode: REQUIRES 'code' parameter (and optionally 'language')
- runShell: REQUIRES 'command' parameter
- readFile: REQUIRES 'path' parameter
- writeFile: REQUIRES 'path' AND 'content' parameters
- listDir: OPTIONAL 'path' parameter (defaults to /home/user)
- deleteFile: REQUIRES 'path' parameter`,
    },
    language: {
      type: "string",
      enum: ["python", "javascript", "typescript"],
      description:
        "Programming language for code execution. REQUIRED when action is 'runCode'. Default: python",
    },
    code: {
      type: "string",
      description: `The code to execute. REQUIRED when action is 'runCode'.

For Python: Full PyPI package support, can create files, charts, etc.
For JavaScript/TypeScript: Node.js environment with npm packages.`,
    },
    command: {
      type: "string",
      description: `The shell command to execute. REQUIRED when action is 'runShell'.
Examples: "npm install lodash", "pip install pandas", "ls -la /home/user"`,
    },
    path: {
      type: "string",
      description:
        "File or directory path. REQUIRED for readFile, writeFile, deleteFile. Optional for listDir (defaults to /home/user).",
    },
    content: {
      type: "string",
      description:
        "Content to write to the file. REQUIRED when action is 'writeFile'.",
    },
  },
  required: ["action"],
};

/**
 * Context for sandbox execution
 */
export interface SandboxExecutionContext {
  threadId?: string;
  userId?: string;
  /** Optional data stream for real-time UI updates */
  dataStream?: import("ai").UIMessageStreamWriter;
  /** Optional chat model to use for AI operations */
  chatModel?: import("app-types/chat").ChatModel;
}

/**
 * Result type for unified sandbox tool
 */
export interface SandboxResult {
  success: boolean;
  action: string;
  // For code execution
  results?: any[];
  logs?: any[];
  error?: string;
  // For shell commands
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  // For file operations
  content?: string;
  size?: number;
  files?: FileInfo[];
  message?: string;
}

/**
 * Creates a unified sandbox tool with optional thread context for file persistence
 *
 * @deprecated This tool is deprecated. Use createFragment for web apps, dashboards, games, and documents.
 * The sandbox tool will be removed in Phase 2. For now, it's kept for backward compatibility.
 */
export function createUnifiedSandboxTool(
  context?: SandboxExecutionContext,
): Tool {
  return createTool({
    description: `Full Linux sandbox for code execution, shell commands, and file management.

🚨 CRITICAL RULES - READ CAREFULLY 🚨

FOR CREATING FILES (HTML, JS, CSS, Python, etc.):
- ALWAYS use "writeFile" action to CREATE files
- NEVER use "runShell" to create files with echo/cat/heredoc
- NEVER use bash commands to write files
- Example: { "action": "writeFile", "path": "/home/user/game.html", "content": "<!DOCTYPE html>..." }

FOR EXECUTING CODE:
- ALWAYS use "runCode" to execute Python/JavaScript/TypeScript CODE
- NEVER use "runShell" to execute code - only use "runShell" for shell commands like npm, pip, git, etc.
- Example: { "action": "runCode", "language": "python", "code": "print('hello')" }

FOR SHELL COMMANDS ONLY:
- Use "runShell" ONLY for: npm install, pip install, git clone, ls, cd, etc.
- NEVER use "runShell" to create files or execute code
- Example: { "action": "runShell", "command": "npm install lodash" }

WHEN TO USE EACH ACTION:
- "writeFile": CREATE files (HTML, JS, CSS, Python, etc). REQUIRES: action="writeFile" + path + content
- "runCode": EXECUTE Python/JavaScript/TypeScript CODE. REQUIRES: action="runCode" + code + language
- "runShell": Run shell commands ONLY (npm, pip, git, etc). REQUIRES: action="runShell" + command
- "readFile": Read file contents. REQUIRES: action="readFile" + path
- "listDir": List directory. REQUIRES: action="listDir" (path optional)
- "deleteFile": Remove files. REQUIRES: action="deleteFile" + path

FOR CREATING APPS/GAMES - STEP BY STEP:
1. FIRST: Use "writeFile" to create each file (HTML, JS, CSS, Python, etc.)
   Example: { "action": "writeFile", "path": "/home/user/snake.html", "content": "<!DOCTYPE html>..." }
2. THEN: Use "runCode" to execute/test the code if needed (NOT runShell!)
3. Files persist in /home/user directory across executions

CORRECT EXAMPLES:
✅ { "action": "writeFile", "path": "/home/user/game.html", "content": "<!DOCTYPE html>..." }
✅ { "action": "runCode", "language": "python", "code": "print('hello')" }
✅ { "action": "runShell", "command": "npm install lodash" }

WRONG EXAMPLES (DO NOT DO THIS):
❌ { "action": "runShell", "command": "cat > game.html << 'EOF' ..." }  // WRONG: Use writeFile instead
❌ { "action": "runShell", "command": "python -c 'print(hello)'" }  // WRONG: Use runCode instead`,
    inputSchema: jsonSchemaToZod(unifiedSandboxSchema),
    execute: async (params: {
      action:
        | "runCode"
        | "runShell"
        | "readFile"
        | "writeFile"
        | "listDir"
        | "deleteFile";
      language?: "python" | "javascript" | "typescript";
      code?: string;
      command?: string;
      path?: string;
      content?: string;
    }): Promise<SandboxResult> => {
      // Check quota before operation
      if (context?.userId) {
        try {
          await e2bCostTracker.enforceQuota(context.userId);
        } catch (error) {
          if (error instanceof QuotaExceededError) {
            return {
              success: false,
              action: params.action || "unknown",
              error: error.message,
            };
          }
          throw error;
        }
      }

      const sandboxService = E2BSandboxService.getInstance();
      const startTime = Date.now();

      // Helper to track billing after successful operations
      const trackBilling = async (action: string) => {
        if (!context?.userId) return;

        const executionMs = Date.now() - startTime;
        console.log(
          `[Sandbox Tool] Recording billing for ${action}, user: ${context.userId}`,
        );

        trackSandboxExecution({
          userId: context.userId,
          executionMs,
        }).catch(console.error);

        subscriptionRepository
          .recordUsageEvent({
            userId: context.userId,
            eventType: "sandbox_execution",
            amount: "1",
            metadata: {
              action,
              executionMs,
              creditsConsumed: SERVICE_CREDIT_COSTS.sandboxPerExecution,
            },
          })
          .then(() => console.log("[Sandbox Tool] Billing recorded"))
          .catch((err) =>
            console.error("[Sandbox Tool] Failed to record billing:", err),
          );
      };

      // Debug logging
      console.log(
        "[Sandbox Tool] Received params:",
        JSON.stringify(params, null, 2),
      );
      console.log(
        "[Sandbox Tool] Action type:",
        typeof params.action,
        "Value:",
        params.action,
      );

      // Normalize action - handle all naming conventions (camelCase, snake_case, legacy)
      const rawAction = String(params.action || "").trim();
      const actionMap: Record<string, string> = {
        // Current camelCase names (primary)
        runCode: "runCode",
        runShell: "runShell",
        readFile: "readFile",
        writeFile: "writeFile",
        listDir: "listDir",
        deleteFile: "deleteFile",
        // snake_case variants
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
      // Try exact match first, then lowercase
      const normalizedAction =
        actionMap[rawAction] || actionMap[rawAction.toLowerCase()] || rawAction;
      console.log("[Sandbox Tool] Normalized action:", normalizedAction);

      try {
        let result: SandboxResult;

        switch (normalizedAction) {
          case "runCode":
            result = await executeCode(sandboxService, params, context);
            break;

          case "runShell":
            result = await executeShell(sandboxService, params, context);
            break;

          case "readFile":
            result = await readFile(sandboxService, params, context);
            break;

          case "writeFile":
            result = await writeFile(sandboxService, params, context);
            break;

          case "listDir":
            result = await listDirectory(sandboxService, params, context);
            break;

          case "deleteFile":
            result = await deleteFile(sandboxService, params, context);
            break;

          default:
            return {
              success: false,
              action: normalizedAction,
              error: `Unknown action: ${normalizedAction} (original: ${params.action})`,
            };
        }

        // Track billing for successful operations
        if (result.success) {
          trackBilling(normalizedAction);
        }

        // Truncate large outputs to prevent context overflow
        return truncateSandboxResult(result);
      } catch (error: any) {
        return truncateSandboxResult({
          success: false,
          action: normalizedAction,
          error: error.message || "An error occurred",
        });
      }
    },
  });
}

// ============================================================================
// Action Handlers
// ============================================================================

async function executeCode(
  service: E2BSandboxService,
  params: { code?: string; language?: string },
  context?: SandboxExecutionContext,
): Promise<SandboxResult> {
  if (!params.code || params.code.trim() === "") {
    return {
      success: false,
      action: "runCode",
      error:
        'Missing "code" parameter. Correct usage: { "action": "runCode", "language": "python", "code": "print(\'hello\')" }',
    };
  }

  const language = params.language || "python";
  const logs: any[] = [];
  let artifacts: any[] = [];
  let executionError: string | undefined;

  const onEvent = (event: SandboxEvent) => {
    if (event.type === "log") {
      logs.push(event.value);
    } else if (event.type === "artifacts") {
      console.log(
        "[Sandbox Tool] Received artifacts event:",
        JSON.stringify(event.value),
      );
      artifacts = event.value;
    } else if (event.type === "finish" && event.value?.error) {
      executionError = event.value.error;
    }
  };

  console.log("[Sandbox Tool] Executing code with context:", {
    hasContext: !!(context?.threadId && context?.userId),
    threadId: context?.threadId,
    userId: context?.userId,
    language,
  });

  try {
    if (context?.threadId && context?.userId) {
      console.log(
        "[Sandbox Tool] USING CONTEXT-AWARE EXECUTION - files WILL persist between steps",
      );
      await service.runCodeWithContext(
        params.code,
        language,
        context.threadId,
        context.userId,
        onEvent,
      );
    } else {
      console.warn(
        "[Sandbox Tool] WARNING: USING STATELESS EXECUTION - files will NOT persist! threadId=",
        context?.threadId,
        "userId=",
        context?.userId,
      );
      await service.runCodeWithCallback(params.code, language, onEvent);
    }

    console.log(
      "[Sandbox Tool] Execution complete. Artifacts count:",
      artifacts.length,
    );
    if (artifacts.length > 0) {
      console.log(
        "[Sandbox Tool] Artifacts:",
        JSON.stringify(artifacts, null, 2),
      );
    }

    // Check for execution errors from the finish event
    if (executionError) {
      return {
        success: false,
        action: "runCode",
        results: artifacts,
        logs,
        error: executionError,
      };
    }

    return {
      success: true,
      action: "runCode",
      results: artifacts,
      logs,
    };
  } catch (error: any) {
    console.error("[Sandbox Tool] Code execution error:", error);
    return {
      success: false,
      action: "runCode",
      results: artifacts,
      logs,
      error: error.message || "Code execution failed",
    };
  }
}

async function executeShell(
  service: E2BSandboxService,
  params: { command?: string },
  context?: SandboxExecutionContext,
): Promise<SandboxResult> {
  if (!params.command || params.command.trim() === "") {
    return {
      success: false,
      action: "runShell",
      error:
        'Missing "command" parameter. Correct usage: { "action": "runShell", "command": "your-shell-command-here" }',
    };
  }

  const logs: string[] = [];

  const onEvent = (event: SandboxEvent) => {
    if (event.type === "command_output") {
      logs.push(event.value.data);
    }
  };

  let result: CommandResult;

  console.log("[Sandbox Tool] Executing shell command:", params.command);

  try {
    if (context?.threadId && context?.userId) {
      console.log(
        "[Sandbox Tool] Shell: USING CONTEXT-AWARE EXECUTION for thread:",
        context.threadId,
      );
      result = await service.runCommandWithContext(
        params.command,
        context.threadId,
        context.userId,
        onEvent,
      );
    } else {
      console.warn(
        "[Sandbox Tool] Shell: WARNING - USING STATELESS EXECUTION - changes will NOT persist!",
      );
      result = await service.runCommand(params.command, onEvent);
    }

    // Ensure we have a proper result object
    if (!result) {
      return {
        success: false,
        action: "runShell",
        error: "Shell command execution returned no result",
      };
    }

    // Derive error message if not present but command failed
    let errorMessage = result.error;
    if (!result.success && !errorMessage) {
      if (result.stderr && result.stderr.trim()) {
        errorMessage = result.stderr.trim();
      } else if (result.exitCode !== 0) {
        errorMessage = `Command exited with code ${result.exitCode}`;
      } else {
        errorMessage = "Shell command failed with unknown error";
      }
    }

    return {
      success: result.success,
      action: "runShell",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error: errorMessage,
    };
  } catch (error: any) {
    console.error("[Sandbox Tool] Shell execution error:", error);
    return {
      success: false,
      action: "runShell",
      error: error.message || "Shell command execution failed",
    };
  }
}

async function readFile(
  service: E2BSandboxService,
  params: { path?: string },
  context?: SandboxExecutionContext,
): Promise<SandboxResult> {
  if (!params.path || params.path.trim() === "") {
    return {
      success: false,
      action: "readFile",
      error:
        'Missing "path" parameter. Correct usage: { "action": "readFile", "path": "/home/user/filename.txt" }',
    };
  }

  console.log("[Sandbox Tool] Reading file:", params.path);

  try {
    if (context?.threadId && context?.userId) {
      console.log(
        "[Sandbox Tool] File Read: Using context-aware read for thread:",
        context.threadId,
      );
      const result = await service.readFileWithContext(
        params.path,
        context.threadId,
        context.userId,
      );
      return {
        success: true,
        action: "readFile",
        content: result.content,
        size: result.size,
      };
    }

    // No context - need to create a sandbox for this operation
    console.error(
      "[Sandbox Tool] File Read FAILED: No thread context! threadId=",
      context?.threadId,
      "userId=",
      context?.userId,
    );
    return {
      success: false,
      action: "readFile",
      error: "Thread context required for file operations",
    };
  } catch (error: any) {
    console.error("[Sandbox Tool] File read error:", error);
    return {
      success: false,
      action: "readFile",
      error: error.message || `Failed to read file: ${params.path}`,
    };
  }
}

async function writeFile(
  service: E2BSandboxService,
  params: { path?: string; content?: string },
  context?: SandboxExecutionContext,
): Promise<SandboxResult> {
  if (!params.path || params.path.trim() === "") {
    return {
      success: false,
      action: "writeFile",
      error:
        'Missing "path" parameter. Correct usage: { "action": "writeFile", "path": "/home/user/filename.txt", "content": "file contents here" }',
    };
  }
  if (params.content === undefined || params.content === null) {
    return {
      success: false,
      action: "writeFile",
      error:
        'Missing "content" parameter. Correct usage: { "action": "writeFile", "path": "/home/user/filename.txt", "content": "file contents here" }',
    };
  }

  console.log(
    "[Sandbox Tool] Writing file:",
    params.path,
    "size:",
    params.content.length,
  );

  try {
    if (context?.threadId && context?.userId) {
      console.log(
        "[Sandbox Tool] File Write: Using context-aware write for thread:",
        context.threadId,
      );
      await service.writeFileWithContext(
        params.path,
        params.content,
        context.threadId,
        context.userId,
      );
      console.log("[Sandbox Tool] File Write SUCCESS:", params.path);
      return {
        success: true,
        action: "writeFile",
        message: `File written: ${params.path}`,
        size: params.content.length,
      };
    }

    console.error(
      "[Sandbox Tool] File Write FAILED: No thread context! threadId=",
      context?.threadId,
      "userId=",
      context?.userId,
    );
    return {
      success: false,
      action: "writeFile",
      error: "Thread context required for file operations",
    };
  } catch (error: any) {
    console.error("[Sandbox Tool] File write error:", error);
    return {
      success: false,
      action: "writeFile",
      error: error.message || `Failed to write file: ${params.path}`,
    };
  }
}

async function listDirectory(
  service: E2BSandboxService,
  params: { path?: string },
  context?: SandboxExecutionContext,
): Promise<SandboxResult> {
  const path = params.path || "/home/user";

  try {
    if (context?.threadId && context?.userId) {
      const files = await service.listDirectoryWithContext(
        path,
        context.threadId,
        context.userId,
      );
      return {
        success: true,
        action: "listDir",
        files,
      };
    }

    return {
      success: false,
      action: "listDir",
      error: "Thread context required for file operations",
    };
  } catch (error: any) {
    console.error("[Sandbox Tool] List directory error:", error);
    return {
      success: false,
      action: "listDir",
      error: error.message || `Failed to list directory: ${path}`,
    };
  }
}

async function deleteFile(
  service: E2BSandboxService,
  params: { path?: string },
  context?: SandboxExecutionContext,
): Promise<SandboxResult> {
  if (!params.path || params.path.trim() === "") {
    return {
      success: false,
      action: "deleteFile",
      error:
        'Missing "path" parameter. Correct usage: { "action": "deleteFile", "path": "/home/user/filename.txt" }',
    };
  }

  try {
    if (context?.threadId && context?.userId) {
      await service.deleteFileWithContext(
        params.path,
        context.threadId,
        context.userId,
      );
      return {
        success: true,
        action: "deleteFile",
        message: `File deleted: ${params.path}`,
      };
    }

    return {
      success: false,
      action: "deleteFile",
      error: "Thread context required for file operations",
    };
  } catch (error: any) {
    console.error("[Sandbox Tool] Delete file error:", error);
    return {
      success: false,
      action: "deleteFile",
      error: error.message || `Failed to delete file: ${params.path}`,
    };
  }
}

/**
 * Default unified sandbox tool (without context)
 */
export const unifiedSandboxTool = createUnifiedSandboxTool();
