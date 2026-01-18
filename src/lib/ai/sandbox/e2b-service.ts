import { Sandbox } from "@e2b/code-interpreter";
import { ThreadFileMetadata } from "lib/db/pg/schema.pg";
import { threadSandboxContextRepository } from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";

// Types for shell command execution
export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
}

export interface SandboxEvent {
  type: "log" | "artifacts" | "finish" | "command_output";
  value: any;
}

// Constants for context management
const MAX_CONTEXT_SIZE_BYTES = 100 * 1024 * 1024; // 100MB compressed
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB per file
const CONTEXT_STORAGE_PREFIX = "thread-contexts";

// Interface for recursive file entry
interface RecursiveFileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

/**
 * Service to manage E2B Sandbox sessions.
 * This handles Python/JS execution, dependency installation, and file retrieval.
 */
export class E2BSandboxService {
  private static instance: E2BSandboxService;
  private readonly apiKey: string;

  private constructor() {
    this.apiKey = process.env.E2B_API_KEY || "";
    if (!this.apiKey) {
      console.warn("E2B_API_KEY is not set. Sandbox execution will fail.");
    }
  }

  public static getInstance(): E2BSandboxService {
    if (!E2BSandboxService.instance) {
      E2BSandboxService.instance = new E2BSandboxService();
    }
    return E2BSandboxService.instance;
  }

  /**
   * Executes code in a new sandbox.
   * @param code The code to execute
   * @param language 'python' | 'javascript'
   * @param onLog Callback for real-time logs
   */

  /**
   * Executes code with a callback for real-time events.
   * This handles log streaming and final artifact detection.
   */
  public async runCodeWithCallback(
    code: string,
    language: string,
    onEvent: (event: any) => void,
  ) {
    let sb: Sandbox;
    try {
      sb = await this.createSandboxWithTimeout();
    } catch (error: any) {
      console.warn("Sandbox creation failed:", error.message);
      this.handleSandboxCreationError(error, onEvent);
      return;
    }

    try {
      const initialFiles = await sb.files.list("/home/user");
      const initialFileNames = new Set(initialFiles.map((f) => f.name));

      // Execute the code with timeout protection (60 seconds)
      const CODE_EXECUTION_TIMEOUT_MS = 60000;
      const codePromise = sb.runCode(code, {
        language: language as any,
        onStdout: (data) =>
          onEvent({
            type: "log",
            value: {
              type: "data",
              args: [{ value: data.line }],
            },
          }),
        onStderr: (data) =>
          onEvent({
            type: "log",
            value: {
              type: "error",
              args: [{ value: data.line }],
            },
          }),
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Code execution timed out after ${CODE_EXECUTION_TIMEOUT_MS / 1000} seconds`,
            ),
          );
        }, CODE_EXECUTION_TIMEOUT_MS);
      });

      const result = await Promise.race([codePromise, timeoutPromise]);

      // Handle interactive artifacts (charts, images)
      const artifacts: any[] = result.results.map((res) => {
        const json = res.toJSON();
        if (res.chart) return { type: "chart", value: res.chart };
        if (json.png)
          return { type: "image", value: `data:image/png;base64,${json.png}` };
        return { type: "data", value: json.text };
      });

      // Detect and download new files
      const finalFiles = await sb.files.list("/home/user");
      // DEBUG: Log files found
      onEvent({
        type: "log",
        value: {
          type: "data",
          args: [
            {
              value: `\n[DEBUG] Files in /home/user: ${finalFiles.map((f) => f.name).join(", ")}`,
            },
          ],
        },
      });

      for (const file of finalFiles) {
        if (!initialFileNames.has(file.name)) {
          // Skip directories - only process files
          if (file.type === "dir") {
            onEvent({
              type: "log",
              value: {
                type: "data",
                args: [{ value: `[DEBUG] Skipping directory: ${file.name}` }],
              },
            });
            continue;
          }

          // 'file' includes properies like name, type, path. Logging it helps debug.
          // Note: EntryInfo type might differ between SDK versions, safely logging properties.
          const ext = file.name.split(".").pop()?.toLowerCase();

          onEvent({
            type: "log",
            value: {
              type: "data",
              args: [
                {
                  value: `[DEBUG] New file detected in /home/user: ${file.name} (${ext}) [Type: ${JSON.stringify(file)}]`,
                },
              ],
            },
          });

          await this.processArtifact(
            sb,
            file.name,
            ext,
            `/home/user/${file.name}`,
            artifacts,
            onEvent,
          );
        }
      }

      // Fallback: Check /tmp for artifacts (in case LLM wrote there)
      const tmpFiles = await sb.files.list("/tmp");
      // Filter out common system files/sockets in /tmp if necessary
      for (const file of tmpFiles) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        // Simple heuristic: if it has an extension we care about, try to grab it
        if (ext && this.isAllowedExtension(ext)) {
          // Only process if we haven't already processed a file with same name (simple de-dupe)
          if (!artifacts.some((a) => a.filename === file.name)) {
            onEvent({
              type: "log",
              value: {
                type: "data",
                args: [
                  {
                    value: `[DEBUG] Fallback: Detected potentially missed artifact in /tmp: ${file.name}`,
                  },
                ],
              },
            });
            await this.processArtifact(
              sb,
              file.name,
              ext,
              `/tmp/${file.name}`,
              artifacts,
              onEvent,
            );
          }
        }
      }

      if (artifacts.length === 0) {
        onEvent({
          type: "log",
          value: {
            type: "data",
            args: [{ value: `[DEBUG] No new allowed artifacts found.` }],
          },
        });
      }

      // Send artifacts event
      if (artifacts.length > 0) {
        onEvent({ type: "artifacts", value: artifacts });
      }

      onEvent({
        type: "finish",
        value: { success: true, error: result.error, results: artifacts },
      });
    } catch (e: any) {
      console.error("Sandbox execution error:", e);
      onEvent({
        type: "finish",
        value: { success: false, error: e.message },
      });
    } finally {
      await sb.kill();
    }
  }

  /**
   * Compatibility method for existing tools.
   * Internally uses runCodeWithCallback but waits for completion.
   */
  public async runCode(
    code: string,
    language: string = "python",
    onLog?: (log: any) => void,
  ) {
    return new Promise<any>((resolve, reject) => {
      let finalResult: any = null;
      const logs: any[] = [];
      let artifacts: any[] = [];

      this.runCodeWithCallback(code, language, (event) => {
        if (event.type === "log") {
          logs.push(event.value);
          onLog?.(event.value);
        } else if (event.type === "artifacts") {
          artifacts = event.value;
        } else if (event.type === "finish") {
          // Merge collected artifacts with final result if needed
          finalResult = {
            ...event.value,
            logs: logs,
            results: event.value.results || artifacts,
          };
          resolve(finalResult);
        }
      }).catch((e) => {
        reject(e);
      });
    });
  }

  private isAllowedExtension(ext: string): boolean {
    return [
      "xlsx",
      "pptx",
      "docx",
      "pdf",
      "csv",
      "html",
      "htm",
      "js",
      "jsx",
      "ts",
      "tsx",
      "json",
      "css",
      "png",
      "jpg",
      "jpeg",
      "svg",
      "txt",
      "md",
      "py",
      "zip",
    ].includes(ext.toLowerCase());
  }

  /**
   * Recursively lists all files in a directory using Python.
   * Returns full paths for all files (not directories).
   */
  private async listFilesRecursively(
    sb: Sandbox,
    basePath: string = "/home/user",
  ): Promise<RecursiveFileEntry[]> {
    // Force filesystem sync before listing to catch files written by libraries
    // that use temp-file-then-rename patterns (python-pptx, openpyxl, etc.)
    const result = await sb.runCode(`
import os
import json
import subprocess
import time

# Force filesystem sync to ensure all pending writes are flushed
# This is critical for libraries like python-pptx that write to temp files then rename
try:
    subprocess.run(['sync'], timeout=5)
except:
    pass

# Small delay to ensure filesystem operations complete
time.sleep(0.1)

base_path = "${basePath}"
files = []

# Use os.scandir for more reliable file detection
def scan_directory(path):
    try:
        with os.scandir(path) as entries:
            for entry in entries:
                if entry.name.startswith('.'):
                    continue
                if entry.is_file(follow_symlinks=False):
                    files.append({
                        "name": entry.name,
                        "path": entry.path,
                        "type": "file"
                    })
                elif entry.is_dir(follow_symlinks=False):
                    # Skip common large directories
                    if entry.name not in ['__pycache__', 'node_modules', '.cache', '.npm', '.local', '.venv']:
                        scan_directory(entry.path)
    except PermissionError:
        pass
    except Exception as e:
        pass

scan_directory(base_path)
print(json.dumps(files))
`);

    if (result.error) {
      console.error("Failed to list files recursively:", result.error);
      return [];
    }

    try {
      const output = result.logs.stdout.join("").trim();
      return JSON.parse(output) as RecursiveFileEntry[];
    } catch (e) {
      console.error("Failed to parse recursive file list:", e);
      return [];
    }
  }

  private async processArtifact(
    sb: Sandbox,
    filename: string,
    ext: string | undefined,
    fullPath: string,
    artifacts: any[],
    onEvent: (event: any) => void,
  ) {
    if (this.isAllowedExtension(ext || "")) {
      try {
        const url = await this.saveFileToPublic(sb, fullPath, filename);
        onEvent({
          type: "log",
          value: {
            type: "data",
            args: [{ value: `[DEBUG] Saved artifact to: ${url}` }],
          },
        });

        artifacts.push({
          type: "file",
          filename: filename,
          mediaType: this.getMediaType(ext || ""),
          url: url,
        });
      } catch (err: any) {
        onEvent({
          type: "log",
          value: {
            type: "error",
            args: [
              { value: `[DEBUG] Failed to save ${filename}: ${err.message}` },
            ],
          },
        });
      }
    } else {
      onEvent({
        type: "log",
        value: {
          type: "data",
          args: [
            { value: `[DEBUG] Skipping extension .${ext} (not whitelisted)` },
          ],
        },
      });
    }
  }

  private getMediaType(ext: string): string {
    const map: Record<string, string> = {
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
      csv: "text/csv",
      html: "text/html",
      htm: "text/html",
      js: "text/javascript",
      jsx: "text/javascript",
      ts: "text/typescript",
      tsx: "text/typescript",
      json: "application/json",
      css: "text/css",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      svg: "image/svg+xml",
      txt: "text/plain",
      md: "text/markdown",
      py: "text/x-python",
    };
    return map[ext] || "application/octet-stream";
  }

  /**
   * Downloads a file from the sandbox as base64 chunks to avoid size limits.
   */
  /**
   * Saves a file from the sandbox to storage and returns the URL.
   * Uses the configured file storage (Vercel Blob, S3, or local).
   */
  public async saveFileToPublic(
    sb: Sandbox,
    path: string,
    filename: string,
  ): Promise<string> {
    const exec = await sb.runCode(
      `import base64; print(base64.b64encode(open("${path}", "rb").read()).decode("utf-8"))`,
    );

    if (exec.error) {
      throw new Error(`Failed to download file: ${exec.error.value}`);
    }

    const b64 = exec.logs.stdout.join("").trim();
    const buffer = Buffer.from(b64, "base64");

    const safeName = `${Date.now()}-${filename.replaceAll(/[^a-zA-Z0-9.-]/g, "_")}`;
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const contentType = this.getMediaType(ext);

    const result = await serverFileStorage.upload(buffer, {
      filename: safeName,
      contentType,
    });

    return result.sourceUrl;
  }

  /**
   * Lists files in the sandbox's home directory.
   */
  public async listFiles(sb: Sandbox, path: string = "/home/user") {
    return await sb.files.list(path);
  }

  // ============================================================================
  // Shell Command Execution Methods
  // ============================================================================

  /**
   * Runs a shell command in the sandbox.
   * Uses the native E2B commands API for full terminal access.
   */
  public async runCommand(
    command: string,
    onEvent: (event: SandboxEvent) => void,
  ): Promise<CommandResult> {
    let sb: Sandbox;
    try {
      sb = await this.createSandboxWithTimeout();
    } catch (error: any) {
      onEvent({
        type: "finish",
        value: { success: false, error: error.message },
      });
      return {
        success: false,
        stdout: "",
        stderr: error.message,
        exitCode: 1,
        error: error.message,
      };
    }

    try {
      return await this.executeCommand(sb, command, onEvent);
    } finally {
      await sb.kill();
    }
  }

  /**
   * Runs a shell command with thread context persistence.
   * - Restores previous context before execution
   * - Archives context after execution
   * - Auto-injects user-uploaded files
   */
  public async runCommandWithContext(
    command: string,
    threadId: string,
    userId: string,
    onEvent: (event: SandboxEvent) => void,
  ): Promise<CommandResult> {
    let sb: Sandbox;
    try {
      sb = await this.createSandboxWithTimeout();
    } catch (error: any) {
      onEvent({
        type: "finish",
        value: { success: false, error: error.message },
      });
      return {
        success: false,
        stdout: "",
        stderr: error.message,
        exitCode: 1,
        error: error.message,
      };
    }

    try {
      // Setup thread context (restore + inject files)
      const context = await this.setupThreadContext(
        sb,
        threadId,
        userId,
        onEvent,
      );

      // Track initial files for new file detection
      const initialFiles = await this.listFilesRecursively(sb, "/home/user");
      const initialFilePaths = new Set(initialFiles.map((f) => f.path));

      // Execute the command
      const result = await this.executeCommand(sb, command, onEvent);

      // Process new files created during execution
      const { artifacts, newFileMetadata } = await this.processNewFiles(
        sb,
        initialFilePaths,
        onEvent,
      );

      // Send artifacts if any
      if (artifacts.length > 0) {
        onEvent({ type: "artifacts", value: artifacts });
      }

      // Archive context and update metadata
      await this.finalizeContext(
        sb,
        threadId,
        userId,
        context,
        newFileMetadata,
        onEvent,
      );

      return result;
    } finally {
      await sb.kill();
    }
  }

  /**
   * Internal helper to execute a shell command on an existing sandbox.
   */
  private async executeCommand(
    sb: Sandbox,
    command: string,
    onEvent: (event: SandboxEvent) => void,
  ): Promise<CommandResult> {
    try {
      onEvent({
        type: "log",
        value: {
          type: "data",
          args: [{ value: `$ ${command}` }],
        },
      });

      // Use runCode with bash to execute shell commands
      // This is more reliable than commands.run() for complex commands
      const result = await sb.runCode(
        String.raw`
import subprocess
import sys

result = subprocess.run(
    ${JSON.stringify(command)},
    shell=True,
    capture_output=True,
    text=True,
    cwd="/home/user"
)

# Print stdout
if result.stdout:
    print(result.stdout, end='')

# Print stderr to stderr
if result.stderr:
    print(result.stderr, file=sys.stderr, end='')

# Print exit code marker
print(f"\\n__EXIT_CODE__:{result.returncode}")
`,
        {
          language: "python",
          onStdout: (data) =>
            onEvent({
              type: "command_output",
              value: { stream: "stdout", data: data.line },
            }),
          onStderr: (data) =>
            onEvent({
              type: "command_output",
              value: { stream: "stderr", data: data.line },
            }),
        },
      );

      // Parse output
      const stdout = result.logs.stdout.join("");
      const stderr = result.logs.stderr.join("");

      // Extract exit code
      const exitCodeMatch = stdout.match(/__EXIT_CODE__:(\d+)/);
      const exitCode = exitCodeMatch
        ? Number.parseInt(exitCodeMatch[1], 10)
        : 0;
      const cleanStdout = stdout.replace(/__EXIT_CODE__:\d+\n?/, "").trim();

      const cmdResult: CommandResult = {
        success: exitCode === 0,
        stdout: cleanStdout,
        stderr: stderr.trim(),
        exitCode,
      };

      onEvent({
        type: "finish",
        value: cmdResult,
      });

      return cmdResult;
    } catch (e: any) {
      console.error("Command execution error:", e);
      const errorResult: CommandResult = {
        success: false,
        stdout: "",
        stderr: e.message,
        exitCode: 1,
        error: e.message,
      };
      onEvent({ type: "finish", value: { success: false, error: e.message } });
      return errorResult;
    }
  }

  // ============================================================================
  // Shared Helpers - Reduce duplication across methods
  // ============================================================================

  /**
   * Handles sandbox creation errors consistently.
   * Returns a CommandResult for methods that need it, or calls onEvent for callback-based methods.
   */
  private handleSandboxCreationError(
    error: any,
    onEvent?: (event: SandboxEvent) => void,
  ): CommandResult | void {
    const errorMessage = error.message || "Unknown error";
    if (onEvent) {
      onEvent({
        type: "finish",
        value: { success: false, error: errorMessage },
      });
      return;
    }
    return {
      success: false,
      stdout: "",
      stderr: errorMessage,
      exitCode: 1,
      error: errorMessage,
    };
  }

  /**
   * Creates a sandbox with timeout protection.
   * Uses custom template if E2B_TEMPLATE_ID is set (recommended for pre-installed packages).
   * Throws if API key is missing or creation times out.
   */
  private async createSandboxWithTimeout(timeoutMs = 120000): Promise<Sandbox> {
    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      throw new Error("E2B_API_KEY is not set in environment variables.");
    }

    // Use custom template with pre-installed packages if available
    const templateId = process.env.E2B_TEMPLATE_ID;

    const sandboxPromise = templateId
      ? Sandbox.create(templateId, {
          apiKey,
          timeoutMs: 180000,
        })
      : Sandbox.create({
          apiKey,
          timeoutMs: 180000,
        });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Sandbox creation timed out after ${timeoutMs / 1000} seconds`,
            ),
          ),
        timeoutMs,
      );
    });

    return Promise.race([sandboxPromise, timeoutPromise]);
  }

  /**
   * Sets up thread context by restoring previous state and injecting files.
   * Returns the context for further use.
   */
  private async setupThreadContext(
    sb: Sandbox,
    threadId: string,
    userId: string,
    onEvent: (event: SandboxEvent) => void,
  ): Promise<
    Awaited<ReturnType<typeof threadSandboxContextRepository.getOrCreate>>
  > {
    const context = await threadSandboxContextRepository.getOrCreate(
      threadId,
      userId,
    );

    // Restore previous context (graceful fallback on failure)
    try {
      await this.restoreContext(sb, context.contextStorageKey, onEvent);
    } catch (error) {
      console.error("Context restore failed, starting fresh:", error);
      this.logDebug(onEvent, "Context restore failed, starting fresh");
    }

    // Inject user-uploaded files
    try {
      await this.injectUploadedFiles(
        sb,
        (context.fileMetadata as ThreadFileMetadata[]) ?? [],
        onEvent,
      );
    } catch (error) {
      console.error("File injection failed:", error);
      this.logDebug(onEvent, "Some user files could not be injected");
    }

    return context;
  }

  /**
   * Processes new files created during execution.
   * Returns artifacts and file metadata for persistence.
   */
  private async processNewFiles(
    sb: Sandbox,
    initialFilePaths: Set<string>,
    onEvent: (event: SandboxEvent) => void,
  ): Promise<{ artifacts: any[]; newFileMetadata: ThreadFileMetadata[] }> {
    const finalFiles = await this.listFilesRecursively(sb, "/home/user");
    const artifacts: any[] = [];
    const newFileMetadata: ThreadFileMetadata[] = [];
    const processedFileNames = new Set<string>();

    // Process files from /home/user
    for (const file of finalFiles) {
      if (!initialFilePaths.has(file.path)) {
        const ext = file.name.split(".").pop()?.toLowerCase();
        this.logDebug(onEvent, `New file detected: ${file.path}`);

        if (this.isAllowedExtension(ext || "")) {
          try {
            const fileUrl = await this.saveFileToPublic(
              sb,
              file.path,
              file.name,
            );

            artifacts.push({
              type: "file",
              filename: file.name,
              mediaType: this.getMediaType(ext || ""),
              url: fileUrl,
            });

            this.logDebug(onEvent, `Saved file to storage: ${fileUrl}`);
            processedFileNames.add(file.name);

            newFileMetadata.push({
              name: file.name,
              size: 0,
              type: this.getMediaType(ext || ""),
              source: "generated",
              url: fileUrl,
              sandboxPath: file.path, // Include sandbox path for file retrieval
              uploadedAt: new Date().toISOString(),
            });
          } catch (err: any) {
            this.logError(
              onEvent,
              `Failed to save ${file.name}: ${err.message}`,
            );
          }
        } else {
          this.logDebug(
            onEvent,
            `Skipping extension .${ext} (not whitelisted)`,
          );
        }
      }
    }

    // Fallback: Check /tmp for artifacts (libraries like python-pptx may write there)
    try {
      const tmpFiles = await sb.files.list("/tmp");
      for (const file of tmpFiles) {
        if (file.type === "dir") continue;
        const ext = file.name.split(".").pop()?.toLowerCase();
        // Only process allowed extensions that weren't already found
        if (
          ext &&
          this.isAllowedExtension(ext) &&
          !processedFileNames.has(file.name)
        ) {
          this.logDebug(
            onEvent,
            `Fallback: Found artifact in /tmp: ${file.name}`,
          );
          try {
            const fileUrl = await this.saveFileToPublic(
              sb,
              `/tmp/${file.name}`,
              file.name,
            );

            artifacts.push({
              type: "file",
              filename: file.name,
              mediaType: this.getMediaType(ext),
              url: fileUrl,
            });

            this.logDebug(
              onEvent,
              `Saved /tmp artifact to storage: ${fileUrl}`,
            );
            processedFileNames.add(file.name);

            newFileMetadata.push({
              name: file.name,
              size: 0,
              type: this.getMediaType(ext),
              source: "generated",
              url: fileUrl,
              sandboxPath: `/tmp/${file.name}`,
              uploadedAt: new Date().toISOString(),
            });
          } catch (err: any) {
            this.logError(
              onEvent,
              `Failed to save /tmp/${file.name}: ${err.message}`,
            );
          }
        }
      }
    } catch (_err: any) {
      // /tmp listing failed, continue without fallback
      this.logDebug(onEvent, `Could not check /tmp for fallback artifacts`);
    }

    return { artifacts, newFileMetadata };
  }

  /**
   * Archives context and updates file metadata after execution.
   */
  private async finalizeContext(
    sb: Sandbox,
    threadId: string,
    userId: string,
    context: Awaited<
      ReturnType<typeof threadSandboxContextRepository.getOrCreate>
    >,
    newFileMetadata: ThreadFileMetadata[],
    onEvent: (event: SandboxEvent) => void,
  ): Promise<void> {
    try {
      await this.archiveContext(sb, threadId, userId, onEvent);

      const existingMetadata =
        (context.fileMetadata as ThreadFileMetadata[]) ?? [];
      const existingUserFiles = existingMetadata.filter(
        (f) => f.source === "user",
      );

      // Keep existing generated files that aren't being replaced by new ones
      const newFileNames = new Set(newFileMetadata.map((f) => f.name));
      const existingGeneratedFiles = existingMetadata.filter(
        (f) => f.source === "generated" && !newFileNames.has(f.name),
      );

      // Merge: user files + existing generated (not replaced) + new files
      const updatedMetadata = [
        ...existingUserFiles,
        ...existingGeneratedFiles,
        ...newFileMetadata,
      ];

      console.log(
        `[Sandbox] Updating file metadata: ${existingUserFiles.length} user, ${existingGeneratedFiles.length} existing generated, ${newFileMetadata.length} new`,
      );

      await threadSandboxContextRepository.updateFileMetadata(
        threadId,
        updatedMetadata,
      );
    } catch (error) {
      console.error("Context archive failed:", error);
      this.logDebug(onEvent, "Context archive failed");
    }
  }

  /**
   * Emits a debug log event.
   */
  private logDebug(
    onEvent: (event: SandboxEvent) => void,
    message: string,
  ): void {
    onEvent({
      type: "log",
      value: { type: "data", args: [{ value: `[DEBUG] ${message}` }] },
    });
  }

  /**
   * Emits an error log event.
   */
  private logError(
    onEvent: (event: SandboxEvent) => void,
    message: string,
  ): void {
    onEvent({
      type: "log",
      value: { type: "error", args: [{ value: `[DEBUG] ${message}` }] },
    });
  }

  /**
   * Helper that handles common sandbox context setup/teardown pattern.
   * Creates sandbox, restores context, injects files, runs operation, optionally archives.
   */
  private async withSandboxContext<T>(
    threadId: string,
    userId: string,
    operation: (
      sb: Sandbox,
      context: Awaited<
        ReturnType<typeof threadSandboxContextRepository.getOrCreate>
      >,
    ) => Promise<T>,
    options: { archive?: boolean } = {},
  ): Promise<T> {
    const sb = await this.createSandboxWithTimeout();

    try {
      const context = await threadSandboxContextRepository.getOrCreate(
        threadId,
        userId,
      );
      await this.restoreContext(sb, context.contextStorageKey, () => {});
      await this.injectUploadedFiles(
        sb,
        (context.fileMetadata as ThreadFileMetadata[]) ?? [],
        () => {},
      );

      const result = await operation(sb, context);

      if (options.archive) {
        await this.archiveContext(sb, threadId, userId, () => {});
      }

      return result;
    } finally {
      await sb.kill();
    }
  }

  // ============================================================================
  // Native File Operations (faster than Python workarounds)
  // ============================================================================

  /**
   * Reads a file from the sandbox using native E2B API.
   */
  public async readFileNative(
    sb: Sandbox,
    path: string,
  ): Promise<{ content: string; size: number }> {
    try {
      const content = await sb.files.read(path);
      const contentStr = String(content);
      return {
        content: contentStr,
        size: contentStr.length,
      };
    } catch (error: any) {
      throw this.createFileOperationError("read", path, error);
    }
  }

  /**
   * Writes a file to the sandbox using native E2B API.
   */
  public async writeFileNative(
    sb: Sandbox,
    path: string,
    content: string | Buffer,
  ): Promise<void> {
    try {
      // Convert to string for E2B SDK compatibility
      const data: string = Buffer.isBuffer(content)
        ? content.toString("utf-8")
        : content;
      await sb.files.write(path, data);
    } catch (error: any) {
      throw this.createFileOperationError("write", path, error);
    }
  }

  /**
   * Deletes a file from the sandbox.
   */
  public async deleteFile(sb: Sandbox, path: string): Promise<void> {
    try {
      // Use rm command since E2B SDK doesn't have native delete
      await sb.runCode(`
import os
os.remove("${path}")
print("File deleted")
`);
    } catch (error: any) {
      throw this.createFileOperationError("delete", path, error);
    }
  }

  /**
   * Lists directory contents with file info.
   */
  public async listDirectoryNative(
    sb: Sandbox,
    path: string = "/home/user",
  ): Promise<FileInfo[]> {
    try {
      const entries = await sb.files.list(path);

      // Get sizes using Python
      const sizeResult = await sb.runCode(`
import os
import json

path = "${path}"
files = []
for entry in os.listdir(path):
    full_path = os.path.join(path, entry)
    try:
        stat = os.stat(full_path)
        files.append({
            "name": entry,
            "path": full_path,
            "type": "directory" if os.path.isdir(full_path) else "file",
            "size": stat.st_size
        })
    except:
        pass

print(json.dumps(files))
`);

      const output = sizeResult.logs.stdout.join("").trim();
      if (output) {
        return JSON.parse(output);
      }

      // Fallback to basic info if Python fails
      return entries.map((e) => ({
        name: e.name,
        path: `${path}/${e.name}`,
        type: e.type === "dir" ? ("directory" as const) : ("file" as const),
        size: 0,
      }));
    } catch (error: any) {
      throw this.createFileOperationError("list directory", path, error);
    }
  }

  /**
   * Creates a consistent error for file operations.
   */
  private createFileOperationError(
    operation: string,
    path: string,
    error: any,
  ): Error {
    return new Error(`Failed to ${operation} ${path}: ${error.message}`);
  }

  /**
   * Read file with thread context (creates sandbox, restores context, reads file).
   * Also registers the file in metadata so it appears in the Files tab.
   */
  public async readFileWithContext(
    path: string,
    threadId: string,
    userId: string,
  ): Promise<{ content: string; size: number; url?: string }> {
    const sb = await this.createSandboxWithTimeout();

    try {
      // Setup context (restore + inject files) with no-op event handler
      const noOpEvent = () => {};
      const context = await this.setupThreadContext(
        sb,
        threadId,
        userId,
        noOpEvent,
      );

      // Read file
      const result = await this.readFileNative(sb, path);

      // Extract filename and extension
      const filename = path.split("/").pop() ?? "file";
      const ext = filename.split(".").pop()?.toLowerCase() ?? "";

      // Save the file to storage so it can be viewed in Theater Panel
      let fileUrl: string | undefined;
      if (this.isAllowedExtension(ext)) {
        try {
          fileUrl = await this.saveFileToPublic(sb, path, filename);

          // Update file metadata to include this file
          const existingMetadata =
            (context.fileMetadata as ThreadFileMetadata[]) ?? [];

          // Check if file already exists in metadata
          const existingIndex = existingMetadata.findIndex(
            (f) => f.name === filename,
          );

          const newFileMetadata: ThreadFileMetadata = {
            name: filename,
            size: result.size,
            type: this.getMediaType(ext),
            source: "generated",
            url: fileUrl,
            uploadedAt: new Date().toISOString(),
          };

          let updatedMetadata: ThreadFileMetadata[];
          if (existingIndex >= 0) {
            // Update existing entry
            updatedMetadata = [...existingMetadata];
            updatedMetadata[existingIndex] = newFileMetadata;
          } else {
            // Add new entry
            updatedMetadata = [...existingMetadata, newFileMetadata];
          }

          await threadSandboxContextRepository.updateFileMetadata(
            threadId,
            updatedMetadata,
          );
        } catch (err) {
          console.error("Failed to save read file to storage:", err);
        }
      }

      return { ...result, url: fileUrl };
    } finally {
      await sb.kill();
    }
  }

  /**
   * Write file with thread context (creates sandbox, restores context, writes file, archives).
   */
  public async writeFileWithContext(
    path: string,
    content: string | Buffer,
    threadId: string,
    userId: string,
  ): Promise<{ url?: string; filename: string }> {
    console.log(
      `[Sandbox writeFileWithContext] Starting: path=${path}, threadId=${threadId}, userId=${userId}`,
    );

    const sb = await this.createSandboxWithTimeout();
    console.log(`[Sandbox writeFileWithContext] Sandbox created successfully`);

    try {
      // Setup context (restore + inject files) with no-op event handler
      const noOpEvent = () => {};
      const context = await this.setupThreadContext(
        sb,
        threadId,
        userId,
        noOpEvent,
      );
      console.log(
        `[Sandbox writeFileWithContext] Context setup complete, existing files: ${(context.fileMetadata as ThreadFileMetadata[])?.length ?? 0}`,
      );

      // Write file
      await this.writeFileNative(sb, path, content);
      console.log(`[Sandbox writeFileWithContext] File written to sandbox`);

      // Extract filename from path
      const filename = path.split("/").pop() ?? "file";
      const ext = filename.split(".").pop()?.toLowerCase() ?? "";

      let fileUrl: string | undefined;

      // Try to save to public storage for preview URLs (if allowed extension)
      if (this.isAllowedExtension(ext)) {
        try {
          fileUrl = await this.saveFileToPublic(sb, path, filename);
          console.log(
            `[Sandbox writeFileWithContext] File saved to storage: ${fileUrl}`,
          );
        } catch (err) {
          console.error(
            `[Sandbox writeFileWithContext] Failed to save file to storage:`,
            err,
          );
          // Continue - we'll still update metadata without the URL
        }
      } else {
        console.log(
          `[Sandbox writeFileWithContext] Extension .${ext} not in allowed list, skipping storage upload`,
        );
      }

      // ALWAYS update file metadata so files appear in the Files panel
      // This happens regardless of extension - all files should be tracked
      try {
        const existingMetadata =
          (context.fileMetadata as ThreadFileMetadata[]) ?? [];
        const existingUserFiles = existingMetadata.filter(
          (f) => f.source === "user",
        );

        // Check if file already exists in metadata
        const existingGenerated = existingMetadata.filter(
          (f) => f.source === "generated" && f.name !== filename,
        );

        const newFileMetadata: ThreadFileMetadata = {
          name: filename,
          size:
            typeof content === "string" ? content.length : content.byteLength,
          type: this.getMediaType(ext),
          source: "generated",
          url: fileUrl, // May be undefined if storage failed or extension not allowed
          sandboxPath: path, // Store the sandbox path for later retrieval
          uploadedAt: new Date().toISOString(),
        };

        const updatedMetadata = [
          ...existingUserFiles,
          ...existingGenerated,
          newFileMetadata,
        ];

        console.log(
          `[Sandbox writeFileWithContext] Updating metadata: ${existingUserFiles.length} user files, ${existingGenerated.length} existing generated, 1 new file`,
        );

        await threadSandboxContextRepository.updateFileMetadata(
          threadId,
          updatedMetadata,
        );

        console.log(
          `[Sandbox writeFileWithContext] File metadata updated successfully for: ${filename}`,
        );
      } catch (error_) {
        console.error(
          `[Sandbox writeFileWithContext] CRITICAL: Failed to update file metadata:`,
          error_,
        );
      }

      // Archive context
      await this.archiveContext(sb, threadId, userId, noOpEvent);
      console.log(`[Sandbox writeFileWithContext] Context archived`);

      return { url: fileUrl, filename };
    } finally {
      await sb.kill();
    }
  }

  /**
   * List directory with thread context.
   * Also registers discovered files in metadata so they appear in the Files tab.
   */
  public async listDirectoryWithContext(
    path: string,
    threadId: string,
    userId: string,
  ): Promise<FileInfo[]> {
    return this.withSandboxContext(threadId, userId, async (sb, context) => {
      const files = await this.listDirectoryNative(sb, path);

      // Register discovered files in metadata so they appear in Files tab
      const existingMetadata =
        (context.fileMetadata as ThreadFileMetadata[]) ?? [];
      const existingNames = new Set(existingMetadata.map((f) => f.name));
      const newFileMetadata: ThreadFileMetadata[] = [];

      for (const file of files) {
        if (file.type === "directory" || existingNames.has(file.name)) continue;

        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        if (this.isAllowedExtension(ext)) {
          try {
            const fileUrl = await this.saveFileToPublic(
              sb,
              file.path,
              file.name,
            );
            newFileMetadata.push({
              name: file.name,
              size: file.size,
              type: this.getMediaType(ext),
              source: "generated",
              url: fileUrl,
              uploadedAt: new Date().toISOString(),
            });
          } catch (err) {
            console.error(`Failed to save file ${file.name} to storage:`, err);
          }
        }
      }

      if (newFileMetadata.length > 0) {
        await threadSandboxContextRepository.updateFileMetadata(threadId, [
          ...existingMetadata,
          ...newFileMetadata,
        ]);
      }

      return files;
    });
  }

  /**
   * Delete file with thread context.
   */
  public async deleteFileWithContext(
    path: string,
    threadId: string,
    userId: string,
  ): Promise<void> {
    return this.withSandboxContext(
      threadId,
      userId,
      async (sb) => {
        await this.deleteFile(sb, path);
      },
      { archive: true },
    );
  }

  // ============================================================================
  // Context Management Methods (for per-thread file persistence)
  // ============================================================================

  /**
   * Executes code with thread context persistence.
   * - Restores previous context before execution
   * - Archives context after execution
   * - Auto-injects user-uploaded files
   */
  public async runCodeWithContext(
    code: string,
    language: string,
    threadId: string,
    userId: string,
    onEvent: (event: SandboxEvent) => void,
  ) {
    let sb: Sandbox;
    try {
      sb = await this.createSandboxWithTimeout();
    } catch (error: any) {
      this.handleSandboxCreationError(error, onEvent);
      return;
    }

    try {
      // Setup thread context (restore + inject files)
      const context = await this.setupThreadContext(
        sb,
        threadId,
        userId,
        onEvent,
      );

      // Track initial files for artifact detection
      const initialFiles = await this.listFilesRecursively(sb, "/home/user");
      const initialFilePaths = new Set(initialFiles.map((f) => f.path));

      // Execute the code with timeout protection (60 seconds)
      const CODE_EXECUTION_TIMEOUT_MS = 60000;
      const codePromise = sb.runCode(code, {
        language: language as any,
        onStdout: (data) =>
          onEvent({
            type: "log",
            value: { type: "data", args: [{ value: data.line }] },
          }),
        onStderr: (data) =>
          onEvent({
            type: "log",
            value: { type: "error", args: [{ value: data.line }] },
          }),
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Code execution timed out after ${CODE_EXECUTION_TIMEOUT_MS / 1000} seconds`,
            ),
          );
        }, CODE_EXECUTION_TIMEOUT_MS);
      });

      const result = await Promise.race([codePromise, timeoutPromise]);

      // Handle interactive artifacts (charts, images from execution results)
      const artifacts: any[] = result.results.map((res) => {
        const json = res.toJSON();
        if (res.chart) return { type: "chart", value: res.chart };
        if (json.png)
          return { type: "image", value: `data:image/png;base64,${json.png}` };
        return { type: "data", value: json.text };
      });

      // Process new files created during execution
      const { artifacts: fileArtifacts, newFileMetadata } =
        await this.processNewFiles(sb, initialFilePaths, onEvent);

      // Merge file artifacts with execution artifacts
      artifacts.push(...fileArtifacts);

      // Send artifacts event if any
      if (artifacts.length > 0) {
        onEvent({ type: "artifacts", value: artifacts });
      }

      // Archive context and update metadata
      await this.finalizeContext(
        sb,
        threadId,
        userId,
        context,
        newFileMetadata,
        onEvent,
      );

      onEvent({
        type: "finish",
        value: { success: true, error: result.error, results: artifacts },
      });
    } catch (e: any) {
      console.error("Sandbox execution error:", e);
      onEvent({
        type: "finish",
        value: { success: false, error: e.message },
      });
    } finally {
      await sb.kill();
    }
  }

  /**
   * Archives the /home/user directory to storage.
   * Creates a compressed tar.gz and uploads it.
   */
  private async archiveContext(
    sb: Sandbox,
    threadId: string,
    _userId: string,
    onEvent: (event: any) => void,
  ): Promise<void> {
    onEvent({
      type: "log",
      value: {
        type: "data",
        args: [{ value: "[DEBUG] Archiving context..." }],
      },
    });

    // Create compressed archive, excluding large/unnecessary directories
    const archiveResult = await sb.runCode(`
import subprocess
import os

# Create archive excluding common large directories
result = subprocess.run([
    'tar', '-czf', '/tmp/context.tar.gz',
    '-C', '/home/user',
    '--exclude=__pycache__',
    '--exclude=node_modules',
    '--exclude=.cache',
    '--exclude=.npm',
    '--exclude=.local',
    '--exclude=.venv',
    '.'
], capture_output=True, text=True)

# Get archive size
if os.path.exists('/tmp/context.tar.gz'):
    size = os.path.getsize('/tmp/context.tar.gz')
    print(f"ARCHIVE_SIZE:{size}")
else:
    print("ARCHIVE_FAILED")
    print(result.stderr)
`);

    if (archiveResult.error) {
      throw new Error(`Archive creation failed: ${archiveResult.error.value}`);
    }

    const output = archiveResult.logs.stdout.join("");
    const sizeMatch = output.match(/ARCHIVE_SIZE:(\d+)/);

    if (!sizeMatch) {
      throw new Error("Archive creation failed - could not determine size");
    }

    const archiveSize = Number.parseInt(sizeMatch[1], 10);

    // Check size limit
    if (archiveSize > MAX_CONTEXT_SIZE_BYTES) {
      onEvent({
        type: "log",
        value: {
          type: "data",
          args: [
            {
              value: `[DEBUG] Context too large (${Math.round(archiveSize / 1024 / 1024)}MB), skipping archive`,
            },
          ],
        },
      });
      return;
    }

    // Download archive as base64
    const downloadResult = await sb.runCode(
      `import base64; print(base64.b64encode(open("/tmp/context.tar.gz", "rb").read()).decode("utf-8"))`,
    );

    if (downloadResult.error) {
      throw new Error(
        `Failed to download archive: ${downloadResult.error.value}`,
      );
    }

    const b64 = downloadResult.logs.stdout.join("").trim();
    const buffer = Buffer.from(b64, "base64");

    // Upload to storage
    const inputFilename = `${CONTEXT_STORAGE_PREFIX}/${threadId}/context.tar.gz`;
    const uploadResult = await serverFileStorage.upload(buffer, {
      filename: inputFilename,
      contentType: "application/gzip",
    });

    // Update database with the actual storage key (may differ from input filename)
    // Use sourceUrl as the key since that's what we'll use to download
    await threadSandboxContextRepository.updateArchive(
      threadId,
      uploadResult.sourceUrl,
      archiveSize,
    );

    onEvent({
      type: "log",
      value: {
        type: "data",
        args: [
          {
            value: `[DEBUG] Context archived (${Math.round(archiveSize / 1024)}KB)`,
          },
        ],
      },
    });
  }

  /**
   * Restores a previously archived context to the sandbox.
   */
  private async restoreContext(
    sb: Sandbox,
    storageKeyOrUrl: string | null,
    onEvent: (event: any) => void,
  ): Promise<void> {
    if (!storageKeyOrUrl) {
      onEvent({
        type: "log",
        value: {
          type: "data",
          args: [{ value: "[DEBUG] No previous context to restore" }],
        },
      });
      return;
    }

    onEvent({
      type: "log",
      value: {
        type: "data",
        args: [{ value: "[DEBUG] Restoring previous context..." }],
      },
    });

    let buffer: Buffer;

    // Check if it's a URL (new format) or a storage key (old format)
    if (
      storageKeyOrUrl.startsWith("http://") ||
      storageKeyOrUrl.startsWith("https://")
    ) {
      // It's a URL - fetch directly
      try {
        const response = await fetch(storageKeyOrUrl, { cache: "no-store" });
        if (!response.ok) {
          onEvent({
            type: "log",
            value: {
              type: "data",
              args: [{ value: "[DEBUG] Context archive not found at URL" }],
            },
          });
          return;
        }
        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } catch (error) {
        console.error("Failed to download file from URL:", error);
        onEvent({
          type: "log",
          value: {
            type: "data",
            args: [
              { value: "[DEBUG] Failed to fetch context archive from URL" },
            ],
          },
        });
        return;
      }
    } else {
      // It's a storage key (old format) - use storage API
      const exists = await serverFileStorage.exists(storageKeyOrUrl);
      if (!exists) {
        onEvent({
          type: "log",
          value: {
            type: "data",
            args: [{ value: "[DEBUG] Context archive not found in storage" }],
          },
        });
        return;
      }
      buffer = await serverFileStorage.download(storageKeyOrUrl);
    }
    const b64 = buffer.toString("base64");

    // Write to sandbox
    await sb.runCode(`
import base64
with open("/tmp/context.tar.gz", "wb") as f:
    f.write(base64.b64decode("${b64}"))
print("Context written to /tmp")
`);

    // Extract to /home/user
    const extractResult = await sb.runCode(`
import subprocess
result = subprocess.run([
    'tar', '-xzf', '/tmp/context.tar.gz',
    '-C', '/home/user'
], capture_output=True, text=True)
if result.returncode == 0:
    print("Context restored successfully")
else:
    print(f"Extract failed: {result.stderr}")
`);

    const output = extractResult.logs.stdout.join("");
    if (output.includes("restored successfully")) {
      onEvent({
        type: "log",
        value: {
          type: "data",
          args: [{ value: "[DEBUG] Previous context restored" }],
        },
      });
    } else {
      throw new Error("Context extraction failed");
    }
  }

  /**
   * Injects user-uploaded files into the sandbox.
   */
  private async injectUploadedFiles(
    sb: Sandbox,
    files: ThreadFileMetadata[],
    onEvent: (event: any) => void,
  ): Promise<void> {
    const userFiles = files.filter((f) => f.source === "user" && f.storageKey);

    if (userFiles.length === 0) {
      return;
    }

    onEvent({
      type: "log",
      value: {
        type: "data",
        args: [
          {
            value: `[DEBUG] Injecting ${userFiles.length} user-uploaded files`,
          },
        ],
      },
    });

    for (const file of userFiles) {
      try {
        if (!file.storageKey) continue;

        // Check file size limit
        if (file.size > MAX_FILE_SIZE_BYTES) {
          onEvent({
            type: "log",
            value: {
              type: "data",
              args: [
                {
                  value: `[DEBUG] Skipping ${file.name} - exceeds size limit`,
                },
              ],
            },
          });
          continue;
        }

        // Download from storage
        const buffer = await serverFileStorage.download(file.storageKey);
        const b64 = buffer.toString("base64");

        // Write to sandbox
        await sb.runCode(`
import base64
with open("/home/user/${file.name}", "wb") as f:
    f.write(base64.b64decode("${b64}"))
print("Injected: ${file.name}")
`);

        onEvent({
          type: "log",
          value: {
            type: "data",
            args: [{ value: `[DEBUG] Injected file: ${file.name}` }],
          },
        });
      } catch (error) {
        console.error(`Failed to inject file ${file.name}:`, error);
        onEvent({
          type: "log",
          value: {
            type: "data",
            args: [{ value: `[DEBUG] Failed to inject: ${file.name}` }],
          },
        });
      }
    }
  }
}
