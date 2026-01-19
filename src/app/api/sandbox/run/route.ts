/**
 * Local Sandbox API Route
 *
 * Executes code and commands locally in the Electron environment.
 * This replaces the cloud-based E2B sandbox with local terminal execution.
 *
 * Note: This API route is primarily for non-Electron contexts.
 * In the Electron app, prefer using IPC calls directly.
 */

import { validateSession } from "lib/api/auth-helpers";

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
  language?: "python" | "javascript" | "typescript" | "bash";
  // For shell commands
  command?: string;
  // For file operations
  path?: string;
  content?: string;
  // Thread context for persistence
  threadId?: string;
}

interface SandboxEvent {
  type:
    | "stdout"
    | "stderr"
    | "error"
    | "finish"
    | "artifact"
    | "command_result";
  value?: string;
  path?: string;
  filename?: string;
}

export async function POST(req: Request) {
  try {
    const auth = await validateSession();
    if (!auth.success) return auth.response;

    const body: SandboxRequest = await req.json();
    const action = body.action || "runCode";

    // Normalize action names (support both old and new naming)
    const normalizedAction = normalizeAction(action);

    // For Electron environment, return instructions to use IPC
    // This API route is a fallback for non-Electron contexts
    if (typeof window !== "undefined" && (window as any).electronAPI) {
      return Response.json(
        {
          error:
            "In Electron environment, use IPC calls instead of API routes for sandbox operations",
          suggestion: "Use window.electronAPI.terminal.execute() for commands",
        },
        { status: 400 },
      );
    }

    // Handle streaming actions (runCode, runShell)
    if (normalizedAction === "runCode" || normalizedAction === "runShell") {
      return handleStreamingAction(body, normalizedAction);
    }

    // Handle non-streaming actions (readFile, writeFile, listDir, deleteFile)
    return handleFileAction(body, normalizedAction);
  } catch (error: any) {
    console.error("Sandbox API Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Handle streaming actions (code execution, shell commands)
 * For server-side execution in non-Electron environment
 */
function handleStreamingAction(
  body: SandboxRequest,
  action: "runCode" | "runShell",
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: SandboxEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        if (action === "runCode") {
          if (!body.code) {
            sendEvent({ type: "error", value: "Code is required" });
            controller.close();
            return;
          }

          const language = body.language || "python";

          // For server-side, we use dynamic imports to avoid bundling Node.js modules
          const { spawn } = await import("child_process");
          const { writeFile, unlink } = await import("fs/promises");
          const { join } = await import("path");
          const { tmpdir } = await import("os");

          const ext = {
            python: ".py",
            javascript: ".js",
            typescript: ".ts",
            bash: ".sh",
          }[language];

          const cmd = {
            python: "python3",
            javascript: "node",
            typescript: "npx tsx",
            bash: "bash",
          }[language];

          const tempFile = join(tmpdir(), `sandbox_${Date.now()}${ext}`);

          try {
            await writeFile(tempFile, body.code, "utf-8");

            const [command, ...args] = cmd.split(" ");
            const proc = spawn(command, [...args, tempFile], {
              timeout: 60000,
              shell: process.platform === "win32",
            });

            proc.stdout.on("data", (data) => {
              sendEvent({ type: "stdout", value: data.toString() });
            });

            proc.stderr.on("data", (data) => {
              sendEvent({ type: "stderr", value: data.toString() });
            });

            await new Promise<void>((resolve, reject) => {
              proc.on("close", () => {
                sendEvent({ type: "finish" });
                resolve();
              });
              proc.on("error", (err) => {
                sendEvent({ type: "error", value: err.message });
                reject(err);
              });
            });

            await unlink(tempFile).catch(() => {});
          } catch (err: any) {
            sendEvent({ type: "error", value: err.message });
            await unlink(tempFile).catch(() => {});
          }
        } else if (action === "runShell") {
          if (!body.command) {
            sendEvent({ type: "error", value: "Command is required" });
            controller.close();
            return;
          }

          const { spawn } = await import("child_process");

          const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
          const shellFlag = process.platform === "win32" ? "/c" : "-c";

          const proc = spawn(shell, [shellFlag, body.command], {
            timeout: 60000,
          });

          let stdout = "";
          let stderr = "";

          proc.stdout.on("data", (data) => {
            const text = data.toString();
            stdout += text;
            sendEvent({ type: "stdout", value: text });
          });

          proc.stderr.on("data", (data) => {
            const text = data.toString();
            stderr += text;
            sendEvent({ type: "stderr", value: text });
          });

          await new Promise<void>((resolve) => {
            proc.on("close", (code) => {
              sendEvent({
                type: "command_result",
                value: JSON.stringify({
                  exitCode: code,
                  stdout,
                  stderr,
                }),
              });
              sendEvent({ type: "finish" });
              resolve();
            });
          });
        }

        controller.close();
      } catch (error: any) {
        sendEvent({ type: "error", value: error.message });
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
  body: SandboxRequest,
  action: "readFile" | "writeFile" | "listDir" | "deleteFile",
): Promise<Response> {
  const { readFile, writeFile, unlink, readdir, stat } = await import(
    "fs/promises"
  );
  const { join } = await import("path");
  const { app } = await import("electron").catch(() => ({
    app: { getPath: () => process.cwd() },
  }));

  const sandboxDir = join(
    (app as any).getPath?.("userData") || process.cwd(),
    "sandbox",
    body.threadId || "default",
  );

  // Ensure sandbox directory exists
  const { mkdir } = await import("fs/promises");
  await mkdir(sandboxDir, { recursive: true });

  try {
    switch (action) {
      case "readFile": {
        if (!body.path) {
          return Response.json({ error: "Path is required" }, { status: 400 });
        }
        const filePath = join(sandboxDir, body.path);
        const content = await readFile(filePath, "utf-8");
        const stats = await stat(filePath);
        return Response.json({
          success: true,
          action: "readFile",
          content,
          size: stats.size,
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
        const filePath = join(sandboxDir, body.path);
        await writeFile(filePath, body.content, "utf-8");
        return Response.json({
          success: true,
          action: "writeFile",
          filename: body.path,
          message: `File written: ${body.path}`,
          size: body.content.length,
        });
      }

      case "listDir": {
        const dirPath = join(sandboxDir, body.path || "");
        const entries = await readdir(dirPath, { withFileTypes: true });
        const files = entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        }));
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
        const filePath = join(sandboxDir, body.path);
        await unlink(filePath);
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
