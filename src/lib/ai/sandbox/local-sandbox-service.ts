/**
 * Local Sandbox Service
 *
 * Provides an E2BSandboxService-compatible API that uses local code execution
 * instead of cloud-based E2B sandboxes.
 *
 * This is the local-first replacement for the cloud-based E2B service.
 */

import { spawn, ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import logger from "logger";
import { randomUUID } from "crypto";

/**
 * Event types emitted during code execution
 */
type ExecutionEventType = "log" | "artifacts" | "error" | "finish";

interface ExecutionEvent {
  type: ExecutionEventType;
  value: any;
}

type EventCallback = (event: ExecutionEvent) => void;

/**
 * Artifact produced by code execution
 */
interface ExecutionArtifact {
  filename: string;
  path: string;
  base64?: string;
  url?: string;
  size?: number;
}

/**
 * Execution result
 */
interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  artifacts: ExecutionArtifact[];
  error?: string;
}

/**
 * Local Sandbox Service - Executes code locally using child processes
 */
export class LocalSandboxService {
  private static instance: LocalSandboxService;
  private workDir: string;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  private constructor() {
    // Create workspace in temp directory
    this.workDir = path.join(os.tmpdir(), "shadower-sandbox");
  }

  static getInstance(): LocalSandboxService {
    if (!LocalSandboxService.instance) {
      LocalSandboxService.instance = new LocalSandboxService();
    }
    return LocalSandboxService.instance;
  }

  /**
   * Ensure the workspace directory exists
   */
  private async ensureWorkDir(subDir?: string): Promise<string> {
    const dir = subDir ? path.join(this.workDir, subDir) : this.workDir;
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Run code with context (thread and user tracking)
   */
  async runCodeWithContext(
    code: string,
    language: "javascript" | "python",
    threadId: string,
    userId: string,
    onEvent?: EventCallback,
  ): Promise<ExecutionResult> {
    const sessionDir = await this.ensureWorkDir(`${threadId}-${Date.now()}`);
    logger.info(
      `[LocalSandbox] Running ${language} code in context: thread=${threadId}, user=${userId}`,
    );
    return this.executeCode(code, language, sessionDir, onEvent);
  }

  /**
   * Run code with callback (no context tracking)
   */
  async runCodeWithCallback(
    code: string,
    language: "javascript" | "python",
    onEvent?: EventCallback,
  ): Promise<ExecutionResult> {
    const sessionDir = await this.ensureWorkDir(`session-${Date.now()}`);
    logger.info(`[LocalSandbox] Running ${language} code`);
    return this.executeCode(code, language, sessionDir, onEvent);
  }

  /**
   * Execute code in a local process
   */
  private async executeCode(
    code: string,
    language: "javascript" | "python",
    sessionDir: string,
    onEvent?: EventCallback,
  ): Promise<ExecutionResult> {
    const executionId = randomUUID();

    try {
      // Write code to file
      const extension = language === "python" ? "py" : "js";
      const filename = `script.${extension}`;
      const filePath = path.join(sessionDir, filename);
      await fs.writeFile(filePath, code);

      // Determine command
      const command = language === "python" ? "python3" : "node";

      // Track stdout, stderr, and artifacts
      let stdout = "";
      let stderr = "";
      const artifacts: ExecutionArtifact[] = [];

      return new Promise<ExecutionResult>((resolve) => {
        const proc = spawn(command, [filePath], {
          cwd: sessionDir,
          timeout: 120000, // 2 minute timeout
          env: {
            ...process.env,
            PYTHONUNBUFFERED: "1", // Ensure Python output is not buffered
          },
        });

        this.activeProcesses.set(executionId, proc);

        proc.stdout?.on("data", (data: Buffer) => {
          const text = data.toString();
          stdout += text;
          onEvent?.({
            type: "log",
            value: {
              type: "stdout",
              text,
              args: [{ value: text }],
            },
          });
        });

        proc.stderr?.on("data", (data: Buffer) => {
          const text = data.toString();
          stderr += text;
          onEvent?.({
            type: "log",
            value: {
              type: "stderr",
              text,
              args: [{ value: text }],
            },
          });
        });

        proc.on("error", (error) => {
          logger.error("[LocalSandbox] Process error:", error);
          onEvent?.({
            type: "error",
            value: error.message,
          });
        });

        proc.on("close", async (exitCode) => {
          this.activeProcesses.delete(executionId);

          // Scan for generated files (artifacts)
          try {
            const files = await fs.readdir(sessionDir);
            for (const file of files) {
              if (file === filename) continue; // Skip the script file

              const fileStat = await fs.stat(path.join(sessionDir, file));
              if (fileStat.isFile()) {
                const artifact: ExecutionArtifact = {
                  filename: file,
                  path: path.join(sessionDir, file),
                  size: fileStat.size,
                };

                // For certain file types, read as base64
                const ext = path.extname(file).toLowerCase();
                if (
                  [
                    ".png",
                    ".jpg",
                    ".jpeg",
                    ".gif",
                    ".pdf",
                    ".docx",
                    ".xlsx",
                    ".pptx",
                  ].includes(ext)
                ) {
                  try {
                    const content = await fs.readFile(artifact.path);
                    artifact.base64 = content.toString("base64");
                  } catch (e) {
                    logger.warn(
                      `[LocalSandbox] Failed to read artifact ${file}:`,
                      e,
                    );
                  }
                }

                artifacts.push(artifact);
              }
            }

            // Emit artifacts if any found
            if (artifacts.length > 0) {
              onEvent?.({
                type: "artifacts",
                value: artifacts,
              });
            }
          } catch (e) {
            logger.warn("[LocalSandbox] Failed to scan for artifacts:", e);
          }

          const success = exitCode === 0;
          const result: ExecutionResult = {
            success,
            stdout,
            stderr,
            exitCode: exitCode ?? 1,
            artifacts,
            error: success ? undefined : stderr || `Exit code: ${exitCode}`,
          };

          // Emit finish event
          onEvent?.({
            type: "finish",
            value: {
              success,
              error: result.error,
            },
          });

          resolve(result);
        });
      });
    } catch (error: any) {
      logger.error("[LocalSandbox] Execution error:", error);

      onEvent?.({
        type: "error",
        value: error.message,
      });
      onEvent?.({
        type: "finish",
        value: {
          success: false,
          error: error.message,
        },
      });

      return {
        success: false,
        stdout: "",
        stderr: error.message,
        exitCode: 1,
        artifacts: [],
        error: error.message,
      };
    }
  }

  /**
   * Kill a running process
   */
  killProcess(executionId: string): boolean {
    const proc = this.activeProcesses.get(executionId);
    if (proc) {
      proc.kill("SIGTERM");
      this.activeProcesses.delete(executionId);
      return true;
    }
    return false;
  }

  /**
   * Clean up old session directories
   */
  async cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const dirs = await fs.readdir(this.workDir);
      const now = Date.now();

      for (const dir of dirs) {
        const dirPath = path.join(this.workDir, dir);
        try {
          const stat = await fs.stat(dirPath);
          if (stat.isDirectory() && now - stat.mtimeMs > maxAgeMs) {
            await fs.rm(dirPath, { recursive: true, force: true });
            logger.debug(`[LocalSandbox] Cleaned up session: ${dir}`);
          }
        } catch (_e) {
          // Ignore errors for individual directories
        }
      }
    } catch (e) {
      logger.warn("[LocalSandbox] Cleanup error:", e);
    }
  }
}

// Export singleton instance
export const localSandboxService = LocalSandboxService.getInstance();

// Backwards-compatible alias for code expecting E2BSandboxService
export const E2BSandboxService = LocalSandboxService;
