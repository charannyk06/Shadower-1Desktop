import { generateObject, streamObject } from "ai";
import { z } from "zod";
import type { UIMessageStreamWriter } from "ai";
import type { ChatModel } from "app-types/chat";
import { customModelProvider } from "lib/ai/models";
import {
  fragmentRepository,
  threadFileContextRepository,
} from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import type { ThreadFileMetadata } from "lib/db/pg/schema.pg";
import { morphService } from "../editing/morph-service";
import {
  FRAGMENT_TEMPLATES,
  getTemplate,
} from "../templates/fragment-templates";
import type {
  FragmentResult,
  FragmentTemplateId,
  FragmentProgressEvent,
} from "@/types/fragment";
import logger from "logger";

import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as net from "net";

/**
 * Local sandbox implementation for fragment execution
 * Replaces E2B cloud sandboxes with local process execution
 */
class LocalSandbox {
  private workDir: string;
  private process: ChildProcess | null = null;
  public readonly id: string;

  // Compatibility interface for E2B-style API
  public readonly files: {
    write: (filePath: string, content: string) => Promise<void>;
    read: (filePath: string) => Promise<string>;
  };

  constructor(workDir: string) {
    this.workDir = workDir;
    this.id = `local-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Initialize files interface for E2B compatibility
    this.files = {
      write: (filePath: string, content: string) =>
        this.writeFile(filePath, content),
      read: (filePath: string) => this.readFile(filePath),
    };
  }

  /**
   * Alias for id for E2B compatibility
   */
  get sessionId(): string {
    return this.id;
  }

  /**
   * Write a file to the sandbox working directory
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.workDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }

  /**
   * Read a file from the sandbox working directory
   */
  async readFile(filePath: string): Promise<string> {
    const fullPath = path.join(this.workDir, filePath);
    return await fs.readFile(fullPath, "utf-8");
  }

  /**
   * Run a command in the sandbox
   */
  async runCommand(
    command: string,
    options?: {
      onStdout?: (data: { line: string }) => void;
      onStderr?: (data: { line: string }) => void;
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: this.workDir,
        shell: true,
        env: { ...process.env, NODE_ENV: "development" },
      });

      const stdout: string[] = [];
      const stderr: string[] = [];

      child.stdout?.on("data", (data) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          stdout.push(line);
          options?.onStdout?.({ line });
        }
      });

      child.stderr?.on("data", (data) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          stderr.push(line);
          options?.onStderr?.({ line });
        }
      });

      child.on("close", (code) => {
        resolve({
          stdout: stdout.join("\n"),
          stderr: stderr.join("\n"),
          exitCode: code ?? 0,
        });
      });

      child.on("error", reject);
    });
  }

  /**
   * Run Python code
   */
  async runCode(
    code: string,
    options?: {
      language?: string;
      onStdout?: (data: { line: string }) => void;
      onStderr?: (data: { line: string }) => void;
    },
  ): Promise<{ logs: { stdout: string[]; stderr: string[] } }> {
    const language = options?.language || "python";
    const ext = language === "python" ? "py" : "js";
    const scriptPath = path.join(this.workDir, `_script.${ext}`);
    await fs.writeFile(scriptPath, code, "utf-8");

    const command =
      language === "python"
        ? `python3 "${scriptPath}"`
        : `node "${scriptPath}"`;
    const result = await this.runCommand(command, options);

    return {
      logs: {
        stdout: result.stdout.split("\n").filter(Boolean),
        stderr: result.stderr.split("\n").filter(Boolean),
      },
    };
  }

  /**
   * Start a dev server process
   */
  async startProcess(
    command: string,
    options?: {
      onStdout?: (data: { line: string }) => void;
      onStderr?: (data: { line: string }) => void;
    },
  ): Promise<void> {
    this.process = spawn(command, {
      cwd: this.workDir,
      shell: true,
      env: { ...process.env, NODE_ENV: "development" },
    });

    this.process.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        options?.onStdout?.({ line });
      }
    });

    this.process.stderr?.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        options?.onStderr?.({ line });
      }
    });
  }

  /**
   * Get the host URL for the dev server
   */
  getHost(port: number): string {
    return `localhost:${port}`;
  }

  /**
   * Kill any running processes
   */
  async kill(): Promise<void> {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  /**
   * Clean up the sandbox
   */
  async cleanup(): Promise<void> {
    await this.kill();
    try {
      await fs.rm(this.workDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Active local sandboxes
const activeSandboxes = new Map<string, LocalSandbox>();

/**
 * Find an available port
 */
async function findAvailablePort(startPort: number = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => {
      // Port in use, try next
      findAvailablePort(startPort + 1)
        .then(resolve)
        .catch(reject);
    });
    server.listen(startPort, () => {
      const addr = server.address();
      const port = typeof addr === "object" ? addr?.port : startPort;
      server.close(() => resolve(port || startPort));
    });
  });
}

/**
 * Local sandbox pool for fragment execution
 */
const sandboxPool = {
  async acquire(templateId: string): Promise<LocalSandbox> {
    // Create a temporary directory for the sandbox
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), `fragment-${templateId}-`),
    );
    const sandbox = new LocalSandbox(tempDir);
    activeSandboxes.set(sandbox.id, sandbox);

    logger.info(
      `[FRAGMENT] Created local sandbox ${sandbox.id} for template ${templateId}`,
    );
    return sandbox;
  },

  async release(sandbox: LocalSandbox): Promise<void> {
    activeSandboxes.delete(sandbox.id);
    await sandbox.cleanup();
    logger.info(`[FRAGMENT] Released local sandbox ${sandbox.id}`);
  },
};

const persistenceManager = {
  async reconnect(sessionId: string): Promise<LocalSandbox | null> {
    // Check if session is still active
    const sandbox = activeSandboxes.get(sessionId);
    if (sandbox) {
      logger.info(`[FRAGMENT] Reconnected to local session ${sessionId}`);
      return sandbox;
    }
    // Local sessions are not persistent across restarts
    return null;
  },
};

/**
 * FragmentAgent - FULLY AUTONOMOUS code generation and editing
 *
 * This is the core intelligence that:
 * 1. Analyzes user requests
 * 2. Chooses the best template automatically
 * 3. Generates production-quality code
 * 4. Executes instantly with pooled sandboxes
 * 5. Performs surgical edits with Morph API
 * 6. Deploys with one command
 *
 * NO MANUAL INTERVENTION REQUIRED - fully autonomous
 */
export class FragmentAgent {
  /**
   * AUTONOMOUSLY create fragment from user request
   * Zero configuration needed - AI decides everything
   */
  async autonomousCreate(
    request: string,
    context: {
      userId: string;
      threadId: string;
      dataStream?: UIMessageStreamWriter;
      chatModel?: ChatModel;
      toolCallId?: string; // Optional toolCallId for progress event correlation
    },
  ): Promise<FragmentResult> {
    logger.info(
      `[FRAGMENT] Starting autonomous creation for user ${context.userId}`,
    );

    try {
      // STEP 1: Analyze request → Choose template (AGENTIC)
      this.emitProgress(
        context.dataStream,
        {
          stage: "analyzing",
          message: "Analyzing your request...",
          operation: {
            type: "tool-call",
            toolName: "analyze request",
            status: "running",
            output: "Selecting best template for your request...",
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      const { template, title, description } = await this.analyzeRequest(
        request,
        context.chatModel,
        context.dataStream,
        context.toolCallId,
      );

      logger.info(`[FRAGMENT] Selected template: ${template.id}`);

      // Mark analyze request as complete
      this.emitProgress(
        context.dataStream,
        {
          stage: "template-selected",
          message: `Creating ${template.name}...`,
          template: template.id,
          operation: {
            type: "tool-call",
            toolName: "analyze request",
            status: "success",
            output: `Selected template: ${template.name}`,
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      // STEP 2: Generate code (AGENTIC - AI writes production code)
      this.emitProgress(
        context.dataStream,
        {
          stage: "generating",
          message: "Generating production-quality code...",
          operation: {
            type: "file-write",
            toolName: "generate code",
            status: "running",
            output: "Generating production-quality code...",
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      const { code, dependencies } = await this.generateCode(
        template,
        request,
        context.chatModel,
        context.dataStream,
        context.toolCallId,
      );

      logger.debug(
        `[FRAGMENT] Generated ${code.length} chars of code with ${dependencies.length} deps`,
      );

      // Mark generate code as complete
      this.emitProgress(
        context.dataStream,
        {
          stage: "generating",
          message: `Generated ${code.length} characters of code`,
          operation: {
            type: "file-write",
            toolName: "generate code",
            status: "success",
            output: `Generated ${code.length} characters of code`,
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      // STEP 3: Initialize local sandbox
      this.emitProgress(
        context.dataStream,
        {
          stage: "generating",
          message: "Initializing local sandbox...",
          operation: {
            type: "local-exec",
            status: "running",
            output: "Initializing local sandbox...",
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      // Acquire local sandbox from pool
      const sandbox = await sandboxPool.acquire(
        template.id as FragmentTemplateId,
      );

      logger.info(`[FRAGMENT] Using local session: ${sandbox.id}`);

      this.emitProgress(
        context.dataStream,
        {
          stage: "generating",
          message: "Local session ready",
          operation: {
            type: "local-exec",
            status: "success",
            output: `Local session ${sandbox.sessionId} acquired`,
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      // STEP 4: Install dependencies (if any)
      if (dependencies.length > 0) {
        const installCmd = template.getInstallCommand(dependencies);

        this.emitProgress(
          context.dataStream,
          {
            stage: "installing",
            message: `Installing ${dependencies.length} packages...`,
            operation: {
              type: "install",
              command: installCmd,
              status: "running",
              timestamp: Date.now(),
            },
          },
          context.toolCallId,
        );

        const installStartTime = Date.now();
        await this.runCommandWithStreaming(
          sandbox,
          installCmd,
          (line: string, _isError: boolean) => {
            // Only emit message updates, NO operation per line (reduces noise)
            this.emitProgress(
              context.dataStream,
              {
                stage: "installing",
                message: `Installing: ${line.substring(0, 80)}...`,
                // NO operation here - just status update
              },
              context.toolCallId,
            );
          },
        );

        logger.debug(
          `[FRAGMENT] Installed dependencies: ${dependencies.join(", ")}`,
        );

        this.emitProgress(
          context.dataStream,
          {
            stage: "installing",
            message: "Dependencies installed",
            operation: {
              type: "bash",
              command: installCmd,
              status: "success",
              timestamp: Date.now(),
              durationMs: Date.now() - installStartTime,
            },
          },
          context.toolCallId,
        );
      }

      // STEP 5: Write code to sandbox
      const writeStartTime = Date.now();
      this.emitProgress(
        context.dataStream,
        {
          stage: "executing",
          message: "Writing code to sandbox...",
          operation: {
            type: "file-write",
            toolName: "write file",
            filePath: template.file_path,
            status: "running",
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      await sandbox.files.write(template.file_path, code);

      // Emit workspace file for UI display
      const workspaceFiles = [
        {
          path: template.file_path,
          content: code,
          language:
            template.id.includes("nextjs") || template.id.includes("vue")
              ? "typescript"
              : template.id.includes("streamlit") ||
                  template.id.includes("gradio")
                ? "python"
                : "javascript",
        },
      ];

      this.emitProgress(
        context.dataStream,
        {
          stage: "executing",
          message: "Code written",
          operation: {
            type: "file-write",
            toolName: "write file",
            filePath: template.file_path,
            content: code.substring(0, 500), // Preview first 500 chars
            status: "success",
            timestamp: Date.now(),
            durationMs: Date.now() - writeStartTime,
          },
          workspaceFiles,
        },
        context.toolCallId,
      );

      this.emitProgress(
        context.dataStream,
        {
          stage: "executing",
          message: "Launching preview...",
        },
        context.toolCallId,
      );

      // STEP 6: Execute & get preview URL (INSTANT for web apps)
      const result = await this.execute(
        sandbox,
        template,
        code,
        context.dataStream,
        context.toolCallId,
      );

      logger.info(
        `[FRAGMENT] Execution complete: ${result.previewUrl || "code-interpreter"}`,
      );

      // STEP 7: Store in DB for future edits
      const fragment = await fragmentRepository.create({
        threadId: context.threadId,
        userId: context.userId,
        template: template.id,
        title,
        description,
        code,
        filePath: template.file_path,
        port: template.port || undefined,
        sessionId: sandbox.sessionId,
        previewUrl: result.previewUrl,
      });

      await fragmentRepository.update(fragment.id, {
        status: "ready",
      });

      logger.info(`[FRAGMENT] ✅ Fragment created: ${fragment.id}`);

      // Final workspace files update
      const finalWorkspaceFiles = [
        {
          path: template.file_path,
          content: code,
          language:
            template.id.includes("nextjs") || template.id.includes("vue")
              ? "typescript"
              : template.id.includes("streamlit") ||
                  template.id.includes("gradio")
                ? "python"
                : "javascript",
        },
      ];

      // Persist workspace files for Theater Panel display
      try {
        await this.persistWorkspaceFiles(
          context.threadId,
          context.userId,
          finalWorkspaceFiles,
          title,
        );
        logger.info(
          `[FRAGMENT] Persisted ${finalWorkspaceFiles.length} workspace files to thread context`,
        );
      } catch (persistError) {
        logger.warn(
          "[FRAGMENT] Failed to persist workspace files:",
          persistError,
        );
      }

      this.emitProgress(
        context.dataStream,
        {
          stage: "complete",
          message: `${template.name} ready!`,
          fragmentId: fragment.id,
          previewUrl: result.previewUrl,
          workspaceFiles: finalWorkspaceFiles,
        },
        context.toolCallId,
      );

      // Don't release sandbox yet - might be used for edits
      // sandboxPool will handle timeout

      return {
        fragmentId: fragment.id,
        previewUrl: result.previewUrl,
        output: result.output,
        sessionId: sandbox.sessionId,
        template: template.id,
        title,
        code,
      };
    } catch (error: any) {
      logger.error("[FRAGMENT] Creation failed:", error);

      this.emitProgress(
        context.dataStream,
        {
          stage: "error",
          message: error.message || "Failed to create fragment",
          error: error.message,
          operation: {
            type: "info",
            status: "error",
            output: error.message,
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      throw error;
    }
  }

  /**
   * AUTONOMOUSLY edit existing fragment
   * Uses Morph API for surgical edits - NO FULL REWRITE
   */
  async autonomousEdit(
    fragmentId: string,
    editRequest: string,
    context: {
      userId: string;
      dataStream?: UIMessageStreamWriter;
      chatModel?: ChatModel;
      toolCallId?: string; // Optional toolCallId for progress event correlation
    },
  ): Promise<FragmentResult> {
    logger.info(
      `[FRAGMENT] Starting autonomous edit for fragment ${fragmentId}`,
    );

    try {
      const fragment = await fragmentRepository.getById(fragmentId);
      if (!fragment) {
        throw new Error(`Fragment ${fragmentId} not found`);
      }
      if (!fragment.code || !fragment.file_path || !fragment.template) {
        throw new Error(
          `Fragment ${fragmentId} is missing code, file_path, or template`,
        );
      }

      this.emitProgress(
        context.dataStream,
        {
          stage: "editing",
          message: "Applying surgical edits...",
          operation: {
            type: "file-write",
            toolName: "edit file",
            filePath: fragment.file_path,
            status: "running",
            output: `Editing ${fragment.file_path}...`,
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      // Use Morph API for SMART, TARGETED edits
      const { patchedCode, commentary } = await morphService.applyEdit(
        fragment.code,
        editRequest,
        fragment.file_path,
      );

      logger.info(`[FRAGMENT] Edit applied: ${commentary}`);

      // Update code in DB
      await fragmentRepository.update(fragmentId, {
        code: patchedCode,
      });

      this.emitProgress(
        context.dataStream,
        {
          stage: "executing",
          message: "Re-executing with changes...",
          operation: {
            type: "local-exec",
            status: "running",
            output: "Reconnecting to local session...",
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      // Reconnect to sandbox or create new
      const sandbox = await this.reconnectOrCreate(fragment);

      // Local sandbox doesn't need timeout extension - processes are managed locally
      logger.info(`[FRAGMENT] Using local sandbox ${sandbox.id}`);

      // Write updated code with streaming
      const writeStartTime = Date.now();
      this.emitProgress(
        context.dataStream,
        {
          stage: "executing",
          message: "Writing updated code...",
          operation: {
            type: "file-write",
            filePath: fragment.file_path,
            status: "running",
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      await sandbox.files.write(fragment.file_path, patchedCode);

      // Emit workspace file for UI display
      const updatedWorkspaceFiles = [
        {
          path: fragment.file_path,
          content: patchedCode,
          language:
            fragment.template.includes("nextjs") ||
            fragment.template.includes("vue")
              ? "typescript"
              : fragment.template.includes("streamlit") ||
                  fragment.template.includes("gradio")
                ? "python"
                : "javascript",
        },
      ];

      this.emitProgress(
        context.dataStream,
        {
          stage: "executing",
          message: "Code updated",
          operation: {
            type: "file-write",
            filePath: fragment.file_path,
            content: patchedCode.substring(0, 500), // Preview first 500 chars
            status: "success",
            timestamp: Date.now(),
            durationMs: Date.now() - writeStartTime,
          },
          workspaceFiles: updatedWorkspaceFiles,
        },
        context.toolCallId,
      );

      const template = getTemplate(fragment.template as FragmentTemplateId);
      const result = await this.execute(
        sandbox,
        template,
        patchedCode,
        context.dataStream,
        context.toolCallId,
      );

      // Update preview URL
      await fragmentRepository.update(fragmentId, {
        previewUrl: result.previewUrl,
        sessionId: sandbox.sessionId,
      });

      logger.info(`[FRAGMENT] ✅ Edit complete: ${fragmentId}`);

      // Final workspace files update for edit
      const finalEditWorkspaceFiles = [
        {
          path: fragment.file_path,
          content: patchedCode,
          language:
            fragment.template.includes("nextjs") ||
            fragment.template.includes("vue")
              ? "typescript"
              : fragment.template.includes("streamlit") ||
                  fragment.template.includes("gradio")
                ? "python"
                : "javascript",
        },
      ];

      // Update workspace files for Theater Panel display
      if (fragment.thread_id) {
        try {
          await this.persistWorkspaceFiles(
            fragment.thread_id,
            context.userId,
            finalEditWorkspaceFiles,
            fragment.title,
          );
          logger.info(
            `[FRAGMENT] Updated workspace files for fragment ${fragmentId}`,
          );
        } catch (persistError) {
          logger.warn(
            "[FRAGMENT] Failed to persist workspace files:",
            persistError,
          );
        }
      }

      this.emitProgress(
        context.dataStream,
        {
          stage: "complete",
          message: "Edits applied successfully!",
          fragmentId,
          previewUrl: result.previewUrl,
          workspaceFiles: finalEditWorkspaceFiles,
        },
        context.toolCallId,
      );

      return {
        fragmentId,
        previewUrl: result.previewUrl,
        output: result.output,
        sessionId: sandbox.sessionId,
        template: fragment.template,
        title: fragment.title,
        code: patchedCode,
      };
    } catch (error: any) {
      logger.error("[FRAGMENT] Edit failed:", error);

      this.emitProgress(
        context.dataStream,
        {
          stage: "error",
          message: error.message || "Failed to edit fragment",
          error: error.message,
          operation: {
            type: "info",
            status: "error",
            output: error.message,
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      throw error;
    }
  }

  /**
   * AI-powered template selection (SMART AS FUCK)
   * Analyzes request and chooses optimal template
   */
  private async analyzeRequest(
    request: string,
    chatModel?: ChatModel,
    dataStream?: UIMessageStreamWriter,
    toolCallId?: string,
  ): Promise<{
    template: any;
    title: string;
    description: string;
  }> {
    // Use provided chatModel or fallback to a default model
    const model = chatModel
      ? customModelProvider.getModel(chatModel)
      : customModelProvider.getModel({
          provider: "anthropic",
          model: "claude-sonnet-4-5-20250929",
        });

    const schema = z.object({
      template: z.enum([
        "nextjs-developer",
        "vue-developer",
        "streamlit-developer",
        "gradio-developer",
        "code-interpreter-v1",
      ]),
      title: z.string().max(50).describe("Short, descriptive title"),
      description: z.string().max(200).describe("One sentence description"),
      reasoning: z.string().describe("Why this template was chosen"),
    });

    // Stream the analysis for real-time feedback
    // Use try-catch to fallback to generateObject if streaming fails
    try {
      const result = streamObject({
        model,
        schema,
        prompt: `Analyze this request and choose the BEST template:

"${request}"

## Available Templates:

**nextjs-developer** - Full-stack web apps
- Best for: Dashboards, admin panels, e-commerce, landing pages, CRUD apps
- Has: React, Next.js 14, TypeScript, Tailwind, shadcn/ui
- Port: 3000

**vue-developer** - Interactive SPAs
- Best for: Interactive UIs, component libraries, simple web apps
- Has: Vue 3, Nuxt, Tailwind, Pinia
- Port: 3000

**streamlit-developer** - Data dashboards
- Best for: Analytics dashboards, internal tools, data viz, ML demos
- Has: Streamlit, Pandas, Plotly, Matplotlib
- Port: 8501

**gradio-developer** - ML interfaces
- Best for: ML model demos, AI interfaces, computer vision apps
- Has: Gradio, Transformers, Torch, Scikit-learn
- Port: 7860

**code-interpreter-v1** - Python execution
- Best for: Data analysis, charts, Word/Excel/PPT documents, calculations
- Has: Python, Pandas, Matplotlib, openpyxl, python-pptx, python-docx
- No port (executes and returns output)

## Decision Logic:

1. Does it need a full-stack app with database? → **nextjs-developer**
2. Is it a simple interactive UI/SPA? → **vue-developer**
3. Is it data-focused (charts, analytics, dashboards)? → **streamlit-developer** or **code-interpreter-v1**
4. Is it ML/AI focused (model demo, interface)? → **gradio-developer**
5. Is it a document (Word, Excel, PowerPoint)? → **code-interpreter-v1**
6. Is it a game or interactive tool? → **nextjs-developer** or **vue-developer**

Be SMART. Choose the RIGHT template based on requirements, NOT user's specific words.`,
      });

      let object: z.infer<typeof schema> | null = null;

      // Stream updates as they come
      for await (const chunk of result.partialObjectStream) {
        object = chunk as z.infer<typeof schema>;

        // Emit progress updates as template selection progresses (NO operation - reduces noise)
        if (dataStream && object.template) {
          this.emitProgress(
            dataStream,
            {
              stage: "analyzing",
              message: `Selected template: ${object.template}`,
              template: object.template,
              // NO operation here - just status update
            },
            toolCallId,
          );
        }
      }

      // Get final object
      const finalObject = await result.object;

      return {
        template: FRAGMENT_TEMPLATES[finalObject.template],
        title: finalObject.title,
        description: finalObject.description,
      };
    } catch (error) {
      logger.warn("[FRAGMENT] Streaming failed, trying generateObject", error);

      // Try generateObject as fallback
      try {
        const fallbackResult = await generateObject({
          model,
          schema,
          prompt: `Analyze this request and choose the BEST template:

"${request}"

## Available Templates:

**nextjs-developer** - Full-stack web apps
- Best for: Dashboards, admin panels, e-commerce, landing pages, CRUD apps
- Has: React, Next.js 14, TypeScript, Tailwind, shadcn/ui
- Port: 3000

**vue-developer** - Interactive SPAs
- Best for: Interactive UIs, component libraries, simple web apps
- Has: Vue 3, Nuxt, Tailwind, Pinia
- Port: 3000

**streamlit-developer** - Data dashboards
- Best for: Analytics dashboards, internal tools, data viz, ML demos
- Has: Streamlit, Pandas, Plotly, Matplotlib
- Port: 8501

**gradio-developer** - ML interfaces
- Best for: ML model demos, AI interfaces, computer vision apps
- Has: Gradio, Transformers, Torch, Scikit-learn
- Port: 7860

**code-interpreter-v1** - Python execution
- Best for: Data analysis, charts, Word/Excel/PPT documents, calculations
- Has: Python, Pandas, Matplotlib, openpyxl, python-pptx, python-docx
- No port (executes and returns output)

## Decision Logic:

1. Does it need a full-stack app with database? → **nextjs-developer**
2. Is it a simple interactive UI/SPA? → **vue-developer**
3. Is it data-focused (charts, analytics, dashboards)? → **streamlit-developer** or **code-interpreter-v1**
4. Is it ML/AI focused (model demo, interface)? → **gradio-developer**
5. Is it a document (Word, Excel, PowerPoint)? → **code-interpreter-v1**
6. Is it a game or interactive tool? → **nextjs-developer** or **vue-developer**

Be SMART. Choose the RIGHT template based on requirements, NOT user's specific words.`,
        });

        return {
          template: FRAGMENT_TEMPLATES[fallbackResult.object.template],
          title: fallbackResult.object.title,
          description: fallbackResult.object.description,
        };
      } catch (generateObjectError) {
        // Final fallback: Smart template selection based on keywords
        logger.warn(
          "[FRAGMENT] generateObject also failed, using keyword-based selection",
          generateObjectError,
        );

        const lowerRequest = request.toLowerCase();

        // Smart keyword-based template selection
        let selectedTemplate: FragmentTemplateId = "nextjs-developer"; // Default

        if (
          lowerRequest.includes("dashboard") ||
          lowerRequest.includes("analytics") ||
          lowerRequest.includes("chart") ||
          lowerRequest.includes("data viz") ||
          lowerRequest.includes("streamlit")
        ) {
          selectedTemplate = "streamlit-developer";
        } else if (
          lowerRequest.includes("ml") ||
          lowerRequest.includes("machine learning") ||
          lowerRequest.includes("model") ||
          lowerRequest.includes("gradio") ||
          lowerRequest.includes("ai demo")
        ) {
          selectedTemplate = "gradio-developer";
        } else if (
          lowerRequest.includes("vue") ||
          lowerRequest.includes("spa") ||
          lowerRequest.includes("single page")
        ) {
          selectedTemplate = "vue-developer";
        } else if (
          lowerRequest.includes("excel") ||
          lowerRequest.includes("word") ||
          lowerRequest.includes("powerpoint") ||
          lowerRequest.includes("pptx") ||
          lowerRequest.includes("document") ||
          lowerRequest.includes("calculate") ||
          lowerRequest.includes("python script")
        ) {
          selectedTemplate = "code-interpreter-v1";
        }
        // Default to nextjs-developer for web apps, dashboards, portals, etc.

        // Generate a title from the request
        const words = request.split(/\s+/).slice(0, 5);
        const title = words
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");

        logger.info(
          `[FRAGMENT] Using keyword-based selection: ${selectedTemplate} for "${title}"`,
        );

        return {
          template: FRAGMENT_TEMPLATES[selectedTemplate],
          title: title.substring(0, 50),
          description: request.substring(0, 200),
        };
      }
    }
  }

  /**
   * AI-powered code generation (PRODUCTION QUALITY)
   * Streams code generation for real-time feedback
   */
  private async generateCode(
    template: any,
    request: string,
    chatModel?: ChatModel,
    dataStream?: UIMessageStreamWriter,
    toolCallId?: string,
  ): Promise<{ code: string; dependencies: string[] }> {
    const systemPrompt = `You are an expert ${template.name} developer.

Generate PRODUCTION-QUALITY code for: "${request}"

Template: ${template.id}
File: ${template.file_path}
Port: ${template.port || "N/A (code interpreter)"}
Pre-installed: ${template.lib.join(", ")}

## Requirements:

1. **COMPLETE, RUNNABLE CODE** - No placeholders, no TODOs
2. **Modern best practices** - Use latest patterns and conventions
3. **Error handling** - Graceful failures, user-friendly messages
4. **Beautiful UI/UX** - Professional design, good spacing, colors
5. **Comments** - Explain complex logic only
6. **Dependencies** - ONLY add if truly necessary (prefer pre-installed)

## For Web Apps:
- Use Tailwind CSS for styling
- Make it responsive (mobile-first)
- Add loading states where appropriate
- Professional color scheme

## For Code Interpreter:
- Use matplotlib/plotly for visualizations
- Return clear output/results
- Handle edge cases

Return ONLY the code and any additional dependencies needed.`;

    // Use provided chatModel or fallback to a default model
    const model = chatModel
      ? customModelProvider.getModel(chatModel)
      : customModelProvider.getModel({
          provider: "anthropic",
          model: "claude-sonnet-4-5-20250929",
        });

    const schema = z.object({
      code: z.string().describe("Complete, runnable code"),
      additional_dependencies: z
        .array(z.string())
        .describe("Extra packages needed (if any)"),
      commentary: z.string().describe("Brief explanation of approach"),
    });

    // Stream code generation for real-time feedback
    // Use try-catch to fallback to generateObject if streaming fails
    let result;
    try {
      result = streamObject({
        model,
        schema,
        system: systemPrompt,
        prompt: request,
      });
    } catch (error) {
      logger.warn(
        "[FRAGMENT] Code streaming failed, falling back to generateObject",
        error,
      );
      // Fallback to non-streaming version
      const fallbackResult = await generateObject({
        model,
        schema,
        system: systemPrompt,
        prompt: request,
      });

      return {
        code: fallbackResult.object.code,
        dependencies: fallbackResult.object.additional_dependencies,
      };
    }

    let accumulatedCode = "";
    let lastEmitTime = Date.now();
    const EMIT_INTERVAL_MS = 200; // Emit progress every 200ms

    // Stream code chunks as they're generated
    try {
      for await (const chunk of result.partialObjectStream) {
        const partial = chunk as Partial<z.infer<typeof schema>>;

        if (partial.code !== undefined) {
          accumulatedCode = partial.code;

          // Emit code chunks for real-time display (NO operation - just code streaming)
          const now = Date.now();
          if (dataStream && now - lastEmitTime >= EMIT_INTERVAL_MS) {
            this.emitProgress(
              dataStream,
              {
                stage: "generating",
                message: `Generating code... (${accumulatedCode.length} chars)`,
                codeChunk: accumulatedCode,
                codeLength: accumulatedCode.length,
                generatedCode: accumulatedCode,
                // NO operation here - just code streaming update
              },
              toolCallId,
            );
            lastEmitTime = now;
          }
        }
      }

      // Get final object
      const finalObject = await result.object;

      // Emit final code
      if (dataStream) {
        this.emitProgress(
          dataStream,
          {
            stage: "generating",
            message: `Code generated (${finalObject.code.length} chars)`,
            codeChunk: finalObject.code,
            codeLength: finalObject.code.length,
            generatedCode: finalObject.code,
            operation: {
              type: "file-write",
              toolName: "write file",
              status: "success",
              output: `Writing ${finalObject.code.length} characters to file`,
              timestamp: Date.now(),
            },
          },
          toolCallId,
        );
      }

      return {
        code: finalObject.code,
        dependencies: finalObject.additional_dependencies,
      };
    } catch (streamingError) {
      logger.warn(
        "[FRAGMENT] Streaming code generation failed, trying generateObject",
        streamingError,
      );

      // Try generateObject as fallback
      try {
        const fallbackResult = await generateObject({
          model,
          schema,
          system: systemPrompt,
          prompt: request,
        });

        return {
          code: fallbackResult.object.code,
          dependencies: fallbackResult.object.additional_dependencies,
        };
      } catch (generateObjectError) {
        // Final fallback: Use generateText and extract code
        logger.warn(
          "[FRAGMENT] generateObject also failed, using generateText fallback",
          generateObjectError,
        );

        const { generateText } = await import("ai");

        const textResult = await generateText({
          model,
          system: systemPrompt,
          prompt: `${request}

IMPORTANT: Return ONLY the code. No markdown, no explanations, no \`\`\` blocks. Just the raw code.`,
        });

        // Extract code from the response
        let code = textResult.text;

        // Remove markdown code blocks if present
        code = code
          .replace(/^```[\w]*\n?/gm, "")
          .replace(/```$/gm, "")
          .trim();

        logger.info(
          `[FRAGMENT] Generated ${code.length} chars of code via generateText fallback`,
        );

        return {
          code,
          dependencies: [], // No dependencies in fallback mode
        };
      }
    }
  }

  /**
   * Execute code and return preview URL or output
   * For web apps: starts dev server and waits for it to be ready
   * For code interpreter: runs code and returns output
   */
  private async execute(
    sandbox: LocalSandbox,
    template: any,
    code: string,
    dataStream?: UIMessageStreamWriter,
    toolCallId?: string,
  ): Promise<{ previewUrl?: string; output?: string }> {
    if (template.type === "web-app") {
      // Web app - start dev server and wait for it
      return await this.startWebApp(sandbox, template, dataStream, toolCallId);
    }

    // Code interpreter - run code and return output
    logger.info(`[FRAGMENT] Running code interpreter`);

    this.emitProgress(
      dataStream,
      {
        stage: "executing",
        message: "Executing code...",
        operation: {
          type: "bash",
          command: `python ${template.file_path}`,
          status: "running",
          timestamp: Date.now(),
        },
      },
      toolCallId,
    );

    // Track output lines for final summary
    const outputLines: string[] = [];

    const result = await sandbox.runCode(code, {
      language: "python",
      onStdout: (data: any) => {
        outputLines.push(data.line);
        // Only emit message update, NO operation per line (reduces noise)
        this.emitProgress(
          dataStream,
          {
            stage: "executing",
            message: `Output: ${data.line.substring(0, 80)}...`,
            // NO operation here - just status update
          },
          toolCallId,
        );
      },
      onStderr: (data: any) => {
        outputLines.push(`[stderr] ${data.line}`);
        // Only emit message update, NO operation per line
        this.emitProgress(
          dataStream,
          {
            stage: "executing",
            message: `Error: ${data.line.substring(0, 80)}...`,
            // NO operation here - just status update
          },
          toolCallId,
        );
      },
    });

    const output = [...result.logs.stdout, ...result.logs.stderr].join("\n");

    this.emitProgress(
      dataStream,
      {
        stage: "executing",
        message: "Code execution complete",
        operation: {
          type: "bash",
          command: `python ${template.file_path}`,
          output,
          status: "success",
          timestamp: Date.now(),
        },
      },
      toolCallId,
    );

    return { output };
  }

  /**
   * Start web app dev server and wait for it to be ready
   *
   * For local-first mode, we start the dev server process locally
   * and wait for it to respond on localhost.
   */
  private async startWebApp(
    sandbox: LocalSandbox,
    template: any,
    dataStream?: UIMessageStreamWriter,
    toolCallId?: string,
  ): Promise<{ previewUrl?: string }> {
    // Find an available port for local dev server
    const port = template.port
      ? await findAvailablePort(template.port)
      : await findAvailablePort(3000);
    const previewUrl = `http://${sandbox.getHost(port)}`;

    this.emitProgress(
      dataStream,
      {
        stage: "executing",
        message: `Starting ${template.name} local preview server on port ${port}...`,
        operation: {
          type: "bash",
          command: template.startCommand || "npm run dev",
          status: "running",
          timestamp: Date.now(),
        },
      },
      toolCallId,
    );

    const startTime = Date.now();

    // Start the dev server process
    const startCommand =
      template.startCommand ||
      (template.id?.includes("streamlit")
        ? `streamlit run app.py --server.port ${port}`
        : template.id?.includes("next")
          ? `npx next dev -p ${port}`
          : template.id?.includes("vue")
            ? `npm run dev -- --port ${port}`
            : `npm run dev -- --port ${port}`);

    logger.info(`[FRAGMENT] Starting local dev server: ${startCommand}`);

    // Install dependencies first if package.json exists
    try {
      const pkgPath = path.join((sandbox as any).workDir || "", "package.json");
      await fs.access(pkgPath);
      logger.info(`[FRAGMENT] Installing npm dependencies...`);
      this.emitProgress(
        dataStream,
        {
          stage: "executing",
          message: "Installing dependencies...",
        },
        toolCallId,
      );
      await sandbox.runCommand("npm install", {
        onStdout: (data) => logger.debug(`[npm] ${data.line}`),
        onStderr: (data) => logger.debug(`[npm] ${data.line}`),
      });
    } catch {
      // No package.json, skip npm install
    }

    // Start the dev server in background
    await sandbox.startProcess(startCommand, {
      onStdout: (data) => {
        logger.debug(`[dev-server] ${data.line}`);
      },
      onStderr: (data) => {
        logger.debug(`[dev-server] ${data.line}`);
      },
    });

    // Wait for server to be ready (poll for up to 60 seconds)
    let serverReady = false;
    const maxWaitTime = 60000;
    const pollInterval = 2000;
    const startWait = Date.now();

    logger.info(`[FRAGMENT] Waiting for dev server on port ${port}...`);

    while (!serverReady && Date.now() - startWait < maxWaitTime) {
      try {
        // Check if the port is responding
        const response = await fetch(`http://localhost:${port}`, {
          method: "HEAD",
          signal: AbortSignal.timeout(2000),
        }).catch(() => null);

        if (response) {
          serverReady = true;
          logger.info(
            `[FRAGMENT] Server responding with status: ${response.status}`,
          );
        }
      } catch {
        // Ignore errors during startup
      }

      if (!serverReady) {
        this.emitProgress(
          dataStream,
          {
            stage: "executing",
            message: `Waiting for server on port ${port}...`,
          },
          toolCallId,
        );
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    if (serverReady) {
      logger.info(`[FRAGMENT] Dev server ready!`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      logger.warn(
        `[FRAGMENT] Server may still be starting. Preview URL: ${previewUrl}`,
      );
    }

    logger.info(`[FRAGMENT] Web app preview: ${previewUrl}`);

    this.emitProgress(
      dataStream,
      {
        stage: "executing",
        message: serverReady
          ? `Preview ready: ${previewUrl}`
          : `Preview starting... ${previewUrl}`,
        operation: {
          type: "bash",
          command: startCommand,
          output: serverReady ? "Server is ready!" : "Server is starting...",
          status: serverReady ? "success" : "running",
          timestamp: Date.now(),
          durationMs: Date.now() - startTime,
        },
      },
      toolCallId,
    );

    return { previewUrl };
  }

  /**
   * Run command with real-time streaming of stdout/stderr
   */
  private async runCommandWithStreaming(
    sandbox: LocalSandbox,
    command: string,
    onOutput: (line: string, isError: boolean) => void,
  ): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const result = await sandbox.runCommand(command, {
      onStdout: (data) => onOutput(data.line, false),
      onStderr: (data) => onOutput(data.line, true),
    });

    return {
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  /**
   * Reconnect to existing session or create new one
   */
  private async reconnectOrCreate(fragment: any): Promise<LocalSandbox> {
    // Try to reconnect to existing session
    if (fragment.session_id) {
      const existing = await persistenceManager.reconnect(fragment.session_id);
      if (existing) {
        logger.info(
          `[FRAGMENT] Reconnected to local session ${fragment.session_id}`,
        );
        return existing;
      }
    }

    // Create new local sandbox
    logger.info(
      `[FRAGMENT] Creating new local session for ${fragment.template}`,
    );
    return await sandboxPool.acquire(fragment.template as FragmentTemplateId);
  }

  /**
   * Persist workspace files to ThreadFileContext for Theater Panel display
   */
  private async persistWorkspaceFiles(
    threadId: string,
    userId: string,
    workspaceFiles: { path: string; content: string; language?: string }[],
    fragmentTitle: string,
  ): Promise<void> {
    // Get or create thread file context
    await threadFileContextRepository.getOrCreate(threadId, userId);

    for (const file of workspaceFiles) {
      // Create a unique storage key for this fragment file
      const sanitizedTitle = fragmentTitle
        .replace(/[^a-zA-Z0-9-_]/g, "-")
        .substring(0, 50);
      const timestamp = Date.now();
      const storageKey = `thread-fragments/${threadId}/${sanitizedTitle}-${timestamp}/${file.path}`;
      const buffer = Buffer.from(file.content, "utf-8");

      // Upload to storage
      const uploadResult = await serverFileStorage.upload(buffer, {
        filename: storageKey,
        contentType: this.getMimeType(file.path),
      });

      // Create file metadata
      const fileMetadata: ThreadFileMetadata = {
        name: file.path,
        size: buffer.length,
        type: this.getMimeType(file.path),
        source: "generated",
        storageKey,
        url: uploadResult.sourceUrl,
        uploadedAt: new Date().toISOString(),
      };

      // Add to thread context
      await threadFileContextRepository.addFile(threadId, fileMetadata);
    }
  }

  private getMimeType(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const mimeTypes: Record<string, string> = {
      ts: "text/typescript",
      tsx: "text/typescript",
      js: "text/javascript",
      jsx: "text/javascript",
      py: "text/x-python",
      vue: "text/x-vue",
      json: "application/json",
      css: "text/css",
      html: "text/html",
      md: "text/markdown",
    };
    return mimeTypes[ext] || "text/plain";
  }

  /**
   * Emit progress event to UI
   */
  private emitProgress(
    dataStream: UIMessageStreamWriter | undefined,
    event: FragmentProgressEvent,
    toolCallId?: string,
  ): void {
    if (dataStream) {
      // Ensure toolCallId is included
      const eventWithToolCallId = {
        ...event,
        toolCallId: event.toolCallId || toolCallId,
      };

      // Log for debugging
      logger.debug(
        `[FRAGMENT] Emitting progress: ${event.stage} - ${event.message}`,
        {
          toolCallId: eventWithToolCallId.toolCallId,
          hasOperation: !!event.operation,
          operationType: event.operation?.type,
          operationStatus: event.operation?.status,
          operationsCount: event.operations?.length || 0,
          workspaceFilesCount: event.workspaceFiles?.length || 0,
        },
      );

      dataStream.write({
        type: "data-fragment-progress",
        data: eventWithToolCallId,
      });
    } else {
      logger.warn("[FRAGMENT] Cannot emit progress - dataStream is undefined");
    }
  }
}

// Singleton instance
export const fragmentAgent = new FragmentAgent();
