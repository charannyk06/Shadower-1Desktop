import { generateObject, streamObject } from "ai";
import { z } from "zod";
import type { UIMessageStreamWriter } from "ai";
import type { ChatModel } from "app-types/chat";
import { customModelProvider } from "lib/ai/models";
import {
  fragmentRepository,
  threadSandboxContextRepository,
} from "lib/db/repository";
import { serverFileStorage } from "lib/file-storage";
import type { ThreadFileMetadata } from "lib/db/pg/schema.pg";
import { sandboxPool } from "../sandbox/sandbox-pool";
import { morphService } from "../editing/morph-service";
import { persistenceManager } from "../sandbox/persistence-manager";
import {
  FRAGMENT_TEMPLATES,
  getTemplate,
} from "../templates/fragment-templates";
import type {
  FragmentResult,
  FragmentTemplateId,
  FragmentProgressEvent,
  FragmentOperation,
} from "@/types/fragment";
import logger from "logger";

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
          stage: "code-generated",
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

      // STEP 3: Get sandbox from pool (FAST AS FUCK)
      this.emitProgress(
        context.dataStream,
        {
          stage: "generating",
          message: "Acquiring sandbox...",
          operation: {
            type: "sandbox",
            status: "running",
            message: "Acquiring sandbox from pool...",
          },
        },
        context.toolCallId,
      );

      const sandbox = await sandboxPool.acquire(template.id);

      // Extend sandbox timeout to 10 minutes to prevent premature timeout
      try {
        await sandbox.setTimeout(600000); // 10 minutes
        logger.info(`[FRAGMENT] Extended sandbox timeout to 10 minutes`);
      } catch (e) {
        logger.warn(`[FRAGMENT] Could not extend sandbox timeout: ${e}`);
      }

      logger.info(`[FRAGMENT] Acquired sandbox ${sandbox.sandboxId}`);

      this.emitProgress(
        context.dataStream,
        {
          stage: "generating",
          message: "Sandbox ready",
          operation: {
            type: "sandbox",
            status: "success",
            output: `Sandbox ${sandbox.sandboxId} acquired`,
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
        sandboxId: sandbox.sandboxId,
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
        sandboxId: sandbox.sandboxId,
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
            type: "sandbox",
            status: "running",
            output: "Reconnecting to sandbox...",
            timestamp: Date.now(),
          },
        },
        context.toolCallId,
      );

      // Reconnect to sandbox or create new
      const sandbox = await this.reconnectOrCreate(fragment);

      // Extend sandbox timeout to 10 minutes
      try {
        await sandbox.setTimeout(600000); // 10 minutes
        logger.info(`[FRAGMENT] Extended sandbox timeout to 10 minutes`);
      } catch (e) {
        logger.warn(`[FRAGMENT] Could not extend sandbox timeout: ${e}`);
      }

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

      const template = getTemplate(fragment.template);
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
        sandboxId: sandbox.sandboxId,
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
        sandboxId: sandbox.sandboxId,
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
    sandbox: any,
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
   * NOTE: Our custom Shadower templates (shadower-nextjs, shadower-streamlit, etc.)
   * have auto-start commands configured. The dev server starts automatically when
   * the sandbox is created. We just need to wait for it to be ready.
   */
  private async startWebApp(
    sandbox: any,
    template: any,
    dataStream?: UIMessageStreamWriter,
    toolCallId?: string,
  ): Promise<{ previewUrl?: string }> {
    if (!template.port) {
      throw new Error(
        `Template ${template.id} does not have a port configured`,
      );
    }

    const previewUrl = `https://${sandbox.getHost(template.port)}`;

    this.emitProgress(
      dataStream,
      {
        stage: "executing",
        message: `Starting ${template.name} preview server...`,
        operation: {
          type: "bash",
          command: "Starting dev server (auto-started by template)",
          status: "running",
          timestamp: Date.now(),
        },
      },
      toolCallId,
    );

    const startTime = Date.now();
    let serverReady = false;

    logger.info(
      `[FRAGMENT] Waiting for dev server on port ${template.port}...`,
    );

    // Wait for server to be ready (poll for up to 60 seconds)
    const maxWaitTime = 60000; // 60 seconds
    const pollInterval = 2000; // 2 seconds
    const startWait = Date.now();

    while (!serverReady && Date.now() - startWait < maxWaitTime) {
      try {
        // Check if the port is responding using curl
        const checkResult = await sandbox.commands.run(
          `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://localhost:${template.port} 2>/dev/null || echo "000"`,
          { timeoutMs: 10000 },
        );
        const statusCode = checkResult.stdout.trim();

        // Only emit message update for polling, NO operation (reduces noise)
        this.emitProgress(
          dataStream,
          {
            stage: "executing",
            message: `Waiting for server... (${statusCode || "connecting"})`,
            // NO operation here - just status update
          },
          toolCallId,
        );

        if (statusCode && statusCode !== "000" && statusCode !== "") {
          serverReady = true;
          logger.info(
            `[FRAGMENT] Server responding with status: ${statusCode}`,
          );
        }
      } catch {
        // Ignore errors during startup
      }

      if (!serverReady) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
    }

    if (serverReady) {
      logger.info(`[FRAGMENT] Dev server ready!`);
      // Give a bit more time for full initialization
      await new Promise((resolve) => setTimeout(resolve, 1000));
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
          command: "Dev server",
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
    sandbox: any,
    command: string,
    onOutput: (line: string, isError: boolean) => void,
  ): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve, reject) => {
      const stdoutLines: string[] = [];
      const stderrLines: string[] = [];

      sandbox
        .runCode(
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

# Print stdout line by line
if result.stdout:
    for line in result.stdout.splitlines():
        print(line, flush=True)

# Print stderr line by line
if result.stderr:
    for line in result.stderr.splitlines():
        print(line, file=sys.stderr, flush=True)

# Print exit code marker
print(f"__EXIT_CODE__:{result.returncode}", flush=True)
`,
          {
            language: "python",
            onStdout: (data: any) => {
              const line = data.line;
              if (line.includes("__EXIT_CODE__:")) {
                const exitCode = Number.parseInt(
                  line.replace("__EXIT_CODE__:", "").trim(),
                  10,
                );
                resolve({
                  success: exitCode === 0,
                  stdout: stdoutLines.join("\n"),
                  stderr: stderrLines.join("\n"),
                  exitCode,
                });
              } else {
                stdoutLines.push(line);
                onOutput(line, false);
              }
            },
            onStderr: (data: any) => {
              const line = data.line;
              stderrLines.push(line);
              onOutput(line, true);
            },
          },
        )
        .catch((err: any) => {
          reject(err);
        });
    });
  }

  /**
   * Reconnect to existing sandbox or create new one
   */
  private async reconnectOrCreate(fragment: any): Promise<any> {
    // Try to reconnect to existing sandbox
    if (fragment.sandbox_id) {
      const existing = await persistenceManager.reconnect(fragment.sandbox_id);
      if (existing) {
        logger.info(`[FRAGMENT] Reconnected to sandbox ${fragment.sandbox_id}`);
        return existing;
      }
    }

    // Create new sandbox from pool
    logger.info(`[FRAGMENT] Creating new sandbox for ${fragment.template}`);
    return await sandboxPool.acquire(fragment.template as FragmentTemplateId);
  }

  /**
   * Persist workspace files to ThreadSandboxContext for Theater Panel display
   */
  private async persistWorkspaceFiles(
    threadId: string,
    userId: string,
    workspaceFiles: { path: string; content: string; language?: string }[],
    fragmentTitle: string,
  ): Promise<void> {
    // Get or create thread sandbox context
    await threadSandboxContextRepository.getOrCreate(threadId, userId);

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
      await threadSandboxContextRepository.addFile(threadId, fileMetadata);
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
